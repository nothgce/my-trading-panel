// 数据层：Solana RPC — 钱包历史交易记录，提取涉及代币合约地址
const RPC = 'https://api.mainnet-beta.solana.com';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function rpcCall(method, params) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const json = await res.json();
    if (json.error) throw json.error;
    return json.result;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * 获取钱包最近 N 笔交易，提取每笔涉及的 token mint（合约地址）
 * @param {string} address - 钱包地址（Solana base58）
 * @param {number} limit   - 最多获取条数，默认 100
 * @returns {Array<{
 *   signature: string,
 *   blockTime: number,
 *   tokenMints: string[]   // 该笔交易涉及的 token 合约地址（去重）
 * }>}
 */
export async function getTransactionHistory(address, limit = 100) {
  // Step 1: 拉签名列表
  const sigs = await rpcCall('getSignaturesForAddress', [
    address,
    { limit, commitment: 'confirmed' },
  ]);
  if (!sigs?.length) return [];

  // Step 2: 批量拉交易详情（每批 10 个，间隔 200ms 避免 429）
  const results = [];
  const BATCH = 10;
  for (let i = 0; i < sigs.length; i += BATCH) {
    const batch = sigs.slice(i, i + BATCH);
    const txBatch = await Promise.all(
      batch.map(s =>
        rpcCall('getTransaction', [
          s.signature,
          { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' },
        ]).catch(() => null)   // 单笔失败不影响整体
      )
    );

    for (let j = 0; j < batch.length; j++) {
      const sig = batch[j];
      const tx = txBatch[j];
      if (!tx) continue;

      // 从 preTokenBalances + postTokenBalances 提取涉及的 mint
      const pre  = tx.meta?.preTokenBalances  ?? [];
      const post = tx.meta?.postTokenBalances ?? [];
      const mints = new Set([
        ...pre.map(b => b.mint),
        ...post.map(b => b.mint),
      ]);

      results.push({
        signature: sig.signature,
        blockTime: sig.blockTime ?? tx.blockTime ?? null,
        tokenMints: [...mints],
      });
    }

    if (i + BATCH < sigs.length) await sleep(200);
  }

  return results;
}

/**
 * 从交易历史中提取唯一 token 合约地址集合
 * @param {Array} txHistory - getTransactionHistory 返回值
 * @returns {string[]}       - 去重后的 mint 地址列表
 */
export function extractUniqueMints(txHistory) {
  const mints = new Set();
  for (const tx of txHistory) {
    for (const mint of tx.tokenMints) mints.add(mint);
  }
  return [...mints];
}
