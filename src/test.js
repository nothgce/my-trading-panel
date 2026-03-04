import './proxy.js';
import crypto from 'crypto';

const { OKX_API_KEY, OKX_SECRET_KEY, OKX_PASSPHRASE } = process.env;

async function okxFetch(method, path, body) {
  const timestamp = new Date().toISOString();
  const bodyStr = body ? JSON.stringify(body) : '';
  const sign = crypto
    .createHmac('sha256', OKX_SECRET_KEY)
    .update(timestamp + method + path + bodyStr)
    .digest('base64');

  const res = await fetch(`https://web3.okx.com${path}`, {
    method,
    headers: {
      'OK-ACCESS-KEY': OKX_API_KEY,
      'OK-ACCESS-SIGN': sign,
      'OK-ACCESS-PASSPHRASE': OKX_PASSPHRASE,
      'OK-ACCESS-TIMESTAMP': timestamp,
      'Content-Type': 'application/json',
    },
    ...(body && { body: bodyStr }),
  });
  const json = await res.json();
  if (json.code !== '0') throw new Error(json.msg || `API error: ${json.code}`);
  return json.data;
}

const data = await okxFetch('POST', '/api/v6/dex/market/price', [
  { chainIndex: '501', tokenContractAddress: 'So11111111111111111111111111111111111111112' },
]);
console.log(`SOL: $${parseFloat(data[0].price).toFixed(2)}`);
