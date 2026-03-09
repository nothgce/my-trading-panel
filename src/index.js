import './proxy.js';
import { handleUpdate, sendMessage } from './bot/commands.js';
import { startScanner } from './services/scanner.js';
import { telegramConfig } from './config/telegram.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── 启动扫描 ─────────────────────────────────────────────────────────────────
startScanner(text => sendMessage(text));

// ─── Telegram 长轮询 ──────────────────────────────────────────────────────────
let offset = 0;

async function poll() {
  const base = `https://api.telegram.org/bot${telegramConfig.botToken}`;
  console.log('[bot] 开始轮询...');

  while (true) {
    try {
      const res = await fetch(
        `${base}/getUpdates?offset=${offset}&timeout=25&allowed_updates=${encodeURIComponent('["message","callback_query"]')}`,
        { signal: AbortSignal.timeout(35_000) },
      );
      const j = await res.json();
      if (!j.ok) {
        console.error('[bot] getUpdates error:', j.description);
        await sleep(5000);
        continue;
      }
      for (const upd of j.result ?? []) {
        offset = upd.update_id + 1;
        handleUpdate(upd).catch(e =>
          console.error('[bot] handleUpdate error:', e?.message ?? e),
        );
      }
    } catch (e) {
      if (e?.name !== 'TimeoutError') {
        console.error('[bot] poll error:', e?.message ?? e);
        await sleep(5000);
      }
    }
  }
}

sendMessage('🤖 Bot 已上线').catch(() => {});
poll();
