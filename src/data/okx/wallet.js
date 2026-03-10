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

  const results = [];
  let blockTimeMax = now + 24 * 60 * 60 * 1000;

  while (results.length < limit) {
    const data = await fetchPage(walletAddress, chainId, 100, null, blockTimeMin, blockTimeMax);
    const rows = data?.rows ?? [];
    if (!rows.length) break;
    results.push(...rows);
    if (!data.hasNext || rows.length < 100) break;
    blockTimeMax = Number(rows[rows.length - 1].blockTime) - 1;
  }

  return results.slice(0, limit).map(r => ({
    tokenContractAddress: r.tokenContractAddress,
    tokenSymbol: r.tokenSymbol,
    tokenName: r.tokenName,
    amount: r.amount,
    price: r.price,
    blockTime: r.blockTime,
    tradeType: r.type,               // 1=buy, 2=sell
    singleRealizedProfit: r.singleRealizedProfit,
    mcap: r.mcap,
  }));
}

/**
 * 钱包买入历史，翻页直到凑够 minBuyTokens 个唯一代币（或无更多数据）
 * @param {string} walletAddress
 * @param {string} chainId
 * @param {number} minBuyTokens  - 目标唯一买入代币数，默认 20
 * @param {number} daysBack      - 往前查几天，默认 365 天
 * @returns {Array<{ tokenContractAddress, tokenSymbol, blockTime, tradeType }>}
 */
export async function getWalletBuyHistory(walletAddress, chainId = '501', minBuyTokens = 20, daysBack = 365) {
  const now = Date.now();
  const blockTimeMin = now - daysBack * 24 * 60 * 60 * 1000;

  const results = [];
  const buyTokensSeen = new Set();
  let blockTimeMax = now + 24 * 60 * 60 * 1000;

  while (buyTokensSeen.size < minBuyTokens) {
    const data = await fetchPage(walletAddress, chainId, 100, null, blockTimeMin, blockTimeMax);
    const rows = data?.rows ?? [];
    if (!rows.length) break;
    results.push(...rows);
    rows.filter(r => r.type === 1).forEach(r => buyTokensSeen.add(r.tokenContractAddress));
    if (!data.hasNext || rows.length < 100) break;
    blockTimeMax = Number(rows[rows.length - 1].blockTime) - 1;
  }

  return results.map(r => ({
    tokenContractAddress: r.tokenContractAddress,
    tokenSymbol: r.tokenSymbol,
    blockTime: r.blockTime,
    tradeType: r.type,
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
 * 钱包持仓代币列表（priapi，含盈亏数据，无需签名）
 * 来源：web3.okx.com/portfolio/<addr>/analysis
 * @param {string} walletAddress
 * @param {string} chainId    - 默认 '501'（Solana）
 * @param {number} limit      - 最多返回条数，默认 50
 * @returns {Array<{
 *   tokenContractAddress, tokenSymbol,
 *   balance, balanceUsd,
 *   buyVolume, sellVolume,
 *   buyAvgPrice, sellAvgPrice,
 *   realizedPnl, unrealizedPnl,
 *   totalPnl, totalPnlPercentage,
 *   totalTxBuy, totalTxSell
 * }>}
 */
export async function getWalletTokenList(walletAddress, chainId = '501', limit = 50) {
  const qs = new URLSearchParams({
    walletAddress, chainId,
    isAsc: 'false', sortType: '1',
    offset: '0', limit: String(limit),
    filterRisk: 'true', filterSmallBalance: 'false',
    t: String(Date.now()),
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${BASE}/priapi/v1/dx/market/v2/pnl/token-list?${qs}`, {
      headers: {
        'accept': 'application/json',
        'app-type': 'web',
        'referer': `${BASE}/portfolio/${walletAddress}/analysis`,
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'x-cdn': BASE,
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    const j = await res.json();
    if (j.code !== 0) throw { code: j.code, msg: j.msg };
    return (j.data?.tokenList ?? []).map(t => ({
      tokenContractAddress: t.tokenContractAddress,
      tokenSymbol:          t.tokenSymbol,
      balance:              t.balance,
      balanceUsd:           t.balanceUsd,
      buyVolume:            t.buyVolume,
      sellVolume:           t.sellVolume,
      buyAvgPrice:          t.buyAvgPrice,
      sellAvgPrice:         t.sellAvgPrice,
      realizedPnl:          t.realizedPnl,
      unrealizedPnl:        t.unrealizedPnl,
      totalPnl:             t.totalPnl,
      totalPnlPercentage:   t.totalPnlPercentage,
      totalTxBuy:           t.totalTxBuy,
      totalTxSell:          t.totalTxSell,
    }));
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * 从交易历史中提取唯一 token 合约地址（工具函数）
 * @returns {string[]}
 */
export function extractUniqueContracts(tradeHistory) {
  return [...new Set(tradeHistory.map(r => r.tokenContractAddress).filter(Boolean))];
}

/**
 * 钱包盈亏摘要
 * @param {string} walletAddress
 * @param {string} chainId    - 默认 '501'（Solana）
 * @param {number} periodType - 1=1d 2=7d 3=30d 4=90d 5=全部
 * @returns {{
 *   totalProfit, totalProfitRate,
 *   realizedProfit, unrealizedProfit,
 *   totalInvest, winRate, tradeCount
 * }}
 */
export async function getWalletSummary(walletAddress, chainId = '501', periodType = 5) {
  const qs = new URLSearchParams({
    walletAddress, chainId,
    periodType: String(periodType),
    t: String(Date.now()),
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${BASE}/priapi/v1/dx/market/v2/pnl/wallet-profile/summary?${qs}`, {
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
    const d = j.data ?? {};
    return {
      totalProfit:      d.totalProfit,
      totalProfitRate:  d.totalProfitRate,
      realizedProfit:   d.realizedProfit,
      unrealizedProfit: d.unrealizedProfit,
      totalInvest:      d.totalInvest,
      winRate:          d.winRate,
      tradeCount:       d.tradeCount,
    };
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}
