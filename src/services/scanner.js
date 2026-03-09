// 业务层：代币发现榜单扫描 — 每分钟拉取一次，输出终端 + Telegram
import { getDiscoveryList } from '../data/okx/discovery.js';

const INTERVAL_MS = 60_000;
const BASE_GMGN   = 'https://gmgn.ai';

let _timer    = null;
let _onUpdate = null;   // callback(text: string)
let _firstRun = true;

/** 格式化单个代币行（Jupiter datapi 字段） */
function fmtToken(t, rank) {
  const symbol  = t.symbol ?? '?';
  const ca      = t.id ?? '';
  const mc      = t.mcap ?? t.fdv ?? 0;
  const liq     = t.liquidity ?? 0;
  const ch5m    = t.stats5m?.priceChange ?? 0;
  const ch1h    = t.stats1h?.priceChange ?? 0;
  const netFlow = (t.stats5m?.buyVolume ?? 0) - (t.stats5m?.sellVolume ?? 0);
  const buyers  = t.stats5m?.numNetBuyers ?? 0;
  const created = t.createdAt ? t.createdAt.slice(0, 10).replace(/-/g, '') : '?';

  const fmtUsd = v =>
    Math.abs(v) >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}M`
    : Math.abs(v) >= 1_000   ? `$${(v / 1_000).toFixed(1)}K`
    : `$${v.toFixed(0)}`;

  const arrow5m = ch5m >= 0 ? '▲' : '▼';
  const arrow1h = ch1h >= 0 ? '▲' : '▼';
  const link    = ca ? `<a href="${BASE_GMGN}/sol/token/${ca}">🔗</a>` : '';

  return (
    `${rank}. <b>$${symbol}</b> ${link}\n` +
    `   MC:${fmtUsd(mc)}  ${arrow5m}${Math.abs(ch5m).toFixed(1)}%/5m  ${arrow1h}${Math.abs(ch1h).toFixed(1)}%/1h\n` +
    `   净流入:${fmtUsd(netFlow)}  净买家:${buyers}人  创建:${created}`
  );
}

/** 格式化完整消息 */
function fmtMessage(list) {
  const now = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const rows = list.map((t, i) => fmtToken(t, i + 1)).join('\n');
  return `🔍 <b>Solana 5m 净买榜 (${list.length}) · 按净流入排名</b>  <code>${now}</code>\n\n${rows}`;
}

/**
 * 启动扫描
 * @param {(text: string) => void} onUpdate - 收到消息文本的回调
 */
export function startScanner(onUpdate) {
  if (_timer) return;
  _onUpdate = onUpdate;
  _run();
  _timer = setInterval(_run, INTERVAL_MS);
  console.log('[scanner] 启动，间隔 60s');
}

export function stopScanner() {
  if (!_timer) return;
  clearInterval(_timer);
  _timer = null;
  console.log('[scanner] 停止');
}

async function _run() {
  try {
    const list = await getDiscoveryList();
    if (!list.length) {
      console.warn('[scanner] 返回空列表');
      return;
    }

    if (_firstRun) {
      _firstRun = false;
      console.log('[scanner] 首次原始样本:', JSON.stringify(list[0], null, 2));
    }

    const text = fmtMessage(list);
    console.log('[scanner]\n' + text.replace(/<[^>]+>/g, ''));
    _onUpdate?.(text)?.catch(e => console.error('[scanner] 推送失败:', e?.message ?? e));
  } catch (err) {
    console.error('[scanner] 错误:', err?.msg ?? err?.message ?? err);
  }
}
