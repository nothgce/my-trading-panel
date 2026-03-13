// 业务层：代币发现榜单扫描 — 每分钟拉取一次，输出终端 + Telegram
import { getDiscoveryList } from '../data/okx/discovery.js';
import { quickScan } from './quickScan.js';
import { log } from '../logger.js';

const INTERVAL_MS = 60_000;
const BASE_GMGN   = 'https://gmgn.ai';

let _timer       = null;
let _onUpdate    = null;   // callback(text: string)
let _firstRun    = true;
const _scanQueue = [];     // 待分析代币队列 { id, symbol }
let _scanRunning = false;  // 队列是否正在消费

const fmtUsd = v =>
  Math.abs(v) >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}M`
  : Math.abs(v) >= 1_000   ? `$${(v / 1_000).toFixed(1)}K`
  : `$${v.toFixed(0)}`;

/** 格式化单个代币行 */
function fmtToken(t, rank) {
  const symbol  = t.symbol ?? '?';
  const ca      = t.id ?? '';
  const mc      = t.mcap ?? t.fdv ?? 0;
  const ch5m    = t.stats5m?.priceChange ?? 0;
  const created = t.createdAt ? t.createdAt.slice(0, 10).replace(/-/g, '') : '?';
  const arrow5m = ch5m >= 0 ? '▲' : '▼';
  const symLink = ca
    ? `<a href="${BASE_GMGN}/sol/token/${ca}"><b>$${symbol}</b></a>`
    : `<b>$${symbol}</b>`;

  return (
    `${rank}. ${symLink}\n` +
    `   MC:${fmtUsd(mc)}  ${arrow5m}${Math.abs(ch5m).toFixed(1)}%  创建:${created}`
  );
}

/** 过滤出符合条件的代币列表（市值 < $1M，按市值降序） */
function filterList(list) {
  return list
    .filter(t => (t.mcap ?? t.fdv ?? 0) < 1_000_000)
    .sort((a, b) => (b.mcap ?? b.fdv ?? 0) - (a.mcap ?? a.fdv ?? 0));
}

/** 格式化净买榜消息 */
function fmtMessage(filtered) {
  if (!filtered.length) return '';
  const now  = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const rows = filtered.map((t, i) => fmtToken(t, i + 1)).join('\n');
  return `🔍 <b>Solana 净买榜 (${filtered.length}) · 1M以下 · 涨幅5min</b>  <code>${now}</code>\n\n${rows}`;
}

/** 格式化快速聚类报警消息 */
function fmtQuickScanResult(tokenAddress, tokenSymbol, clusters) {
  const caShort = `${tokenAddress.slice(0, 4)}...${tokenAddress.slice(-4)}`;
  const link    = `<a href="${BASE_GMGN}/sol/token/${tokenAddress}"><b>$${tokenSymbol}</b></a>`;
  const rows    = clusters.map(c => {
    const symLink = `<a href="${BASE_GMGN}/sol/token/${c.ca}">${c.symbol}</a>`;
    const usd     = c.totalUsd > 0 ? ` ${fmtUsd(c.totalUsd)}` : '';
    return `  ${symLink} · ${c.count}人${usd}`;
  }).join('\n');

  return [
    `🔔 <b>持仓聚类警报</b> · ${link}`,
    `<code>${caShort}</code>`,
    ``,
    `前 100 大持仓者中，以下代币 ≥ 9 人共持:`,
    rows,
  ].join('\n');
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

/** 串行消费 quickScan 队列，以最大速率逐个处理 */
function _drainScanQueue() {
  if (_scanRunning || !_scanQueue.length) return;
  _scanRunning = true;
  (async () => {
    while (_scanQueue.length) {
      const { id, symbol } = _scanQueue.shift();
      await quickScan(id, symbol, clusters => {
        const msg = fmtQuickScanResult(id, symbol, clusters);
        _onUpdate?.(msg)?.catch(e => log.error('[scanner] 聚类推送失败:', e?.message ?? e));
      }).catch(e => log.error('[scanner] quickScan 错误:', e?.message ?? e));
    }
    _scanRunning = false;
  })();
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

    const filtered = filterList(list);
    const text = fmtMessage(filtered);
    if (text) {
      console.log('[scanner]\n' + text.replace(/<[^>]+>/g, ''));
      _onUpdate?.(text)?.catch(e => console.error('[scanner] 推送失败:', e?.message ?? e));
    }

    // 将符合条件的代币加入串行队列（1小时内不重复）
    for (const t of filtered) {
      if (t.id) _scanQueue.push({ id: t.id, symbol: t.symbol ?? '?' });
    }
    _drainScanQueue();
  } catch (err) {
    console.error('[scanner] 错误:', err?.msg ?? err?.message ?? err);
  }
}
