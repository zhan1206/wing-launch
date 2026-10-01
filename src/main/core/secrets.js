// 敏感信息安全存储：macOS Keychain（Electron safeStorage）加密落盘
// 令牌、API Key 等一律经由本模块，禁止明文写入普通配置文件或日志
const fs = require('fs');
const path = require('path');
const { safeStorage, app } = require('electron');

const FILE = () => path.join(app.getPath('userData'), 'secrets.enc');
let cache = null; // { key: Buffer(明文) }

function available() {
  try { return safeStorage.isEncryptionAvailable(); } catch { return false; }
}
function load() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(FILE());
    const obj = JSON.parse(raw.toString('utf8'));
    cache = {};
    for (const [k, v] of Object.entries(obj)) {
      try { cache[k] = safeStorage.decryptString(Buffer.from(v, 'base64')); } catch { /* 跳过损坏条目 */ }
    }
  } catch { cache = {}; }
  return cache;
}
function persist() {
  const out = {};
  for (const [k, v] of Object.entries(cache)) {
    if (available()) out[k] = safeStorage.encryptString(v).toString('base64');
  }
  const tmp = FILE() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(out));
  fs.renameSync(tmp, FILE());
}
function set(key, value) {
  if (!available()) return false; // 不可用时调用方必须把敏感值只留在内存
  load(); cache[key] = String(value ?? ''); persist(); return true;
}
function get(key) { load(); return Object.prototype.hasOwnProperty.call(cache, key) ? cache[key] : null; }
function has(key) { load(); return Object.prototype.hasOwnProperty.call(cache, key); }
function remove(key) { load(); if (cache[key] !== undefined) { delete cache[key]; persist(); } }

function __all() { load(); return { ...cache }; }

module.exports = { available, set, get, has, remove, __all };
