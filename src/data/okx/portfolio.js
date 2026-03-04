// 数据层：钱包地址持仓查询
import { okxFetch } from './client.js';

/**
 * 钱包所有代币余额（CA 分析：批量查地址持仓）
 * @param {string} address - 钱包地址
 * @param {string} chains  - 逗号分隔的 chainIndex，默认 Solana
 * @returns {Array<{ symbol, balance, tokenPrice, tokenContractAddress, chainIndex }>}
 */
export async function getTokenBalances(address, chains = '501') {
  const qs = new URLSearchParams({ address, chains, excludeRiskToken: '0' });
  const path = `/api/v6/dex/balance/all-token-balances-by-address?${qs}`;
  const data = await okxFetch('GET', path);
  const assets = data[0]?.tokenAssets ?? [];
  return assets.map(a => ({
    symbol: a.symbol,
    balance: a.balance,
    tokenPrice: a.tokenPrice,
    tokenContractAddress: a.tokenContractAddress,
    chainIndex: a.chainIndex,
  }));
}

/**
 * [规范化] 钱包地址 → 持仓代币合约地址数组（按 USD 价值降序）
 * @param {string} walletAddress
 * @param {number} topN
 * @returns {Promise<string[]>}
 */
export async function getHoldingContracts(walletAddress, topN = 20) {
  const holdings = await getTopHoldings(walletAddress, topN);
  return holdings.map(h => h.tokenContractAddress).filter(Boolean);
}

/**
 * 钱包前 N 持仓代币，按 USD 价值降序（富数据）
 * @returns {Array<{ symbol, balance, tokenPrice, usdValue, tokenContractAddress, chainIndex }>}
 */
export async function getTopHoldings(address, topN = 20, chains = '501') {
  const assets = await getTokenBalances(address, chains);
  return assets
    .map(a => ({ ...a, usdValue: parseFloat(a.balance) * parseFloat(a.tokenPrice || '0') }))
    .sort((a, b) => b.usdValue - a.usdValue)
    .slice(0, topN);
}

/**
 * 钱包总资产价值（USD）
 * @returns {{ totalValue: string }}
 */
export async function getTotalValue(address, chains = '501') {
  const qs = new URLSearchParams({ address, chains, assetType: '0', excludeRiskToken: 'false' });
  const path = `/api/v6/dex/balance/total-value-by-address?${qs}`;
  const data = await okxFetch('GET', path);
  const item = Array.isArray(data) ? data[0] : data;
  return { totalValue: item.totalValue };
}
