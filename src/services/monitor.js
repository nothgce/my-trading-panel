// 业务层：异动监控 — 轮询价格，触发告警
import { getPriceInfo } from '../data/okx/token.js';
import { alertConfig } from '../config/alerts.js';

const POLL_INTERVAL_MS = 30_000; // 轮询间隔

// window 字段 → getPriceInfo 返回字段映射
const WINDOW_FIELD = {
  '5m':  'priceChange5M',
  '1h':  'priceChange1H',
  '4h':  'priceChange4H',
  '24h': 'priceChange24H',
};

/** @type {Map<string, { chainIndex: string, tokenAddress: string }>} */
const watched = new Map();

let timer = null;
let alertCallback = null;

function tokenKey(chainIndex, tokenAddress) {
  return `${chainIndex}:${tokenAddress}`;
}

/** 添加监控代币 */
export function addToken(chainIndex, tokenAddress) {
  const key = tokenKey(chainIndex, tokenAddress);
  watched.set(key, { chainIndex: String(chainIndex), tokenAddress });
  console.log(`[monitor] +watch ${key}`);
}

/** 移除监控代币 */
export function removeToken(chainIndex, tokenAddress) {
  const key = tokenKey(chainIndex, tokenAddress);
  watched.delete(key);
  console.log(`[monitor] -watch ${key}`);
}

/** 当前监控列表 */
export function listTokens() {
  return [...watched.values()];
}

/**
 * 启动监控
 * @param {(token: object, info: object, triggered: object) => void} onAlert
 */
export function start(onAlert, intervalMs = POLL_INTERVAL_MS) {
  if (timer) return;
  alertCallback = onAlert;
  console.log(`[monitor] started, interval=${intervalMs}ms`);
  _poll();
  timer = setInterval(_poll, intervalMs);
}

/** 停止监控 */
export function stop() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  console.log('[monitor] stopped');
}

async function _poll() {
  if (watched.size === 0) return;
  for (const [key, token] of watched) {
    try {
      await _checkToken(key, token);
    } catch (err) {
      console.error(`[monitor] error checking ${key}:`, err?.msg ?? err?.message ?? err);
    }
  }
}

async function _checkToken(key, { chainIndex, tokenAddress }) {
  const info = await getPriceInfo(chainIndex, tokenAddress);

  // 市值过滤
  if (parseFloat(info.marketCap) < alertConfig.minMarketCap) return;

  // token age：OKX price-info / search 均不提供首次交易时间，暂跳过
  // alertConfig.minTokenAgHours 留作后续接 Solana RPC 补充

  // 检查每条涨幅规则，满足任意一条即告警（每轮只触发一次）
  for (const rule of alertConfig.priceAlerts) {
    const field = WINDOW_FIELD[rule.window];
    if (!field) continue;

    const change = parseFloat(info[field] ?? '0');
    if (change < rule.changePercent) continue;

    alertCallback?.({ chainIndex, tokenAddress }, info, rule);
    return;
  }
}
