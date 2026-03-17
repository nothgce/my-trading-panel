import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const STORE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../botConfig.json'
);

export const botConfig = {
  alertTopicId: null,   // 警报推送的话题 ID（null = 不指定话题）
};

try {
  if (fs.existsSync(STORE_PATH)) {
    Object.assign(botConfig, JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')));
    console.log(`[botConfig] 已加载，alertTopicId=${botConfig.alertTopicId}`);
  }
} catch (e) {
  console.error('[botConfig] 读取失败:', e.message);
}

export function saveBotConfig() {
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(botConfig, null, 2), 'utf8');
  } catch (e) {
    console.error('[botConfig] 保存失败:', e.message);
  }
}
