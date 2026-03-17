import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const STORE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../presets.json'
);

let _nextId = 2;
const newId = () => `p${_nextId++}`;

const mkDefault = () => ({
  id: 'default',
  name: '默认',
  timeframe: '5m',       // Jupiter API endpoint timeframe
  minMcap: 0,
  maxMcap: 1_000_000,
  minNetVolume: 1_000,
  minLiquidity: 5_000,
  minTokenAge: 4_320,    // minutes
  maxTokenAge: null,     // minutes, null = no upper limit
  hasSocials: true,
  minCluster: 8,         // quickScan: strictly greater than
});

export const scanConfig = {
  activePresetId: 'default',
  presets: [mkDefault()],
};

// 启动时从文件恢复
try {
  if (fs.existsSync(STORE_PATH)) {
    const saved = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    if (saved.presets?.length) {
      scanConfig.presets = saved.presets;
      scanConfig.activePresetId = saved.activePresetId ?? saved.presets[0].id;
      // 恢复 _nextId 防止 id 冲突
      for (const p of saved.presets) {
        const m = String(p.id).match(/^p(\d+)$/);
        if (m) _nextId = Math.max(_nextId, parseInt(m[1]) + 1);
      }
      console.log(`[scanConfig] 已从 ${STORE_PATH} 恢复 ${saved.presets.length} 个预设`);
    }
  }
} catch (e) {
  console.error('[scanConfig] 读取预设文件失败，使用默认配置:', e.message);
}

export function saveConfig() {
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(scanConfig, null, 2), 'utf8');
  } catch (e) {
    console.error('[scanConfig] 保存失败:', e.message);
  }
}

export const getActivePreset = () =>
  scanConfig.presets.find(p => p.id === scanConfig.activePresetId) ?? scanConfig.presets[0];

export const getPreset = id => scanConfig.presets.find(p => p.id === id);

export function addPreset(name) {
  const p = { ...mkDefault(), id: newId(), name: name.slice(0, 20) };
  scanConfig.presets.push(p);
  saveConfig();
  return p;
}

export function deletePreset(id) {
  if (scanConfig.presets.length <= 1) return false;
  const idx = scanConfig.presets.findIndex(p => p.id === id);
  if (idx < 0) return false;
  scanConfig.presets.splice(idx, 1);
  if (scanConfig.activePresetId === id)
    scanConfig.activePresetId = scanConfig.presets[0].id;
  saveConfig();
  return true;
}

export function setActive(id) {
  if (!scanConfig.presets.some(p => p.id === id)) return false;
  scanConfig.activePresetId = id;
  saveConfig();
  return true;
}
