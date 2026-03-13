// 业务层：查小号
// 思路：大号买入的代币 → 对每个代币从目标买入时刻往前翻页（最多10页）
//       → 收集仍持仓的早买者（buy_vol > sell_vol）→ 统计跨代币共现地址
import { getWalletBuyHistory } from '../data/okx/wallet.js';
import { okxFetch } from '../data/okx/client.js';
import { log } from '../logger.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const DELAY = 400;
const MAX_PAGES = 10;
const PAGE_SIZE = 500;
// getWalletTradeHistory.blockTime 比 getTrades.time 约早 1s，加缓冲确保目标 TX 落在范围内
const TIME_BUFFER = 30_000;

/**
 * @param {string} target      - 大号钱包地址
 * @param {number} tokenLimit  - 最多分析几个代币，默认 20
 * @returns {Array<{
 *   wallet, preBuyCount, totalCount, ratio
 * }>} 按共现代币数排序
 */
export async function findAltWallets(target, tokenLimit = 20) {
  // ── Step 1: 大号买入历史 → token + 最早买入时间 ───────────────────────────
  log.info(`[altFinder] 开始分析 ${target.slice(0, 12)}...`);
  const history = await getWalletBuyHistory(target, '501', tokenLimit);

  const buyMap = new Map(); // token → { blockTime, symbol }
  for (const t of history) {
    if (t.tradeType !== 1) continue;
    const ca = t.tokenContractAddress;
    if (!buyMap.has(ca) || t.blockTime < buyMap.get(ca).blockTime) {
      buyMap.set(ca, { blockTime: t.blockTime, symbol: t.tokenSymbol });
    }
  }

  const tokens = [...buyMap.entries()].slice(0, tokenLimit);
  log.info(`[altFinder] 买入代币 ${tokens.length} 个`);
  if (!tokens.length) return [];

  // ── Step 2: 每个 token 从目标买入时刻往前翻页，收集仍持仓的早买者 ──────────
  // walletTokens: wallet → Set<token>（在多少个代币上比目标早买入且仍持仓）
  const walletTokens = new Map();

  for (const [token, { blockTime: targetBuyTime, symbol }] of tokens) {
    // netPos: wallet → { buy, sell }（目标买入前的净持仓）
    const netPos = new Map();
    let pageAfter = String(Number(targetBuyTime) + TIME_BUFFER);
    let pages = 0;

    while (pages < MAX_PAGES) {
      await sleep(DELAY);
      const qs = new URLSearchParams({
        chainIndex: '501',
        tokenContractAddress: token,
        limit: String(PAGE_SIZE),
        after: pageAfter,
      });

      let trades;
      try {
        trades = await okxFetch('GET', '/api/v6/dex/market/trades?' + qs);
      } catch (err) {
        log.warn(`[altFinder] getTrades ${symbol} page${pages + 1} 失败: ${err?.msg ?? err?.message}`);
        break;
      }

      if (!trades.length) break;
      pages++;

      for (const tr of trades) {
        const w = tr.userAddress;
        if (!w || w === target) continue;
        if (Number(tr.time) >= Number(targetBuyTime)) continue; // 只要目标买入之前的
        if (!netPos.has(w)) netPos.set(w, { buy: 0, sell: 0 });
        const vol = parseFloat(tr.volume) || 0;
        if (tr.type === 'buy') netPos.get(w).buy += vol;
        else                   netPos.get(w).sell += vol;
      }

      // 最旧一条的时间作为下一页 after
      pageAfter = trades[trades.length - 1].time;
    }

    // 过滤：必须有买入且净持仓 > 0（未清仓）
    const stillHolding = [...netPos.entries()]
      .filter(([, p]) => p.buy > 0 && p.buy > p.sell)
      .map(([w]) => w);

    log.info(`[altFinder] ${symbol ?? token.slice(0, 8)}: ${pages}页, 早买且持仓 ${stillHolding.length} 个`);

    for (const w of stillHolding) {
      if (!walletTokens.has(w)) walletTokens.set(w, new Set());
      walletTokens.get(w).add(token);
    }
  }

  // ── Step 3: 过滤共现比例 ≥75%，排序输出 ─────────────────────────────────
  const total = tokens.length;
  const results = [...walletTokens.entries()]
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, 20)
    .map(([wallet, s]) => ({
      wallet,
      preBuyCount: s.size,
      totalCount:  total,
      ratio:       Math.round(s.size / total * 100),
    }));

  log.info(`[altFinder] 完成，候选 ${results.length} 个`);
  return results;
}
