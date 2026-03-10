// 日志模块：写入 bot.log，每24h自动清除
import fs from 'fs';
import path from 'path';

const LOG_FILE = path.resolve('bot.log');
const DAY_MS   = 24 * 60 * 60 * 1000;

function timestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function write(level, ...args) {
  const line = `${timestamp()} [${level}] ${args.join(' ')}\n`;
  process.stdout.write(line);
  fs.appendFileSync(LOG_FILE, line);
}

export const log = {
  info:  (...a) => write('INFO ', ...a),
  warn:  (...a) => write('WARN ', ...a),
  error: (...a) => write('ERROR', ...a),
};

// 每24h清空一次
function scheduleClear() {
  const now = Date.now();
  const nextMidnight = new Date();
  nextMidnight.setHours(24, 0, 0, 0);
  const delay = nextMidnight.getTime() - now;

  setTimeout(() => {
    fs.writeFileSync(LOG_FILE, '');
    log.info('[logger] bot.log 已清空');
    setInterval(() => {
      fs.writeFileSync(LOG_FILE, '');
      log.info('[logger] bot.log 已清空');
    }, DAY_MS);
  }, delay);
}

scheduleClear();
