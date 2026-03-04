// 展示层：Telegram Bot 命令处理（/ca、告警消息格式化）
import { telegramConfig } from '../config/telegram.js';
import { analyzeToken, topN } from '../services/analyzer.js';
import { addToken, removeToken, listTokens } from '../services/monitor.js';

const WINDOW_FIELD = {
  '5m':  'priceChange5M',
  '1h':  'priceChange1H',
  '4h':  'priceChange4H',
  '24h': 'priceChange24H',
};

function tgBase() {
  return `https://api.telegram.org/bot${telegramConfig.botToken}`;
}

/**
 * 发送消息到配置的 chatId
 */
export async function sendMessage(text, extra = {}) {
  const res = await fetch(`${tgBase()}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: telegramConfig.chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...extra,
    }),
  });
  const j = await res.json();
  if (!j.ok) console.error('[bot] sendMessage error:', j.description);
  return j;
}

// ─── 格式化工具 ───────────────────────────────────────────────────────────────

function fmtUsd(val) {
  const n = parseFloat(val ?? '0');
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function fmtChange(val) {
  const n = parseFloat(val ?? '0');
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtTable(rows) {
  if (!rows.length) return '  (无数据)';
  return rows.map(r => {
    const sym = r.symbol.length > 12 ? r.symbol.slice(0, 11) + '…' : r.symbol;
    return `  ${escHtml(sym.padEnd(13))} · ${r.count}人`;
  }).join('\n');
}

// ─── 告警消息 ─────────────────────────────────────────────────────────────────

/**
 * 发送价格异动告警（由 monitor.js 调用）
 * @param {{ chainIndex: string, tokenAddress: string }} token
 * @param {object} info  - getPriceInfo 返回值
 * @param {{ window: string, changePercent: number }} rule
 */
export function sendAlert({ chainIndex, tokenAddress }, info, rule) {
  const field = WINDOW_FIELD[rule.window];
  const text = [
    `🚨 <b>异动告警</b>`,
    ``,
    `合约: <code>${tokenAddress}</code>`,
    `${rule.window} 涨幅: <b>${fmtChange(info[field])}</b>`,
    `价格: $${parseFloat(info.price ?? '0').toPrecision(4)}`,
    `市值: ${fmtUsd(info.marketCap)}`,
    `流动性: ${fmtUsd(info.liquidity)}`,
  ].join('\n');
  return sendMessage(text);
}

// ─── 命令处理 ─────────────────────────────────────────────────────────────────

/**
 * 处理 Telegram getUpdates 返回的单条 update
 */
export async function handleUpdate(update) {
  const msg = update.message;
  if (!msg?.text) return;

  const text = msg.text.trim();
  const spaceIdx = text.indexOf(' ');
  const cmd  = (spaceIdx === -1 ? text : text.slice(0, spaceIdx)).toLowerCase().split('@')[0];
  const rest = spaceIdx === -1 ? '' : text.slice(spaceIdx + 1).trim();

  switch (cmd) {
    case '/ca':      return _handleCa(rest);
    case '/watch':   return _handleWatch(rest);
    case '/unwatch': return _handleUnwatch(rest);
    case '/list':    return _handleList();
    case '/help':    return _handleHelp();
  }
}

async function _handleCa(ca) {
  if (!ca) return sendMessage('用法: /ca <代币合约地址>');
  await sendMessage(`🔍 分析中: <code>${ca}</code>\n预计需要 1-2 分钟，请稍候...`);
  try {
    const result = await analyzeToken(ca, {
      holderTopN: telegramConfig.topHolderCount,
    });
    await _sendAnalysisResult(ca, result);
  } catch (err) {
    await sendMessage(`❌ 分析失败: ${err?.msg ?? err?.message ?? String(err)}`);
  }
}

async function _sendAnalysisResult(ca, { traders, holders }) {
  const traderHoldTop  = topN(traders.holdMap,  15);
  const traderTradeTop = topN(traders.tradeMap, 15);
  const holderHoldTop  = topN(holders.holdMap,  15);
  const holderTradeTop = topN(holders.tradeMap, 15);

  const blocks = [
    [
      `✅ <b>CA 分析完成</b>`,
      `合约: <code>${ca}</code>`,
      ``,
      `近期交易者: ${traders.addresses.length} 人`,
      `链上大户:   ${holders.addresses.length} 人`,
    ].join('\n'),

    `📊 <b>交易者持仓聚类</b> (Top 15)\n` + fmtTable(traderHoldTop),
    `📈 <b>交易者近期交易记录</b> (Top 15)\n` + fmtTable(traderTradeTop),
    `🐋 <b>大户持仓聚类</b> (Top 15)\n` + fmtTable(holderHoldTop),
    `💹 <b>大户近期交易记录</b> (Top 15)\n` + fmtTable(holderTradeTop),
  ];

  for (const block of blocks) {
    await sendMessage(block);
  }
}

async function _handleWatch(ca) {
  if (!ca) return sendMessage('用法: /watch <代币合约地址>');
  addToken('501', ca);
  return sendMessage(`✅ 已添加监控\n<code>${ca}</code>`);
}

async function _handleUnwatch(ca) {
  if (!ca) return sendMessage('用法: /unwatch <代币合约地址>');
  removeToken('501', ca);
  return sendMessage(`❎ 已移除监控\n<code>${ca}</code>`);
}

async function _handleList() {
  const tokens = listTokens();
  if (!tokens.length) return sendMessage('📋 监控列表为空');
  const lines = tokens.map((t, i) => `${i + 1}. <code>${t.tokenAddress}</code>`);
  return sendMessage(`📋 <b>监控列表</b>\n\n${lines.join('\n')}`);
}

async function _handleHelp() {
  return sendMessage([
    `🤖 <b>命令列表</b>`,
    ``,
    `/ca &lt;CA&gt; — 分析代币大户持仓聚类`,
    `/watch &lt;CA&gt; — 添加价格异动监控`,
    `/unwatch &lt;CA&gt; — 移除监控`,
    `/list — 查看监控列表`,
  ].join('\n'));
}
