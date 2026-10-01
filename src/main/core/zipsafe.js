// 压缩包安全释放：防路径穿越 + 防压缩包炸弹（总量/条目数/膨胀比上限）
const path = require('path');
const fs = require('fs');
const { UserError } = require('./ipc-gateway');

const DEFAULTS = { maxTotalBytes: 4 * 1024 * 1024 * 1024, maxEntries: 30000, maxRatio: 300 };

function safeName(entryName) {
  // 拒绝绝对路径、盘符、.. 上跳
  if (!entryName || entryName.startsWith('/') || /^[A-Za-z]:[\\/]/.test(entryName)) return null;
  const norm = path.normalize(entryName).replace(/\\/g, '/');
  if (norm.startsWith('..') || norm.split('/').includes('..')) return null;
  return norm;
}

// 把 zip 中满足前缀的条目安全释放到 destDir
function safeExtract(zip, destDir, { prefix = '', limits = {} } = {}) {
  const cfg = { ...DEFAULTS, ...limits };
  const entries = zip.getEntries().filter((e) => !e.isDirectory && (!prefix || e.entryName.startsWith(prefix)));
  if (entries.length > cfg.maxEntries) throw new UserError(`这个压缩包包含的文件数量异常（超过 ${cfg.maxEntries} 个），为了安全起见已停止导入。`);
  let total = 0;
  for (const e of entries) {
    const us = e.header ? (e.header.size || 0) : 0;
    total += us;
    if (total > cfg.maxTotalBytes) throw new UserError('这个压缩包解压后的体积异常庞大，为防止占满磁盘已停止导入。');
    if (us > 0 && e.header.compressedSize > 0) {
      const ratio = us / e.header.compressedSize;
      if (ratio > cfg.maxRatio) throw new UserError('这个压缩包存在异常的压缩膨胀（疑似压缩包炸弹），已停止导入。');
    }
  }
  for (const e of entries) {
    const rel = safeName(e.entryName);
    if (!rel) continue;
    const out = rel.startsWith(prefix) && prefix ? path.join(destDir, rel.slice(prefix.length + 1)) : path.join(destDir, rel);
    if (!path.resolve(out).startsWith(path.resolve(destDir) + path.sep)) continue; // 双保险
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, e.getData());
  }
  return entries.length;
}

// 校验单个 zip 是否安全（不释放，用于导入前预检）
function assertSafe(zip, limits = {}) {
  const cfg = { ...DEFAULTS, ...limits };
  const entries = zip.getEntries();
  if (entries.length > cfg.maxEntries) throw new UserError(`这个压缩包文件数量异常（超过 ${cfg.maxEntries} 个），已停止导入。`);
  let total = 0;
  for (const e of entries) {
    if (safeName(e.entryName) === null) throw new UserError('这个压缩包里有路径不安全的文件（试图写到预期目录之外），已停止导入。');
    const us = e.header ? (e.header.size || 0) : 0;
    total += us;
    if (total > cfg.maxTotalBytes) throw new UserError('这个压缩包解压后的体积异常庞大，为防止占满磁盘已停止导入。');
  }
  return true;
}

module.exports = { safeExtract, assertSafe, safeName };
