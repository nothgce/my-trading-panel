// 业务层：CA 分析 — 大户/交易者持仓聚类
import { getTraderAddresses } from '../data/okx/market.js';
import { getPriceInfo } from '../data/okx/token.js';
import { getHolderAddresses } from '../data/solana/holders.js';
import { getTopHoldings } from '../data/okx/portfolio.js';
import { getWalletTradeHistory } from '../data/okx/wallet.js';

const CONCURRENCY = 5;
const DELAY_MS = 250;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * 对一组钱包地址批量查持仓和交易记录，统计各代币出现人数
 * @param {string[]} wallets  - 钱包地址列表
 * @param {string}   excludeCA - 目标代币合约（排除自身）
 * @param {string}   label    - 进度标签
 * @returns {{ holdMap: Map, tradeMap: Map }}
 *   Map<contract, { symbol: string, count: number }>
 */
async function buildFrequencyMaps(wallets, excludeCA, label) {
  // contract → { symbol, wallets: Set<address> }
  const holdRaw  = new Map();
  const tradeRaw = new Map();

  const addTo = (map, contract, symbol, wallet) => {
    if (!contract || contract === excludeCA) return;
    if (!map.has(contract)) map.set(contract, { symbol: symbol || contract.slice(0, 8) + '…', wallets: new Set() });
    map.get(contract).wallets.add(wallet);
  };

  for (let i = 0; i < wallets.length; i += CONCURRENCY) {
    const batch = wallets.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async wallet => {
      try {
        const [holdings, trades] = await Promise.all([
          getTopHoldings(wallet, 20).catch(() => []),
          getWalletTradeHistory(wallet, '501', 100).catch(() => []),
        ]);
        for (const h of holdings)
          addTo(holdRaw, h.tokenContractAddress, h.symbol, wallet);

        // 同一钱包同一合约只计一次
        const seen = new Set();
        for (const t of trades) {
          if (seen.has(t.tokenContractAddress)) continue;
          seen.add(t.tokenContractAddress);
          addTo(tradeRaw, t.tokenContractAddress, t.tokenSymbol, wallet);
        }
      } catch { /* 单个钱包失败跳过 */ }
    }));

    if (label) process.stdout.write(`\r  ${label}: ${Math.min(i + CONCURRENCY, wallets.length)}/${wallets.length}`);
    if (i + CONCURRENCY < wallets.length) await sleep(DELAY_MS);
  }
  if (label) console.log();

  const flatten = raw => new Map(
    [...raw.entries()].map(([k, v]) => [k, { symbol: v.symbol, count: v.wallets.size }])
  );
  return { holdMap: flatten(holdRaw), tradeMap: flatten(tradeRaw) };
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
  const minTradeUsd = Math.max(0.01, parseFloat(priceInfo.marketCap ?? '0') / 10000);
  console.log(`  市值: $${parseFloat(priceInfo.marketCap ?? '0').toFixed(0)}, 最低成交过滤: $${minTradeUsd.toFixed(4)}`);

  process.stdout.write('  获取近期交易者（去重）...');
  const traderAddrs = await getTraderAddresses(tokenAddress, traderTopN, minTradeUsd);
  console.log(` ${traderAddrs.length} 人`);

  process.stdout.write('  获取前 N 大户（Solana RPC）...');
  const holderAddrs = await getHolderAddresses(tokenAddress, holderTopN);
  console.log(` ${holderAddrs.length} 个`);

  const [traders, holders] = await Promise.all([
    buildFrequencyMaps(traderAddrs, tokenAddress, '  交易者'),
    buildFrequencyMaps(holderAddrs, tokenAddress, '  大户'),
  ]);

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
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, n);
}
