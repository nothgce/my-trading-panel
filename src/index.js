import './proxy.js';
import { handleUpdate, sendMessage } from './bot/commands.js';
import { startScanner } from './services/scanner.js';
import { telegramConfig } from './config/telegram.js';
import { botConfig } from './config/botConfig.js';
import { log } from './logger.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── 错误频率监控：5分钟内10次则退出，由外部脚本重启 ──────────────────────────
const ERR_WINDOW = 5 * 60 * 1000;
const ERR_LIMIT  = 10;
const errTimes   = [];

function recordPollError() {
  const now = Date.now();
  errTimes.push(now);
  while (errTimes.length && now - errTimes[0] > ERR_WINDOW) errTimes.shift();
  if (errTimes.length >= ERR_LIMIT) {
    log.error(`[bot] 5分钟内连续报错 ${ERR_LIMIT} 次，自动重启...`);
    process.exit(1);
  }
}

// ─── 启动扫描 ─────────────────────────────────────────────────────────────────
startScanner(text => sendMessage(text,
  botConfig.alertTopicId ? { message_thread_id: botConfig.alertTopicId } : {}
));

// ─── Telegram 长轮询 ──────────────────────────────────────────────────────────
let offset = 0;

async function poll() {
  const base = `https://api.telegram.org/bot${telegramConfig.botToken}`;
  log.info('[bot] 开始轮询...');

  while (true) {
    try {
      const res = await fetch(
        `${base}/getUpdates?offset=${offset}&timeout=8&allowed_updates=${encodeURIComponent('["message","callback_query"]')}`,
        { signal: AbortSignal.timeout(15_000) },
      );
      const j = await res.json();
      if (!j.ok) {
        log.error('[bot] getUpdates error:', j.description);
        await sleep(5000);
        continue;
      }
      for (const upd of j.result ?? []) {
        offset = upd.update_id + 1;
        handleUpdate(upd).catch(e =>
          log.error('[bot] handleUpdate error:', e?.message ?? e),
        );
      }
    } catch (e) {
      if (e?.name !== 'TimeoutError') {
        log.error('[bot] poll error:', e?.message ?? e);
        recordPollError();
        await sleep(5000);
      }
    }
  }
}

sendMessage('🤖 Bot 已上线').catch(() => {});
poll();
