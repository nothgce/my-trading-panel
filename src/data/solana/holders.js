// 数据层：Solana RPC — 链上获取 Token 持仓排行（无数量上限）
const RPC = 'https://api.mainnet-beta.solana.com';
const TOKEN_PROGRAM   = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN22_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function rpcCall(method, params, retries = 1) {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
  for (let i = 0; ; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });
      clearTimeout(timer);
      const json = await res.json();
      if (json.error) throw json.error;
      return json.result;
    } catch (err) {
      clearTimeout(timer);
      if (i < retries) { await sleep(1000); continue; }
      throw err;
    }
  }
}

/**
 * [规范化] 代币合约 → 持仓钱包地址数组
 * @param {string} tokenAddress
 * @param {number} topN         - 取前 N 名，默认 100
 * @returns {Promise<string[]>}
 */
export async function getHolderAddresses(tokenAddress, topN = 100) {
  const holders = await getHoldersSolana(tokenAddress, topN);
  return holders.map(h => h.holderWalletAddress);
}

/**
 * 链上获取代币持仓排行（富数据）
 * @param {string} mintAddress - 代币 mint 地址
 * @param {number} topN        - 取前 N 名，默认 100
 * @returns {Array<{ holderWalletAddress: string, holdAmount: string, holdRatio: string }>}
 */
export async function getHoldersSolana(mintAddress, topN = 100) {
  // 自动检测 Token Program 版本（旧版165字节，Token-2022同布局）
  const filters = [{ dataSize: 165 }, { memcmp: { offset: 0, bytes: mintAddress } }];
  const opts = { encoding: 'base64', commitment: 'confirmed', filters };

  let result = await rpcCall('getProgramAccounts', [TOKEN_PROGRAM, opts]);
  if (!result?.length)
    result = await rpcCall('getProgramAccounts', [TOKEN22_PROGRAM, opts]);

  if (!result?.length) return [];

  // 解析 amount 并排序
  const accounts = result
    .map(({ account, pubkey }) => {
      const data = Buffer.from(account.data[0], 'base64');
      const owner = decodePublicKey(data, 32);
      const amount = decodeLEBigInt(data, 64);
      return { owner, amount, pubkey };
    })
    .filter(a => a.amount > 0n)
    .sort((a, b) => (a.amount > b.amount ? -1 : a.amount < b.amount ? 1 : 0))
    .slice(0, topN);

  // 计算总供应量用于 holdRatio
  const totalAmount = accounts.reduce((s, a) => s + a.amount, 0n);

  return accounts.map(a => ({
    holderWalletAddress: a.owner,
    holdAmount: a.amount.toString(),
    holdRatio: totalAmount > 0n
      ? ((Number(a.amount) / Number(totalAmount)) * 100).toFixed(4) + '%'
      : '0%',
  }));
}

function decodePublicKey(buf, offset) {
  const bytes = buf.slice(offset, offset + 32);
  return encodeBase58(bytes);
}

function decodeLEBigInt(buf, offset) {
  let result = 0n;
  for (let i = 7; i >= 0; i--) result = (result << 8n) | BigInt(buf[offset + i]);
  return result;
}

// Base58 encoder（Solana 地址格式）
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function encodeBase58(bytes) {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let result = '';
  while (n > 0n) {
    result = BASE58_ALPHABET[Number(n % 58n)] + result;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    result = '1' + result;
  }
  return result;
}
