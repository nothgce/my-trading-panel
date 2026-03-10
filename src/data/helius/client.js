// 数据层：Helius API 公共工具
// API key 从 SOLANA_RPC 环境变量中提取（如 https://mainnet.helius-rpc.com/?api-key=xxx）

const RPC     = process.env.SOLANA_RPC ?? '';
const API_KEY = (RPC.match(/api-key=([^&\s]+)/) ?? [])[1] ?? '';

export const HELIUS_REST = 'https://api.helius.xyz';

/** Helius REST API 请求 */
export async function heliusFetch(path) {
  const sep = path.includes('?') ? '&' : '?';
  const url  = `${HELIUS_REST}${path}${sep}api-key=${API_KEY}`;
  const ctrl = new AbortController();
  const t    = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error(`helius HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    clearTimeout(t);
    throw err;
  }
}

/** Helius JSON-RPC (DAS 等) */
export async function rpcCall(method, params) {
  const ctrl = new AbortController();
  const t    = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const json = await res.json();
    if (json.error) throw json.error;
    return json.result;
  } catch (err) {
    clearTimeout(t);
    throw err;
  }
}
