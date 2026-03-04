// 数据层：代币 Top-100 交易者（PnL 排行）— 内部接口，无需 API 签名
const BASE = 'https://web3.okx.com';

/**
 * 代币盈利排行前 100 交易者
 * @param {string} chainId        - 链 ID，如 '501'（Solana）
 * @param {string} tokenAddress   - 代币合约地址
 * @returns {Array<{
 *   holderWalletAddress, holdAmount, holdAmountPercentage,
 *   realizedProfit, realizedProfitPercentage,
 *   unrealizedProfit, unrealizedProfitPercentage,
 *   totalProfit, totalProfitPercentage,
 *   buyCount, buyValue, sellCount, sellValue,
 *   fundingSourceAddress, tagList, lastTradeTime
 * }>}
 */
export async function getTopTraders(chainId, tokenAddress) {
  const qs = new URLSearchParams({
    chainId: String(chainId),
    tokenContractAddress: tokenAddress,
    t: String(Date.now()),
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(`${BASE}/priapi/v1/dx/market/v2/pnl/top-trader/ranking-list?${qs}`, {
      headers: {
        'accept': 'application/json',
        'app-type': 'web',
        'referer': `${BASE}/token/solana/${tokenAddress}`,
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'x-cdn': BASE,
      },
      signal: controller.signal,
    });

    clearTimeout(timer);
    const json = await res.json();
    if (json.code !== 0) throw { code: json.code, msg: json.msg };

    return (json.data?.list ?? []).map(t => ({
      holderWalletAddress: t.holderWalletAddress,
      holdAmount: t.holdAmount,
      holdAmountPercentage: t.holdAmountPercentage,
      realizedProfit: t.realizedProfit,
      realizedProfitPercentage: t.realizedProfitPercentage,
      unrealizedProfit: t.unrealizedProfit,
      unrealizedProfitPercentage: t.unrealizedProfitPercentage,
      totalProfit: t.totalProfit,
      totalProfitPercentage: t.totalProfitPercentage,
      buyCount: t.buyCount,
      buyValue: t.buyValue,
      sellCount: t.sellCount,
      sellValue: t.sellValue,
      fundingSourceAddress: t.fundingSourceAddress,
      tagList: t.tagList ?? [],
      lastTradeTime: t.lastTradeTime,
    }));
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}
