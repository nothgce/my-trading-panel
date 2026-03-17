// 数据层：Jupiter datapi — Solana 代币发现（无需鉴权，支持净流入/市值/代币年龄过滤）
const BASE = 'https://datapi.jup.ag';

/**
 * 获取 Solana 净买入排行榜（24h）
 * 参数与 Jupiter 网页筛选器一致
 */
export async function getDiscoveryList({
  timeframe       = '5m',
  minNetVolume    = 1_000,      // 净流入 >= $1000
  minMcap         = 0,           // 市值下限，0 = 无下限
  maxMcap         = 1_000_000,  // 市值上限
  minTokenAge     = 4_320,      // 上线 >= 72h（单位：分钟）
  maxTokenAge     = null,       // 上线上限（分钟），null = 无上限
  minLiquidity    = 5_000,      // 流动性 >= $5000
  hasSocials      = true,       // 有社媒
} = {}) {
  const qs = new URLSearchParams({
    mintAuthorityDisabled:  'true',
    freezeAuthorityDisabled:'true',
    minLiquidity:           String(minLiquidity),
    maxLiquidity:           '999999999',
    minVolume24h:           '1',
    maxVolume24h:           '999999999',
    [`minNetVolume${timeframe}`]: String(minNetVolume),
    [`maxNetVolume${timeframe}`]: '999999999',
    [`minNumNetBuyers${timeframe}`]: '1',
    [`maxNumNetBuyers${timeframe}`]: '999999999',
    minMcap:                String(Math.max(1, minMcap)),
    maxMcap:                String(maxMcap),
    minHolderCount:         '1',
    maxHolderCount:         '999999999',
    hasSocials:             String(hasSocials),
    minTokenAge:            String(minTokenAge),
    maxTokenAge:            maxTokenAge != null ? String(maxTokenAge) : '999999999',
    includeSparklines:      'false',
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(`${BASE}/v2/assets/toptraded/${timeframe}?${qs}`, {
      headers: {
        'accept':          'application/json',
        'origin':          'https://jup.ag',
        'referer':         'https://jup.ag/',
        'user-agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    // 兼容数组或 { data: [...] } 两种格式
    return Array.isArray(json) ? json : (json.data ?? json.assets ?? []);
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}
