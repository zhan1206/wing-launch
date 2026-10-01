// 下载源管理：官方源 ↔ 国内镜像(BMCLAPI) 自动切换
const MIRROR_HOST_MAP = [
  ['https://piston-meta.mojang.com/', 'https://bmclapi2.bangbang93.com/'],
  ['https://piston-data.mojang.com/', 'https://bmclapi2.bangbang93.com/'],
  ['https://launcher.mojang.com/', 'https://bmclapi2.bangbang93.com/'],
  ['https://launchermeta.mojang.com/', 'https://bmclapi2.bangbang93.com/'],
  ['https://libraries.minecraft.net/', 'https://bmclapi2.bangbang93.com/maven/'],
  ['https://resources.download.minecraft.net/', 'https://bmclapi2.bangbang93.com/assets/'],
];

let preferMirror = false; // 会话级：auto 模式下官方源连续失败后切换

function mirrorOf(url) {
  for (const [from, to] of MIRROR_HOST_MAP) {
    if (url.startsWith(from)) return to + url.slice(from.length);
  }
  return null;
}

// 依据设置返回候选 URL 列表（有序）
function candidates(url, source = 'auto') {
  const m = mirrorOf(url);
  if (source === 'official') return [url];
  if (source === 'mirror') return m ? [m, url] : [url];
  if (preferMirror) return m ? [m, url] : [url];
  return m ? [url, m] : [url];
}

function noteFailure(usedUrl, source) {
  if (source !== 'auto') return;
  const m = mirrorOf(usedUrl);
  if (!m && usedUrl.includes('mojang.com')) preferMirror = true; // 官方源不行，转镜像
}

function noteSuccess(source) { if (source === 'auto') preferMirror = false; }

// 小体积 JSON/文本 拉取（自动镜像）
async function fetchText(url, { timeout = 15000, headers = {}, source = 'auto' } = {}) {
  // 离线模式：所有联网请求统一拦截，给出中文解释
  try {
    const config = require('../config');
    if (config.get().offlineMode) throw Object.assign(new Error('OFFLINE_MODE'), { userMessage: '当前处于离线模式，联网功能已停用。已下载的内容和单机游戏不受影响；在“设置”里关闭离线模式即可恢复联网功能。' });
  } catch (e) { if (e.userMessage) throw e; }
  let lastErr;
  for (const u of candidates(url, source)) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetch(u, { signal: ctl.signal, headers: { 'user-agent': 'WingLaunch/1.0 (bmclapi compatible)', ...headers } });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      noteSuccess(source);
      return text;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      noteFailure(u, source);
    }
  }
  throw lastErr || new Error('网络请求失败');
}
async function fetchJson(url, opts) { return JSON.parse(await fetchText(url, opts)); }

module.exports = { candidates, mirrorOf, fetchText, fetchJson, noteFailure, noteSuccess, isPreferMirror: () => preferMirror };
