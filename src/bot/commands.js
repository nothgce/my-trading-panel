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

// ─── Telegram API 工具 ────────────────────────────────────────────────────────

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

async function answerCallback(callbackId, text = '') {
  await fetch(`${tgBase()}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackId, text }),
  });
}

async function deleteMessage(chatId, messageId) {
  await fetch(`${tgBase()}/deleteMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
  });
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

// Solana base58 地址为 32-44 位；短于此的是 OKX 内部 ID，链接无意义
const isSolanaAddr = addr => typeof addr === 'string' && addr.length >= 32;

function okxLink(addr) {
  if (!isSolanaAddr(addr)) return '';
  return `<a href="https://web3.okx.com/token/solana/${addr}">🔗</a>`;
}

function walletLink(addr) {
  return `<a href="https://web3.okx.com/portfolio/${addr}">🔗</a>`;
}

function fmtTable(rows) {
  if (!rows.length) return '  (无数据)';
  return rows.map(r => {
    const sym = r.symbol.length > 12 ? r.symbol.slice(0, 11) + '…' : r.symbol;
    const usd  = r.totalUsd != null && r.totalUsd > 0 ? ` ${fmtUsd(r.totalUsd)}` : '';
    const link = r.contract ? ` ${okxLink(r.contract)}` : '';
    return `  ${escHtml(sym.padEnd(13))} · ${r.count}人${usd}${link}`;
  }).join('\n');
}

// ─── 会话存储（保留最近 10 次分析） ──────────────────────────────────────────

let _sessionId = 0;
const sessions = new Map(); // id → { traders, holders }

function storeSession(data) {
  const id = ++_sessionId;
  sessions.set(id, data);
  if (sessions.size > 10) sessions.delete(sessions.keys().next().value);
  return id;
}

// ─── 告警消息 ─────────────────────────────────────────────────────────────────

export function sendAlert({ chainIndex, tokenAddress }, info, rule) {
  const field = WINDOW_FIELD[rule.window];
  const text = [
    `🚨 <b>异动告警</b>`,
    ``,
    `合约: <code>${tokenAddress}</code> ${okxLink(tokenAddress)}`,
    `${rule.window} 涨幅: <b>${fmtChange(info[field])}</b>`,
    `价格: $${parseFloat(info.price ?? '0').toPrecision(4)}`,
    `市值: ${fmtUsd(info.marketCap)}`,
    `流动性: ${fmtUsd(info.liquidity)}`,
  ].join('\n');
  return sendMessage(text);
}

// ─── 命令分发 ─────────────────────────────────────────────────────────────────

