// 展示层：Telegram Bot 命令处理
import { telegramConfig } from '../config/telegram.js';
import { analyzeToken, topN } from '../services/analyzer.js';
import { findAltWallets } from '../services/altFinder.js';
import { scanConfig, getActivePreset, getPreset, addPreset, deletePreset, setActive, saveConfig } from '../config/scanConfig.js';

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

async function editMessage(chatId, messageId, text, extra = {}) {
  const res = await fetch(`${tgBase()}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...extra,
    }),
  });
  const j = await res.json();
  if (!j.ok && j.description !== 'Bad Request: message is not modified')
    console.error('[bot] editMessage error:', j.description);
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

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const isSolanaAddr = addr => typeof addr === 'string' && addr.length >= 32;

function gmgnLink(addr) {
  if (!isSolanaAddr(addr)) return '';
  return `<a href="https://gmgn.ai/sol/token/${addr}">🔗</a>`;
}

function walletLink(addr) {
  return `<a href="https://gmgn.ai/sol/address/${addr}">${addr}</a>`;
}

function fmtTable(rows) {
  if (!rows.length) return '  (无数据)';
  return rows.map(r => {
    const sym    = r.symbol.length > 12 ? r.symbol.slice(0, 11) + '…' : r.symbol;
    const usd    = r.totalUsd != null && r.totalUsd > 0 ? ` ${fmtUsd(r.totalUsd)}` : '';
    const symStr = r.contract
      ? `<a href="https://gmgn.ai/sol/token/${r.contract}">${escHtml(sym)}</a>`
      : escHtml(sym);
    return `  ${symStr.padEnd(13)} · ${r.count}人${usd}`;
  }).join('\n');
}

// ─── 会话存储（保留最近 10 次分析） ──────────────────────────────────────────

let _sessionId = 0;
const sessions = new Map();

function storeSession(data) {
  const id = ++_sessionId;
  sessions.set(id, data);
  if (sessions.size > 10) sessions.delete(sessions.keys().next().value);
  return id;
}

// ─── 设置：待输入状态 ──────────────────────────────────────────────────────────
// type: 'preset_name' | 'param'
let _pendingInput = null;

const fmtAge = v => v == null ? '无限' : (v >= 60 ? `${Math.round(v / 60)}h` : `${v}m`);

const fmtMcap = v => v > 0 ? fmtUsd(v) : '无';

const PARAM_META = {
  minMcap:      { label: '市值下限',  fmt: fmtMcap },
  maxMcap:      { label: '市值上限',  fmt: v => fmtUsd(v) },
  minNetVolume: { label: null,        fmt: v => fmtUsd(v) },   // label 由 timeframe 动态决定
  minLiquidity: { label: '流动性',   fmt: v => fmtUsd(v) },
  minTokenAge:  { label: '上线最小', fmt: fmtAge },
  maxTokenAge:  { label: '上线最大', fmt: fmtAge },
  minCluster:   { label: '聚类阈值', fmt: v => `>${v}人` },
};

const TIMEFRAMES = ['5m', '1h', '6h', '24h'];

function _buildPresetListKeyboard() {
  const rows = scanConfig.presets.map(p => [{
    text: p.id === scanConfig.activePresetId ? `🟢 ${p.name}` : p.name,
    callback_data: `cfg:edit:${p.id}`,
  }]);
  rows.push([{ text: '＋ 新增预设', callback_data: 'cfg:new' }]);
  return { inline_keyboard: rows };
}

function _presetTitle(preset) {
  const active = preset.id === scanConfig.activePresetId ? ' 🟢 运行中' : '';
  return `⚙️ <b>预设: ${escHtml(preset.name)}</b>${active}`;
}

function _buildPresetEditKeyboard(preset) {
  const tfRow = [
    { text: '时间范围', callback_data: 'cfg:noop' },
    ...TIMEFRAMES.map(tf => ({
      text: preset.timeframe === tf ? `✓${tf}` : tf,
      callback_data: `cfg:tf:${preset.id}:${tf}`,
    })),
  ];

  const paramRows = Object.entries(PARAM_META).map(([key, meta]) => {
    const label = key === 'minNetVolume' ? `${preset.timeframe}净流入` : meta.label;
    return [{
      text: `${label}: ${meta.fmt(preset[key])}  ✏️`,
      callback_data: `cfg:inp:${preset.id}:${key}`,
    }];
  });

  const socialRow = [{
    text: `有社媒: ${preset.hasSocials ? '✅ 开启' : '❌ 关闭'}`,
    callback_data: `cfg:tog:${preset.id}`,
  }];

  const actionRow = [];
  if (preset.id !== scanConfig.activePresetId)
    actionRow.push({ text: '❌ 未激活', callback_data: `cfg:act:${preset.id}` });
  if (scanConfig.presets.length > 1)
    actionRow.push({ text: '🗑️ 删除', callback_data: `cfg:del:${preset.id}` });
  actionRow.push({ text: '← 列表', callback_data: 'cfg:list' });

  return {
    inline_keyboard: [tfRow, ...paramRows, socialRow, actionRow],
  };
}

// ─── 命令分发 ─────────────────────────────────────────────────────────────────

export async function handleUpdate(update) {
  if (update.callback_query) return _handleCallback(update.callback_query);

  const msg = update.message;
  if (!msg?.text) return;

  // 处理设置待输入
  if (_pendingInput && !msg.text.trim().startsWith('/'))
    return _handlePendingInput(msg.text.trim());

  const text     = msg.text.trim();
  const spaceIdx = text.indexOf(' ');
  const cmd  = (spaceIdx === -1 ? text : text.slice(0, spaceIdx)).toLowerCase().split('@')[0];
  const rest = spaceIdx === -1 ? '' : text.slice(spaceIdx + 1).trim();

  switch (cmd) {
    case '/ca':       return _handleCa(rest);
    case '/cha':      return _handleCha(rest);
    case '/settings': return _handleSettings();
    case '/help':     return _handleHelp();
  }
}

// ─── 回调处理 ─────────────────────────────────────────────────────────────────

async function _handleCallback(query) {
  const data = query.data ?? '';

  if (data.startsWith('cfg:')) return _handleCfgCallback(query, data);

  if (data === 'del') {
    await deleteMessage(query.message.chat.id, query.message.message_id);
    await answerCallback(query.id);
    return;
  }

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
      ...shown.map(a => walletLink(a)),
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
    `🔍 分析中: <code>${ca}</code> ${gmgnLink(ca)}`,
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
  const buttons = rows
    .filter(r => isSolanaAddr(r.contract))
    .map(r => ({
      text: r.symbol.slice(0, 20),
      callback_data: `wa:${sid}:${group}:${type}:${r.contract}`,
    }));
  const keyboard = [];
  for (let i = 0; i < buttons.length; i += 3) keyboard.push(buttons.slice(i, i + 3));
  return { inline_keyboard: keyboard };
}

async function _sendAnalysisResult(ca, { traders, holders }) {
  const sid = storeSession({ traders, holders });

  const traderHoldTop  = topN(traders.holdMap,  15).filter(r => r.count >= 2 && (r.totalUsd ?? 0) >= 5);
  const traderTradeTop = topN(traders.tradeMap, 15).filter(r => r.count >= 2);
  const holderHoldTop  = topN(holders.holdMap,  15).filter(r => r.count >= 2 && (r.totalUsd ?? 0) >= 5);
  const holderTradeTop = topN(holders.tradeMap, 15).filter(r => r.count >= 2);

  await sendMessage([
    `✅ <b>CA 分析完成</b>`,
    `合约: <code>${ca}</code> ${gmgnLink(ca)}`,
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

// ─── /cha 命令 ────────────────────────────────────────────────────────────────

async function _handleCha(addr) {
  if (!addr) return sendMessage('用法: /cha &lt;钱包地址&gt;');
  await sendMessage([
    `🔍 查小号: <code>${addr}</code>`,
    ``,
    `• 抓取最近 20 个买入代币及买入时间`,
    `• 每个代币向前翻 10 页，收集更早买入且未清仓的地址`,
    `• 按早买代币数排序，输出前 20 个候选地址`,
    ``,
    `预计需要 3-4 分钟，请稍候...`,
  ].join('\n'));
  try {
    const results = await findAltWallets(addr, 20);
    if (!results.length) {
      return sendMessage(`✅ 查询完成，未找到早买地址`);
    }
    const lines = [
      `🕵️ <b>疑似小号 Top20</b>  大号: <code>${addr}</code>`,
      ``,
      ...results.slice(0, 20).map((r, i) =>
        `${String(i + 1).padStart(2)}. <code>${r.wallet}</code>  ${r.preBuyCount}`
      ),
    ];
    await sendMessage(lines.join('\n'));
  } catch (err) {
    await sendMessage(`❌ 查询失败: ${err?.msg ?? err?.message ?? String(err)}`);
  }
}

// ─── /help ────────────────────────────────────────────────────────────────────

async function _handleHelp() {
  return sendMessage([
    `🤖 <b>命令列表</b>`,
    ``,
    `/ca &lt;CA&gt; — 分析代币大户持仓聚类`,
    `/cha &lt;地址&gt; — 查找钱包潜在小号`,
    `/settings — 扫描参数预设管理`,
  ].join('\n'));
}

// ─── /settings ────────────────────────────────────────────────────────────────

async function _handleSettings() {
  return sendMessage('⚙️ <b>设置 · 预设列表</b>', {
    reply_markup: _buildPresetListKeyboard(),
  });
}

async function _handlePendingInput(text) {
  const pending = _pendingInput;
  _pendingInput = null;
  if (pending.promptMsgId)
    deleteMessage(pending.chatId, pending.promptMsgId).catch(() => {});

  if (pending.type === 'preset_name') {
    const preset = addPreset(text);
    return sendMessage(_presetTitle(preset), {
      reply_markup: _buildPresetEditKeyboard(preset),
    });
  }

  if (pending.type === 'param') {
    const { presetId, paramKey } = pending;
    const preset = getPreset(presetId);
    if (!preset) return sendMessage('❌ 预设不存在');

    // maxTokenAge / minMcap 特殊处理：0 或非数字 = 无限制
    if (paramKey === 'maxTokenAge') {
      const value = parseFloat(text);
      preset.maxTokenAge = (!isNaN(value) && value > 0) ? Math.round(value) : null;
    } else if (paramKey === 'minMcap') {
      const value = parseFloat(text);
      preset.minMcap = (!isNaN(value) && value > 0) ? Math.round(value) : 0;
    } else {
      const value = parseFloat(text);
      if (isNaN(value) || value <= 0) return sendMessage('❌ 请输入有效正数');
      preset[paramKey] = Math.round(value);
    }
    saveConfig();

    return sendMessage(_presetTitle(preset), {
      reply_markup: _buildPresetEditKeyboard(preset),
    });
  }
}

async function _handleCfgCallback(query, data) {
  const chatId = query.message.chat.id;
  const msgId  = query.message.message_id;

  const edit = (text, reply_markup) =>
    editMessage(chatId, msgId, text, { reply_markup });

  if (data === 'cfg:noop') return answerCallback(query.id);

  if (data === 'cfg:list') {
    await edit('⚙️ <b>设置 · 预设列表</b>', _buildPresetListKeyboard());
    return answerCallback(query.id);
  }

  if (data === 'cfg:new') {
    _pendingInput = { type: 'preset_name', chatId, promptMsgId: null };
    const j = await sendMessage('请输入新预设名称:');
    _pendingInput.promptMsgId = j.result?.message_id;
    return answerCallback(query.id);
  }

  // cfg:edit:ID
  if (data.startsWith('cfg:edit:')) {
    const preset = getPreset(data.slice(9));
    if (!preset) return answerCallback(query.id, '预设不存在');
    await edit(_presetTitle(preset), _buildPresetEditKeyboard(preset));
    return answerCallback(query.id);
  }

  // cfg:act:ID
  if (data.startsWith('cfg:act:')) {
    const preset = getPreset(data.slice(8));
    if (!preset) return answerCallback(query.id);
    setActive(preset.id);
    await edit(_presetTitle(preset), _buildPresetEditKeyboard(preset));
    return answerCallback(query.id, '✅ 已激活');
  }

  // cfg:del:ID
  if (data.startsWith('cfg:del:')) {
    const id = data.slice(8);
    if (!deletePreset(id)) return answerCallback(query.id, '至少保留一个预设');
    await edit('⚙️ <b>设置 · 预设列表</b>', _buildPresetListKeyboard());
    return answerCallback(query.id, '已删除');
  }

  // cfg:tf:ID:tf
  if (data.startsWith('cfg:tf:')) {
    const [, , id, tf] = data.split(':');
    const preset = getPreset(id);
    if (!preset) return answerCallback(query.id);
    preset.timeframe = tf;
    saveConfig();
    await edit(_presetTitle(preset), _buildPresetEditKeyboard(preset));
    return answerCallback(query.id, `时间范围: ${tf}`);
  }

  // cfg:tog:ID  (toggle hasSocials)
  if (data.startsWith('cfg:tog:')) {
    const preset = getPreset(data.slice(8));
    if (!preset) return answerCallback(query.id);
    preset.hasSocials = !preset.hasSocials;
    saveConfig();
    await edit(_presetTitle(preset), _buildPresetEditKeyboard(preset));
    return answerCallback(query.id);
  }

  // cfg:inp:ID:paramKey
  if (data.startsWith('cfg:inp:')) {
    const [, , id, paramKey] = data.split(':');
    const preset = getPreset(id);
    const meta   = PARAM_META[paramKey];
    if (!preset || !meta) return answerCallback(query.id);
    _pendingInput = { type: 'param', presetId: id, paramKey, chatId, promptMsgId: null };
    const label = paramKey === 'minNetVolume' ? `${preset.timeframe}净流入` : meta.label;
    const hint  = (paramKey === 'maxTokenAge' || paramKey === 'minMcap')
      ? '（输入0或非数字 = 无限制）' : '（直接发送数字）';
    const j = await sendMessage(
      `请输入新的 <b>${label}</b>\n当前值: ${meta.fmt(preset[paramKey])}\n${hint}`
    );
    _pendingInput.promptMsgId = j.result?.message_id;
    return answerCallback(query.id);
  }

  await answerCallback(query.id);
}
