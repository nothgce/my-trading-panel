// 数据层：Solana RPC — 链上获取 Token 持仓排行（无数量上限）
// 推荐 Helius（免费档 100k credits/day）：https://helius.dev
// .env: SOLANA_RPC=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
const RPC = process.env.SOLANA_RPC ?? 'https://api.mainnet-beta.solana.com';
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
  // 只取 owner(32B) + amount(8B)，大幅缩减响应体积，兼容 Token-2022 扩展账户
  const dataSlice = { offset: 32, length: 40 };

  // 标准 SPL Token：账户固定 165 字节，加 dataSize 进一步缩小
  const optsV1 = {
    encoding: 'base64', commitment: 'confirmed',
    dataSlice,
    filters: [{ dataSize: 165 }, { memcmp: { offset: 0, bytes: mintAddress } }],
  };
  // Token-2022：账户带扩展（如 TransferFeeAmount），大小不固定，不能加 dataSize
  const optsV2 = {
    encoding: 'base64', commitment: 'confirmed',
    dataSlice,
    filters: [{ memcmp: { offset: 0, bytes: mintAddress } }],
  };

  let result = await rpcCall('getProgramAccounts', [TOKEN_PROGRAM, optsV1]);
  if (!result?.length) {
    try {
      result = await rpcCall('getProgramAccounts', [TOKEN22_PROGRAM, optsV2]);
    } catch (err) {
      // 公共 RPC 不支持不带 dataSize 的大程序扫描，需配置 Helius
      // .env: SOLANA_RPC=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
      console.warn('[holders] Token-2022 查询失败（建议配置 Helius RPC）:', err?.message ?? err?.code ?? err);
      return [];
    }
  }

  if (!result?.length) return [];

  // 解析 amount 并排序
  const accounts = result
    .map(({ account, pubkey }) => {
      const data = Buffer.from(account.data[0], 'base64');
      const owner = decodePublicKey(data, 0);   // slice starts at absolute offset 32
      const amount = decodeLEBigInt(data, 32);  // amount at absolute offset 64 → relative 32
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
