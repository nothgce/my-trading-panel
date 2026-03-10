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

/**
 * 历史 K 线（priapi，支持任意时间起点，无需签名）
 * 与 getCandles 的区别：可通过 after 参数获取任意历史时段数据
 * @param {string} tokenAddress
 * @param {string} chainId   - 默认 '501'（Solana）
 * @param {number} after     - 起始时间戳（ms），返回该时间点之后的 K 线
 * @param {string} bar       - 粒度: '1m'|'5m'|'15m'|'1H'|'4H'|'1D'
 * @param {number} limit     - 最多返回条数
 * @returns {Array<{ ts, open, high, low, close, vol, volUsd }>}
 */
export async function getHistoryCandles(tokenAddress, chainId = '501', after, bar = '1m', limit = 100) {
  const BASE = 'https://web3.okx.com';
  const qs = new URLSearchParams({
    chainId, address: tokenAddress,
    bar, limit: String(limit),
    t: String(Date.now()),
    ...(after != null ? { after: String(after) } : {}),
  });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(
      `${BASE}/priapi/v5/dex/token/market/history-dex-token-hlc-candles?${qs}`,
      {
        headers: {
          'accept': 'application/json',
          'app-type': 'web',
          'referer': `${BASE}/token/solana/${tokenAddress}`,
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'x-cdn': BASE,
        },
        signal: ctrl.signal,
      },
    );
    clearTimeout(timer);
    const j = await res.json();
    if (j.code !== 0) throw { code: j.code, msg: j.msg };
    return (j.data ?? []).map(([ts, open, high, low, close, vol, volUsd]) => ({
      ts, open, high, low, close, vol, volUsd,
    }));
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
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
