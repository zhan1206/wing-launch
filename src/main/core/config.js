// 设置存取：JSON 文件 + 默认值深合并
const fs = require('fs');
const path = require('path');
const os = require('os');
const { dirs } = require('./paths');
const log = require('./log');

const DEFAULTS = {
  theme: { mode: 'dark', color: '#4f8cff', background: null, blur: 6, dim: 0.45 },
  homepage: 'classic',
  memory: 'auto',            // 'auto' | MB 数字
  width: 854, height: 480, fullscreen: false,
  downloadSource: 'auto',    // auto | official | mirror
  showSnapshots: false,
  wizardDone: false,
  language: 'zh-CN',
  customThemes: [],          // 用户保存的主题
  currentThemeId: 'builtin-default',
  translate: { apiBase: 'https://api.deepseek.com', model: 'deepseek-chat', apiKey: '' },
  msClientId: '',            // 微软登录应用 ID（默认用内置公共 ID，可覆盖）
  maxConcurrentDownloads: 4,
  fontSize: 'md',            // sm | md | lg | xl（无障碍）
  contrast: 'normal',        // normal | high
  motion: 'normal',          // normal | reduced（减少动画）
  colorblindMode: false,     // 色盲友好：状态附加符号
  offlineMode: false,        // 离线模式
  proxy: { mode: 'system', host: '', port: '' },
  update: { url: '', skipVersion: '' },
  taskChecklist: {},         // 新手任务清单完成状态
  devMode: false,            // 开发者模式（默认关闭）
  localApiEnabled: false,    // 本地 API（默认关闭）
  language: 'zh-CN',         // 界面语言（S2）
  performance: { preset: 'balanced' },
  sync: { enabled: false, folder: '' },
  afterLaunch: 'nothing',        // nothing | minimize | quit（启动后动作，默认不动作）
  seenBubbles: {},           // 页面气泡引导已读
};

function deepMerge(base, patch) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(patch || {})) {
    const v = patch[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && base?.[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], v);
    } else out[k] = v;
  }
  return out;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    // 文件损坏：保留损坏副本供诊断，尝试 .bak 恢复
    try {
      if (fs.existsSync(file)) fs.copyFileSync(file, file + '.corrupt-' + Date.now());
    } catch { /* */ }
    try {
      const bak = file + '.bak';
      if (fs.existsSync(bak)) {
        const parsed = JSON.parse(fs.readFileSync(bak, 'utf8'));
        try { fs.copyFileSync(bak, file); } catch { /* */ }
        return parsed;
      }
    } catch { /* */ }
    return fallback;
  }
}
function writeJson(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  // 原子替换前保留上一份完好副本
  try { if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak'); } catch { /* */ }
  fs.renameSync(tmp, file);
}

let SETTINGS = null;
function get() {
  if (SETTINGS) return SETTINGS;
  const file = dirs().settingsFile;
  SETTINGS = deepMerge(DEFAULTS, readJson(file, {}));
  return SETTINGS;
}
function set(patch) {
  get();
  SETTINGS = deepMerge(SETTINGS, patch);
  writeJson(dirs().settingsFile, SETTINGS);
  return SETTINGS;
}
function isFirstRun() { return !fs.existsSync(dirs().settingsFile); }

// 自动内存：系统内存的 1/4，最少 2048MB，最多 8192MB
function autoMemoryMB() {
  const total = os.totalmem() / 1024 / 1024;
  return Math.max(2048, Math.min(8192, Math.round(total / 4 / 512) * 512));
}
function memoryMB() { const m = get().memory; return m === 'auto' ? autoMemoryMB() : Number(m) || autoMemoryMB(); }

module.exports = { get, set, isFirstRun, autoMemoryMB, memoryMB, readJson, writeJson, deepMerge, DEFAULTS };