export async function handleUpdate(update) {
  if (update.callback_query) return _handleCallback(update.callback_query);

  const msg = update.message;
  if (!msg?.text) return;

  const text     = msg.text.trim();
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

// ─── 回调处理 ─────────────────────────────────────────────────────────────────

async function _handleCallback(query) {
  const data = query.data ?? '';

  // 关闭按钮：删除当前消息
  if (data === 'del') {
    await deleteMessage(query.message.chat.id, query.message.message_id);
    await answerCallback(query.id);
    return;
  }

  // 钱包地址列表：wa:{sid}:{group}:{type}:{contract}
  // group: T=交易者 H=大户  type: h=持仓 t=交易记录
  if (data.startsWith('wa:')) {
    const [, sidStr, group, type, contract] = data.split(':');
    const session = sessions.get(parseInt(sidStr));
    if (!session) {
      await answerCallback(query.id, '会话已过期，请重新运行 /ca');
      return;
    }

    const mapGroup = group === 'T' ? 'traders' : 'holders';
    const map      = type  === 'h' ? session[mapGroup].holdMap : session[mapGroup].tradeMap;
    const entry    = map.get(contract);
    if (!entry) { await answerCallback(query.id, '数据不存在'); return; }

    const groupLabel = group === 'T' ? '交易者' : '大户';
    const typeLabel  = type  === 'h' ? '持仓'   : '交易';
    const wallets    = entry.wallets ?? [];
    const shown      = wallets.slice(0, 20);

    const lines = [
      `<b>${escHtml(entry.symbol)} · ${groupLabel}${typeLabel}地址 (${wallets.length}人)</b>`,
      ``,
      ...shown.map(a => `<code>${a}</code> ${walletLink(a)}`),
      ...(wallets.length > 20 ? [`…共 ${wallets.length} 人，仅显示前 20`] : []),
    ];

    await sendMessage(lines.join('\n'), {
      reply_markup: { inline_keyboard: [[{ text: '🔙 关闭', callback_data: 'del' }]] },
    });
    await answerCallback(query.id);
    return;
  }

  await answerCallback(query.id);
}

// ─── /ca 命令 ─────────────────────────────────────────────────────────────────

async function _handleCa(ca) {
  if (!ca) return sendMessage('用法: /ca <代币合约地址>');
  await sendMessage([
    `🔍 分析中: <code>${ca}</code> ${okxLink(ca)}`,
    ``,
    `• 交易者: 最近 500 笔成交去重，过滤刷量，最低成交 = 万分之一市值（上限 $50）`,
    `• 大户: Solana RPC 链上持仓前 ${telegramConfig.topHolderCount} 名`,
    `• 每人各查持仓前 20 + 近 100 笔交易记录`,
    `• 仅展示 ≥2 人同时涉及的代币`,
    ``,
    `预计需要 1-2 分钟，请稍候...`,
  ].join('\n'));
  try {
    const result = await analyzeToken(ca, { holderTopN: telegramConfig.topHolderCount });
    await _sendAnalysisResult(ca, result);
  } catch (err) {
    await sendMessage(`❌ 分析失败: ${err?.msg ?? err?.message ?? String(err)}`);
  }
}

function _buildKeyboard(rows, sid, group, type) {
  // 每行 3 个按钮
  const buttons = rows
    .filter(r => isSolanaAddr(r.contract))   // 无效地址不生成按钮
    .map(r => ({
      text: r.symbol.slice(0, 20),
      callback_data: `wa:${sid}:${group}:${type}:${r.contract}`,
    }));
  const keyboard = [];
  for (let i = 0; i < buttons.length; i += 3) {
    keyboard.push(buttons.slice(i, i + 3));
  }
  return { inline_keyboard: keyboard };
}

async function _sendAnalysisResult(ca, { traders, holders }) {
  const sid = storeSession({ traders, holders });

  // 只展示 ≥2 人的代币
  const traderHoldTop  = topN(traders.holdMap,  15).filter(r => r.count >= 2 && (r.totalUsd ?? 0) >= 5);
  const traderTradeTop = topN(traders.tradeMap, 15).filter(r => r.count >= 2);
  const holderHoldTop  = topN(holders.holdMap,  15).filter(r => r.count >= 2 && (r.totalUsd ?? 0) >= 5);
  const holderTradeTop = topN(holders.tradeMap, 15).filter(r => r.count >= 2);

  await sendMessage([
    `✅ <b>CA 分析完成</b>`,
    `合约: <code>${ca}</code> ${okxLink(ca)}`,
    ``,
    `近期交易者: ${traders.addresses.length} 人`,
    `链上大户:   ${holders.addresses.length} 人`,
  ].join('\n'));

  const blocks = [
    { label: '📊 <b>交易者持仓聚类</b>',     rows: traderHoldTop,  group: 'T', type: 'h' },
    { label: '📈 <b>交易者近期交易记录</b>', rows: traderTradeTop, group: 'T', type: 't' },
    { label: '🐋 <b>大户持仓聚类</b>',       rows: holderHoldTop,  group: 'H', type: 'h' },
    { label: '💹 <b>大户近期交易记录</b>',   rows: holderTradeTop, group: 'H', type: 't' },
  ];

  for (const { label, rows, group, type } of blocks) {
    const extra = rows.length ? { reply_markup: _buildKeyboard(rows, sid, group, type) } : {};
    await sendMessage(`${label}\n` + fmtTable(rows), extra);
  }
}

// ─── 其他命令 ─────────────────────────────────────────────────────────────────

async function _handleWatch(ca) {
  if (!ca) return sendMessage('用法: /watch <代币合约地址>');
  addToken('501', ca);
  return sendMessage(`✅ 已添加监控\n<code>${ca}</code> ${okxLink(ca)}`);
}

async function _handleUnwatch(ca) {
  if (!ca) return sendMessage('用法: /unwatch <代币合约地址>');
  removeToken('501', ca);
  return sendMessage(`❎ 已移除监控\n<code>${ca}</code> ${okxLink(ca)}`);
}

async function _handleList() {
  const tokens = listTokens();
  if (!tokens.length) return sendMessage('📋 监控列表为空');
  const lines = tokens.map((t, i) => `${i + 1}. <code>${t.tokenAddress}</code> ${okxLink(t.tokenAddress)}`);
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
