// 数据层：代币元信息、大户地址、持仓分布
import { okxFetch } from './client.js';

/**
 * 价格 + 市值 + 涨跌幅 — 异动监控主力
 * @returns {{
 *   price, marketCap, liquidity,
 *   priceChange5M, priceChange1H, priceChange4H, priceChange24H,
 *   volume5M, volume1H, volume4H, volume24H,
 *   txs5M, txs4H
 * }}
 */
export async function getPriceInfo(chainIndex, tokenAddress) {
  const data = await okxFetch('POST', '/api/v6/dex/market/price-info', [
    { chainIndex: String(chainIndex), tokenContractAddress: tokenAddress },
  ]);
  const d = data[0];
  return {
    price: d.price,
    marketCap: d.marketCap,
    liquidity: d.liquidity,
    priceChange5M: d.priceChange5M,
    priceChange1H: d.priceChange1H,
    priceChange4H: d.priceChange4H,
    priceChange24H: d.priceChange24H,
    volume5M: d.volume5M,
    volume1H: d.volume1H,
    volume4H: d.volume4H,
    volume24H: d.volume24H,
    txs5M: d.tradeNum,   // API 字段对应 tradeNum（5m 粒度）
    txs4H: undefined,    // price-info 仅返回单个 tradeNum，无多时间窗口拆分
  };
}

/**
 * 前 N 大持仓地址（⚠ API 最多返回 20 条）
 * @returns {Array<{ holderWalletAddress, holdAmount, holdRatio }>}
 */
export async function getHolders(chainIndex, tokenAddress) {
  const qs = new URLSearchParams({
    chainIndex: String(chainIndex),
    tokenContractAddress: tokenAddress,
  });
  const path = `/api/v6/dex/market/token/holder?${qs}`;
  const data = await okxFetch('GET', path);
  return data.map(h => ({
    holderWalletAddress: h.holderWalletAddress,
    holdAmount: h.holdAmount,
  }));
}

/**
 * 持仓排行 v2（priapi，无条数上限限制）
 * 来源：web3.okx.com/token/solana/<CA> 页面
 * @param {string} tokenAddress
 * @param {string} chainId  - 默认 '501'（Solana）
 * @returns {Array<{
 *   holderWalletAddress, holdAmount, holdRatio,
 *   holdValue, rank, isContract
 * }>}
 */
export async function getHoldersV2(tokenAddress, chainId = '501') {
  const BASE = 'https://web3.okx.com';
  const qs = new URLSearchParams({
    chainId,
    tokenAddress,
    t: String(Date.now()),
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(
      `${BASE}/priapi/v1/dx/market/v2/holders/ranking-list-v2?${qs}`,
      {
        headers: {
          'accept': 'application/json',
          'app-type': 'web',
          'referer': `${BASE}/token/solana/${tokenAddress}`,
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'x-cdn': BASE,
        },
        signal: controller.signal,
      },
    );
    clearTimeout(timer);
    const j = await res.json();
    if (j.code !== 0) throw { code: j.code, msg: j.msg };
    const list = j.data?.list ?? j.data ?? [];
    return list.map(h => ({
      holderWalletAddress: h.walletAddress ?? h.holderWalletAddress,
      holdAmount:          h.amount        ?? h.holdAmount,
      holdRatio:           h.ratio         ?? h.holdRatio,
      holdValue:           h.value         ?? h.holdValue,
      rank:                h.rank,
      isContract:          h.isContract,
    }));
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * 按名称/符号/合约地址搜索代币
 * @param {string} chains - 逗号分隔的 chainIndex，如 '501' 或 '1,56'
 * @param {string} query  - 代币名称、符号或合约地址
 * @returns {Array<{ chainIndex, tokenContractAddress, tokenSymbol, tokenName, marketCap, price }>}
 */
export async function searchToken(chains, query) {
  const qs = new URLSearchParams({ chains, search: query });
  const path = `/api/v6/dex/market/token/search?${qs}`;
  const data = await okxFetch('GET', path);
  return data.map(t => ({
    chainIndex: t.chainIndex,
    tokenContractAddress: t.tokenContractAddress,
    tokenSymbol: t.tokenSymbol,
    tokenName: t.tokenName,
    marketCap: t.marketCap,
    price: t.price,
  }));
}
