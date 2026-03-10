// 数据层：钱包交易历史 — Helius Enhanced Transactions API
import { heliusFetch } from './client.js';

const SOL_MINT = 'So11111111111111111111111111111111111111112';

/**
 * 钱包 SWAP 交易历史（Helius Enhanced Transactions）
 * @param {string} address
 * @param {string} _chainId  - 兼容 OKX 接口签名，Helius 固定 Solana
 * @param {number} limit     - 最多获取条数，Helius 单页上限 100
 * @returns {Array<{ tokenContractAddress, tokenSymbol, blockTime, tradeType, ... }>}
 */
export async function getWalletTradeHistory(address, _chainId = '501', limit = 100) {
  const cap  = Math.min(limit, 100);
  const data = await heliusFetch(
    `/v0/addresses/${address}/transactions?type=SWAP&limit=${cap}`,
  );

  const results = [];
  const seen    = new Set();

  for (const tx of (Array.isArray(data) ? data : [])) {
    const swap = tx.events?.swap;
    if (!swap) continue;

    const blockTime = (tx.timestamp ?? 0) * 1000;

    // 买入侧 = tokenOutputs，卖出侧 = tokenInputs
    const sides = [
      ...(swap.tokenInputs  ?? []).map(t => ({ mint: t.mint, type: 2 })),
      ...(swap.tokenOutputs ?? []).map(t => ({ mint: t.mint, type: 1 })),
    ];

    for (const { mint, type } of sides) {
      if (!mint || mint === SOL_MINT || seen.has(mint)) continue;
      seen.add(mint);
      results.push({
        tokenContractAddress: mint,
        tokenSymbol:          null,
        tokenName:            null,
        amount:               null,
        price:                null,
        blockTime,
        tradeType:            type,
        singleRealizedProfit: null,
        mcap:                 null,
      });
    }
  }

  return results.slice(0, limit);
}
