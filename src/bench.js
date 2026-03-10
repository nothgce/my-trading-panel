// 速率压测：持仓 + 交易历史，找出最大并发和限速边界
import './proxy.js';
import { getWalletTokenList, getWalletTradeHistory } from './data/okx/wallet.js';
import { getHolderAddresses } from './data/solana/holders.js';

const CA = 'D7Z2fUrxECBh91chmnou8u7E9Yaq7inzzcjg9G1Apump';
console.log(`抓取 ${CA} 前100持仓地址...`);
const WALLETS = await getHolderAddresses(CA, 100);
console.log(`获得 ${WALLETS.length} 个地址\n`);

async function measure(label, fn) {
  const t = Date.now();
  try {
    await fn();
    return { ok: true, ms: Date.now() - t };
  } catch (err) {
    return { ok: false, ms: Date.now() - t, err: err?.msg ?? err?.message ?? String(err) };
  }
}

async function runBatch(wallets, concurrency) {
  const results = [];
  for (let i = 0; i < wallets.length; i += concurrency) {
    const batch = wallets.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(w =>
      Promise.all([
        measure('holdings', () => getWalletTokenList(w, '501', 50)),
        measure('trades',   () => getWalletTradeHistory(w, '501', 100)),
      ]).then(([h, t]) => ({ wallet: w.slice(0, 8), holdings: h, trades: t }))
    ));
    results.push(...batchResults);
  }
  return results;
}

function stats(times) {
  if (!times.length) return {};
  times.sort((a, b) => a - b);
  const avg = times.reduce((s, v) => s + v, 0) / times.length;
  return {
    min: times[0],
    p50: times[Math.floor(times.length * 0.5)],
    p90: times[Math.floor(times.length * 0.9)],
    max: times[times.length - 1],
    avg: Math.round(avg),
  };
}

function printResults(label, results) {
  const hTimes = results.filter(r => r.holdings.ok).map(r => r.holdings.ms);
  const tTimes = results.filter(r => r.trades.ok).map(r => r.trades.ms);
  const hFail  = results.filter(r => !r.holdings.ok).length;
  const tFail  = results.filter(r => !r.trades.ok).length;

  console.log(`\n── ${label} ──`);
  console.log(`  持仓  成功:${hTimes.length} 失败:${hFail}`, stats(hTimes), 'ms');
  console.log(`  交易  成功:${tTimes.length} 失败:${tFail}`, stats(tTimes), 'ms');

  const errors = results.flatMap(r => [
    r.holdings.ok ? null : `  [holdings] ${r.wallet}: ${r.holdings.err}`,
    r.trades.ok   ? null : `  [trades]   ${r.wallet}: ${r.trades.err}`,
  ].filter(Boolean));
  if (errors.length) console.log(errors.join('\n'));
}

// ── 顺序测试各并发级别 ────────────────────────────────────────
const levels = [1, 2, 3, 5, 8];

console.log(`测试钱包数: ${WALLETS.length}，并发级别: ${levels.join(', ')}`);
console.log('每个钱包同时查: 持仓 + 交易历史\n');

for (const c of levels) {
  const t0 = Date.now();
  const results = await runBatch(WALLETS, c);
  const elapsed = Date.now() - t0;
  const rps = (WALLETS.length * 2 / elapsed * 1000).toFixed(1); // 每钱包2个请求
  printResults(`并发=${c}  总耗时=${elapsed}ms  吞吐=${rps} req/s`, results);

  // 并发越高越需要冷却，避免污染下一轮
  if (c < levels[levels.length - 1]) await new Promise(r => setTimeout(r, 2000));
}
