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
 * [规范化] 代币合约 → 近期交易的钱包地址数组
 * @param {string} tokenAddress
 * @param {number} limit        - 拉取笔数，默认 300
 * @param {number} minUsd       - 最低成交额过滤（USD），默认 10
 * @returns {Promise<string[]>} 去重钱包地址
 */
export async function getTraderAddresses(tokenAddress, topN = 100, minUsd = 10) {
  const trades = await getTrades('501', tokenAddress, 500); // 拉满 API 上限
  return [...new Set(
    trades
      .filter(t => t.userAddress && parseFloat(t.volume) >= minUsd)
      .map(t => t.userAddress)
  )].slice(0, topN);
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
    time: t.time,
    userAddress: t.userAddress,
    txHashUrl: t.txHashUrl,
  }));
}
