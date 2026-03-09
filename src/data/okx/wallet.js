// 数据层：钱包交易历史 — OKX 内部接口，无需签名
const BASE = 'https://web3.okx.com';

async function fetchPage(walletAddress, chainId, pageSize, cursor, blockTimeMin, blockTimeMax) {
  const qs = new URLSearchParams({
    walletAddress, chainId, pageSize: String(pageSize),
    tradeType: '1,2', filterRisk: 'true',
    blockTimeMin: String(blockTimeMin), blockTimeMax: String(blockTimeMax),
    t: String(Date.now()),
    ...(cursor ? { cursor } : {}),
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${BASE}/priapi/v1/dx/market/v2/pnl/wallet-profile/trade-history?${qs}`, {
      headers: {
        'accept': 'application/json',
        'app-type': 'web',
        'referer': `${BASE}/portfolio/${walletAddress}/history`,
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'x-cdn': BASE,
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    const j = await res.json();
    if (j.code !== 0) throw { code: j.code, msg: j.msg };
    return j.data;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * 钱包交易历史（翻页直到满足 limit 或无更多数据）
 * @param {string} walletAddress
 * @param {string} chainId       - 如 '501'（Solana）
 * @param {number} limit         - 最多获取条数，默认 100
 * @param {number} daysBack      - 往前查几天，默认 180 天
 * @returns {Array<{
 *   tokenContractAddress, tokenSymbol, tokenName,
 *   amount, price, blockTime, tradeType,
 *   singleRealizedProfit, mcap
 * }>}
 */
export async function getWalletTradeHistory(walletAddress, chainId = '501', limit = 100, daysBack = 180) {
  const now = Date.now();
  const blockTimeMin = now - daysBack * 24 * 60 * 60 * 1000;
  const blockTimeMax = now + 24 * 60 * 60 * 1000;

  // 单页拉取，pageSize 直接等于 limit，省去分页循环
  const data = await fetchPage(walletAddress, chainId, limit, null, blockTimeMin, blockTimeMax);
  const results = data?.rows ?? [];

  return results.slice(0, limit).map(r => ({
    tokenContractAddress: r.tokenContractAddress,
    tokenSymbol: r.tokenSymbol,
    tokenName: r.tokenName,
    amount: r.amount,
    price: r.price,
    blockTime: r.blockTime,
    tradeType: r.tradeType,          // 1=buy, 2=sell
    singleRealizedProfit: r.singleRealizedProfit,
    mcap: r.mcap,
  }));
}

/**
 * [规范化] 钱包地址 → 历史交易涉及的唯一代币合约地址数组
 * 唯一标识使用 tokenContractAddress，不依赖 symbol/name
 * @param {string} walletAddress
 * @param {number} limit          - 最多获取笔数，默认 100
 * @returns {Promise<string[]>}
 */
export async function getTradeContracts(walletAddress, limit = 100) {
  const trades = await getWalletTradeHistory(walletAddress, '501', limit);
  return [...new Set(trades.map(r => r.tokenContractAddress).filter(Boolean))];
}

/**
 * 从交易历史中提取唯一 token 合约地址（工具函数）
 * @returns {string[]}
 */
export function extractUniqueContracts(tradeHistory) {
  return [...new Set(tradeHistory.map(r => r.tokenContractAddress).filter(Boolean))];
}
