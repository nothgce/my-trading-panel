// 数据层：钱包持仓查询 — Helius DAS getAssetsByOwner
import { rpcCall } from './client.js';

/**
 * 钱包前 N 持仓（Helius DAS，含 symbol / price / usdValue）
 * @param {string} address
 * @param {number} topN
 * @returns {Array<{ symbol, balance, tokenPrice, usdValue, tokenContractAddress, chainIndex }>}
 */
export async function getTopHoldings(address, topN = 20) {
  const result = await rpcCall('getAssetsByOwner', {
    ownerAddress: address,
    page: 1,
    limit: 1000,
    displayOptions: { showFungible: true, showNativeBalance: false },
  });

  const items = result?.items ?? [];
  return items
    .filter(a => a.interface === 'FungibleToken' || a.interface === 'FungibleAsset')
    .map(a => {
      const ti       = a.token_info ?? {};
      const decimals = ti.decimals ?? 0;
      const balance  = (ti.balance ?? 0) / Math.pow(10, decimals);
      const price    = ti.price_info?.price_per_token ?? 0;
      const usdValue = ti.price_info?.total_price ?? (balance * price);
      const symbol   = ti.symbol
        || a.content?.metadata?.symbol
        || a.id.slice(0, 8) + '…';
      return {
        symbol,
        balance: String(balance),
        tokenPrice: String(price),
        usdValue,
        tokenContractAddress: a.id,
        chainIndex: '501',
      };
    })
    .filter(t => t.usdValue > 0)
    .sort((a, b) => b.usdValue - a.usdValue)
    .slice(0, topN);
}
