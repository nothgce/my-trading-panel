import './proxy.js';
import { getPrice, getCandles, getTrades } from './data/okx/market.js';
import { getPriceInfo, getHolders, searchToken } from './data/okx/token.js';
import { getTokenBalances, getTotalValue } from './data/okx/portfolio.js';

const CHAIN = '501';
const SOL   = 'So11111111111111111111111111111111111111112';

// ── market.js ──────────────────────────────────────────────
const price = await getPrice(CHAIN, SOL);
console.log('getPrice:   ', price);

const candles = await getCandles(CHAIN, SOL, '5m', 3);
console.log('getCandles: ', candles[0]);

const trades = await getTrades(CHAIN, SOL, 3);
console.log('getTrades:  ', trades[0]);

// ── token.js ───────────────────────────────────────────────
const info = await getPriceInfo(CHAIN, SOL);
console.log('getPriceInfo:', {
  price: info.price,
  marketCap: info.marketCap,
  priceChange5M: info.priceChange5M,
  priceChange4H: info.priceChange4H,
});

const holders = await getHolders(CHAIN, SOL);
console.log('getHolders: ', holders[0]);

const found = await searchToken(CHAIN, 'SOL');
console.log('searchToken:', found[0]);

// ── portfolio.js ───────────────────────────────────────────
// 用一个公开的 Solana 地址测试（Binance 热钱包）
const WALLET = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const balances = await getTokenBalances(WALLET, CHAIN);
console.log('getTokenBalances:', balances.slice(0, 2));

const total = await getTotalValue(WALLET, CHAIN);
console.log('getTotalValue:', total);
