import crypto from 'crypto';

const BASE_URL = 'https://web3.okx.com';

function sign(timestamp, method, pathWithQuery, bodyStr) {
  const msg = timestamp + method + pathWithQuery + bodyStr;
  return crypto.createHmac('sha256', process.env.OKX_SECRET_KEY).update(msg).digest('base64');
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * @param {'GET'|'POST'} method
 * @param {string} path  - e.g. '/api/v6/dex/market/price'
 * @param {object|null} body  - POST body object; GET params via ?query in path
 * @param {{ retries?: number }} opts
 */
export async function okxFetch(method, path, body = null, { retries = 1 } = {}) {
  const bodyStr = body ? JSON.stringify(body) : '';
  const timestamp = new Date().toISOString();
  const signature = sign(timestamp, method, path, bodyStr);

  const headers = {
    'Content-Type': 'application/json',
    'OK-ACCESS-KEY': process.env.OKX_API_KEY,
    'OK-ACCESS-SIGN': signature,
    'OK-ACCESS-PASSPHRASE': process.env.OKX_PASSPHRASE,
    'OK-ACCESS-TIMESTAMP': timestamp,
  };

  let attempt = 0;
  while (true) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(BASE_URL + path, {
        method,
        headers,
        body: bodyStr || undefined,
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        if (attempt < retries) {
          attempt++;
          await sleep(500);
          continue;
        }
        throw new Error(`HTTP ${res.status}`);
      }

      const json = await res.json();
      if (json.code !== '0') throw { code: json.code, msg: json.msg };
      return json.data;
    } catch (err) {
      clearTimeout(timer);
      if (attempt < retries && err?.code === undefined) { // network / timeout, retry
        attempt++;
        await sleep(500);
        continue;
      }
      throw err;
    }
  }
}
