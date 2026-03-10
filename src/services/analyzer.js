// 业务层：CA 分析 — 大户/交易者持仓聚类
import { getTraderAddresses } from '../data/okx/market.js';
import { getPriceInfo } from '../data/okx/token.js';
import { getHolderAddresses } from '../data/solana/holders.js';
import { getWalletTokenList, getWalletTradeHistory } from '../data/okx/wallet.js';
import { log } from '../logger.js';

const CONCURRENCY = 1;
const DELAY_MS    = 650;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 失败后重试，429限速等待下一个窗口，其他错误指数退避
async function withRetry(fn, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (err) {
      if (i >= attempts - 1) break;
      const is429 = err?.message?.includes('429') || err?.message?.includes('Too Many');
      await sleep(is429 ? 15_000 : 800 * 2 ** i);
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

  let okH = 0, okT = 0, failH = 0, failT = 0;
  const t0 = Date.now();

  for (let i = 0; i < wallets.length; i += CONCURRENCY) {
    const batch = wallets.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async wallet => {
      const [holdings, trades] = await Promise.all([
        withRetry(() => getWalletTokenList(wallet, '501', 50)),
        withRetry(() => getWalletTradeHistory(wallet, '501', 100)),
      ]);

      holdings === null ? failH++ : okH++;
      trades   === null ? failT++ : okT++;

      if (holdings === null && trades === null) return;

      for (const h of (holdings ?? []))
        addHolding(h.tokenContractAddress, h.tokenSymbol, wallet, parseFloat(h.balanceUsd || '0'));

      const seen = new Set();
      for (const t of (trades ?? [])) {
        if (seen.has(t.tokenContractAddress)) continue;
        seen.add(t.tokenContractAddress);
        addTrade(t.tokenContractAddress, t.tokenSymbol, wallet);
      }
    }));

    if (i + CONCURRENCY < wallets.length) await sleep(DELAY_MS);
  }

  if (label) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const hPct = okH + failH > 0 ? (okH / (okH + failH) * 100).toFixed(0) : 0;
    const tPct = okT + failT > 0 ? (okT / (okT + failT) * 100).toFixed(0) : 0;
    log.info(`${label} 完成 ${wallets.length}个钱包 | 持仓 ${okH}✓ ${failH}✗ (${hPct}%) | 交易 ${okT}✓ ${failT}✗ (${tPct}%) | ${elapsed}s`);
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
  log.info(`[analyzer] 开始分析 ${tokenAddress}`);

  const priceInfo = await getPriceInfo('501', tokenAddress);
  const minTradeUsd = Math.min(50, Math.max(0.01, parseFloat(priceInfo.marketCap ?? '0') / 10000));
  log.info(`市值: $${parseFloat(priceInfo.marketCap ?? '0').toFixed(0)}  最低成交过滤: $${minTradeUsd.toFixed(4)}`);

  const traderAddrs = await getTraderAddresses(tokenAddress, traderTopN, minTradeUsd);
  log.info(`近期交易者: ${traderAddrs.length} 人`);

  const holderAddrs = await getHolderAddresses(tokenAddress, holderTopN);
  log.info(`链上大户: ${holderAddrs.length} 个`);

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
