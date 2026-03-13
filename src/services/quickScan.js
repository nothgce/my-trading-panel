// 快速持仓聚类扫描（四分之一 /ca：只查持仓者持仓，不查交易者和交易历史）
// 逻辑：取前 100 大持仓者 → 查各自当前持仓代币 → 统计共同持有 → 阈值 >8 人则报警

import { getHolderAddresses } from '../data/solana/holders.js';
import { getWalletTokenList } from '../data/okx/wallet.js';
import { log } from '../logger.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

const HOLDER_TOP_N = 100;  // 前 100 大持仓者（只查持仓，不查交易历史）
const MIN_CLUSTER  = 8;    // 超过 8 人才触发（即 ≥ 9）
const DELAY_MS     = 700;  // OKX API 请求间隔

// Solana 链上稳定币 + Wrapped SOL 合约地址（大写对比不敏感，直接用 Set）
const STABLE_AND_SOL = new Set([
  'So11111111111111111111111111111111111111112',   // Wrapped SOL
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',  // USDT
  'USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA',   // USDS
  '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo',  // PYUSD
  'USDH1SM1ojwWUga67PGrgFWUHibbjqMvuMaDkRJTgkX',   // USDH
  'EjmyN6qEC1Tf1JxiG1ae7UTJhUxSwk1TCWNWqxWV4J6o',  // USDY (Ondo)
]);

// 防止同一代币在 10 分钟内被重复扫描
const recentlyScanned = new Map(); // ca -> timestamp

async function withRetry(fn, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (err) {
      if (i >= attempts - 1) break;
      const is429 = String(err?.msg ?? err?.message ?? '').includes('429');
      await sleep(is429 ? 15_000 : 800 * 2 ** i);
    }
  }
  return null;
}

/**
 * 对一个代币的前25大持仓者做持仓聚类
 * @param {string} tokenAddress  - 目标代币合约
 * @param {string} tokenSymbol   - 代币符号（用于日志/输出）
 * @param {(clusters: Array<{ca,symbol,count}>) => void} onCluster
 *        发现聚类时的回调，clusters 已按 count 降序
 */
export async function quickScan(tokenAddress, tokenSymbol, onCluster) {
  // 去重：10 分钟内不重复扫描同一代币
  const now = Date.now();
  const lastScan = recentlyScanned.get(tokenAddress);
  if (lastScan && now - lastScan < 60 * 60 * 1000) return;
  recentlyScanned.set(tokenAddress, now);

  // 清理过期记录，避免 Map 无限增长
  for (const [ca, ts] of recentlyScanned) {
    if (now - ts > 60 * 60 * 1000) recentlyScanned.delete(ca);
  }

  log.info(`[quickScan] 开始 $${tokenSymbol} (${tokenAddress.slice(0, 8)}...)`);

  // Step 1: 获取前 25 大持仓者
  let holders;
  try {
    holders = await getHolderAddresses(tokenAddress, HOLDER_TOP_N);
  } catch (e) {
    log.warn(`[quickScan] $${tokenSymbol} 持仓者获取失败: ${e?.message ?? e}`);
    return;
  }
  if (!holders.length) return;

  // Step 2: 依次查每个持仓者的代币持仓
  // tokenMap: contract -> { symbol, wallets: Set<walletAddr> }
  const tokenMap = new Map();

  for (const wallet of holders) {
    await sleep(DELAY_MS);
    const holdings = await withRetry(() => getWalletTokenList(wallet, '501', 50));
    if (!holdings) continue;

    for (const h of holdings) {
      const ca = h.tokenContractAddress;
      if (!ca || ca === tokenAddress) continue;           // 排除目标代币本身
      if (STABLE_AND_SOL.has(ca)) continue;              // 排除 SOL / 稳定币

      if (!tokenMap.has(ca)) {
        tokenMap.set(ca, {
          symbol: h.tokenSymbol || ca.slice(0, 8) + '…',
          wallets: new Set(),
          totalUsd: 0,
        });
      }
      const entry = tokenMap.get(ca);
      entry.wallets.add(wallet);
      entry.totalUsd += parseFloat(h.balanceUsd || '0');
    }
  }

  // Step 3: 筛选 >8 人共持的代币，按人数降序
  const clusters = [...tokenMap.entries()]
    .map(([ca, v]) => ({ ca, symbol: v.symbol, count: v.wallets.size, totalUsd: v.totalUsd }))
    .filter(r => r.count > MIN_CLUSTER)
    .sort((a, b) => b.count - a.count);

  if (!clusters.length) {
    log.info(`[quickScan] $${tokenSymbol}: 无聚类`);
    return;
  }

  log.info(`[quickScan] $${tokenSymbol}: 发现 ${clusters.length} 个聚类代币`);
  onCluster(clusters);
}
