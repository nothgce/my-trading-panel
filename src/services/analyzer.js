// 业务层：CA 分析 — 大户/交易者持仓聚类
import { getTraderAddresses } from '../data/okx/market.js';
import { getPriceInfo } from '../data/okx/token.js';
import { getHolderAddresses } from '../data/solana/holders.js';
import { getTopHoldings } from '../data/okx/portfolio.js';
import { getWalletTradeHistory } from '../data/okx/wallet.js';

const CONCURRENCY = 3;
const DELAY_MS    = 600;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 失败后指数退避重试，最多 attempts 次
async function withRetry(fn, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch {
      if (i < attempts - 1) await sleep(800 * 2 ** i); // 800ms, 1600ms
    }
  }
  return null; // 全部失败
}

/**
 * 对一组钱包地址批量查持仓和交易记录，统计各代币出现人数
 * @param {string[]} wallets  - 钱包地址列表
 * @param {string}   excludeCA - 目标代币合约（排除自身）
 * @param {string}   label    - 进度标签
 * @returns {{ holdMap: Map, tradeMap: Map }}
 *   Map<contract, { symbol: string, count: number }>
 */
async function buildFrequencyMaps(wallets, excludeCA, label) {
  // holdRaw:  contract → { symbol, wallets: Set, totalUsd: number }
  // tradeRaw: contract → { symbol, wallets: Set }
  const holdRaw  = new Map();
  const tradeRaw = new Map();

  const addHolding = (contract, symbol, wallet, usdValue) => {
    if (!contract || contract.toLowerCase() === excludeCA.toLowerCase()) return;
    if ((usdValue || 0) < 1) return;   // 跳过持仓价值 < $1 的（零价/僵尸持仓）
    if (!holdRaw.has(contract)) holdRaw.set(contract, { symbol: symbol || contract.slice(0, 8) + '…', wallets: new Set(), totalUsd: 0 });
    const e = holdRaw.get(contract);
    e.wallets.add(wallet);
    e.totalUsd += usdValue;
  };

  const addTrade = (contract, symbol, wallet) => {
    if (!contract || contract === excludeCA) return;
    if (!tradeRaw.has(contract)) tradeRaw.set(contract, { symbol: symbol || contract.slice(0, 8) + '…', wallets: new Set() });
    tradeRaw.get(contract).wallets.add(wallet);
  };

  let failed = 0;
  for (let i = 0; i < wallets.length; i += CONCURRENCY) {
    const batch = wallets.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async wallet => {
      const [holdings, trades] = await Promise.all([
        withRetry(() => getTopHoldings(wallet, 20)),
        withRetry(() => getWalletTradeHistory(wallet, '501', 100)),
      ]);

      if (holdings === null && trades === null) { failed++; return; }

      for (const h of (holdings ?? []))
        addHolding(h.tokenContractAddress, h.symbol, wallet, h.usdValue);

      // 同一钱包同一合约只计一次
      const seen = new Set();
      for (const t of (trades ?? [])) {
        if (seen.has(t.tokenContractAddress)) continue;
        seen.add(t.tokenContractAddress);
        addTrade(t.tokenContractAddress, t.tokenSymbol, wallet);
      }
    }));

    if (label) process.stdout.write(`\r  ${label}: ${Math.min(i + CONCURRENCY, wallets.length)}/${wallets.length}`);
    if (i + CONCURRENCY < wallets.length) await sleep(DELAY_MS);
  }
  if (label) {
    const suffix = failed ? `  ⚠ ${failed} 个钱包失败` : '';
    console.log(suffix);
  }

  const flattenHold = raw => new Map(
    [...raw.entries()].map(([k, v]) => [k, { symbol: v.symbol, count: v.wallets.size, wallets: [...v.wallets], totalUsd: v.totalUsd }])
  );
  const flattenTrade = raw => new Map(
    [...raw.entries()].map(([k, v]) => [k, { symbol: v.symbol, count: v.wallets.size, wallets: [...v.wallets] }])
  );
  return { holdMap: flattenHold(holdRaw), tradeMap: flattenTrade(tradeRaw) };
}

/**
 * 分析代币的大户/交易者行为聚类
 * @param {string} tokenAddress - 目标代币合约地址（Solana）
 * @param {{ traderTopN?: number, holderTopN?: number }} opts
 * @returns {{
 *   traders: { addresses: string[], holdMap: Map, tradeMap: Map },
 *   holders: { addresses: string[], holdMap: Map, tradeMap: Map },
 * }}
 */
export async function analyzeToken(tokenAddress, {
  traderTopN = 100,
  holderTopN = 100,
} = {}) {
  console.log(`\n[analyzer] 分析 ${tokenAddress}`);

  // 先取市值，计算最低成交额过滤阈值（万分之一市值）
  const priceInfo = await getPriceInfo('501', tokenAddress);
  const minTradeUsd = Math.min(50, Math.max(0.01, parseFloat(priceInfo.marketCap ?? '0') / 10000));
  console.log(`  市值: $${parseFloat(priceInfo.marketCap ?? '0').toFixed(0)}, 最低成交过滤: $${minTradeUsd.toFixed(4)}`);

  process.stdout.write('  获取近期交易者（去重 + 过滤刷量）...');
  const traderAddrs = await getTraderAddresses(tokenAddress, traderTopN, minTradeUsd);
  console.log(` ${traderAddrs.length} 人`);

  process.stdout.write('  获取前 N 大户（Solana RPC）...');
  const holderAddrs = await getHolderAddresses(tokenAddress, holderTopN);
  console.log(` ${holderAddrs.length} 个`);

  // 串行避免两组同时打 API 触发限速
  const traders = await buildFrequencyMaps(traderAddrs, tokenAddress, '  交易者');
  const holders = await buildFrequencyMaps(holderAddrs, tokenAddress, '  大户');

  return {
    traders: { addresses: traderAddrs, ...traders },
    holders: { addresses: holderAddrs, ...holders },
  };
}

/**
 * 将频率 Map 转为排序后的数组
 * @param {Map} map
 * @param {number} topN
 * @returns {Array<{ symbol: string, count: number }>}
 */
export function topN(map, n = 20) {
  return [...map.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, n)
    .map(([contract, v]) => ({ contract, symbol: v.symbol, count: v.count, totalUsd: v.totalUsd }));
}
