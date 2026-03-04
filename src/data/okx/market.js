// 数据层：价格、K线、成交记录
import { okxFetch } from './client.js';

/**
 * 实时价格（单个代币）
 * @returns {{ price: string, time: string }}
 */
export async function getPrice(chainIndex, tokenAddress) {
  const data = await okxFetch('POST', '/api/v6/dex/market/price', [
    { chainIndex: String(chainIndex), tokenContractAddress: tokenAddress },
  ]);
  const item = data[0];
  return { price: item.price, time: item.time };
}

/**
 * K线数据（用于价格历史对比）
 * @param {string} bar  - '1s'|'1m'|'5m'|'1H'|'1D' 等
 * @param {number} limit - 最多 299
 * @returns {Array<{ ts, open, high, low, close, vol, volUsd }>}
 */
export async function getCandles(chainIndex, tokenAddress, bar = '5m', limit = 10) {
  const qs = new URLSearchParams({
    chainIndex: String(chainIndex),
    tokenContractAddress: tokenAddress,
    bar,
    limit: String(limit),
  });
  const path = `/api/v6/dex/market/candles?${qs}`;
  const data = await okxFetch('GET', path);
  return data.map(([ts, open, high, low, close, vol, volUsd]) => ({
    ts, open, high, low, close, vol, volUsd,
  }));
}

// ─── 刷量检测 ─────────────────────────────────────────────────────────────────

function isBuy(type)  { return type === 'buy'  || type === 1 || type === '1'; }
function isSell(type) { return type === 'sell' || type === 2 || type === '2'; }

/**
 * 检测孤立买卖（刷量）钱包
 * 定义：一笔买入与其对应的卖出之间，没有任何其他钱包的交易介入
 * @param {Array} trades - 按时间升序排列的交易列表
 * @returns {Set<string>} 疑似刷量的钱包地址集合
 */
// 买卖数量是否相符（允许 1% 误差，兼容手续费）
function amountsMatch(buyAmt, sellAmt) {
  const a = parseFloat(buyAmt ?? '0');
  const b = parseFloat(sellAmt ?? '0');
  if (a === 0 || b === 0) return false;
  return Math.abs(a - b) / Math.max(a, b) < 0.01;
}

function detectWashTraders(trades) {
  // wallet → { hasOtherTrader: boolean, buyAmount: string }
  const state = new Map();
  const washTraders = new Set();

  for (const { userAddress: w, type, amount } of trades) {
    if (!w) continue;

    // 当前交易通知其他所有"开仓中"的钱包：有外人介入了
    for (const [wallet, s] of state) {
      if (wallet !== w) s.hasOtherTrader = true;
    }

    if (isBuy(type)) {
      state.set(w, { hasOtherTrader: false, buyAmount: amount });
    } else if (isSell(type) && state.has(w)) {
      const { hasOtherTrader, buyAmount } = state.get(w);
      if (!hasOtherTrader && amountsMatch(buyAmount, amount)) {
        washTraders.add(w); // 孤立 + 数量相符 → 刷量
      }
      state.delete(w);
    }
  }

  return washTraders;
}

// ─── 规范化接口 ───────────────────────────────────────────────────────────────

/**
 * 代币合约 → 近期真实交易者地址数组（去重 + 过滤刷量）
 * @param {string} tokenAddress
 * @param {number} topN    - 最多返回人数，默认 100
 * @param {number} minUsd  - 最低成交额（USD）
 * @returns {Promise<string[]>}
 */
export async function getTraderAddresses(tokenAddress, topN = 100, minUsd = 10) {
  const trades = await getTrades('501', tokenAddress, 500);

  // 升序排列后检测刷量（API 返回为降序）
  const sorted = [...trades].sort((a, b) => Number(a.time) - Number(b.time));
  const washTraders = detectWashTraders(sorted);

  const valid = trades.filter(
    t => t.userAddress && parseFloat(t.volume) >= minUsd && !washTraders.has(t.userAddress),
  );

  return [...new Set(valid.map(t => t.userAddress))].slice(0, topN);
}

/**
 * 近期成交记录（提取活跃交易地址）
 * @param {number} limit - 最多 500
 * @returns {Array<{ type, price, volume, time, userAddress, txHashUrl }>}
 */
export async function getTrades(chainIndex, tokenAddress, limit = 100) {
  const qs = new URLSearchParams({
    chainIndex: String(chainIndex),
    tokenContractAddress: tokenAddress,
    limit: String(limit),
  });
  const path = `/api/v6/dex/market/trades?${qs}`;
  const data = await okxFetch('GET', path);
  return data.map(t => ({
    type: t.type,
    price: t.price,
    volume: t.volume,      // USD 金额
    amount: t.amount,      // 代币数量
    time: t.time,
    userAddress: t.userAddress,
    txHashUrl: t.txHashUrl,
  }));
}
