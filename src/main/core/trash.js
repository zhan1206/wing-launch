// 回收站：删除先移入这里，支持撤销；7 天后清理
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { dirs } = require('./paths');

const INDEX = () => path.join(dirs().trash, 'index.json');
function loadIndex() { return config.readJson(INDEX(), { records: [] }); }
function saveIndex(d) { config.writeJson(INDEX(), d); }

// record(originPath, trashPath, kind)
function record(originPath, trashPath, kind) {
  const d = loadIndex();
  d.records.push({ origin: originPath, trash: trashPath, kind: kind || '文件', time: Date.now() });
  d.records = d.records.slice(-200);
  saveIndex(d);
}
// deleteToTrash(p, kind, name?) → 移动到回收站
function deleteToTrash(p, kind = '文件') {
  if (!fs.existsSync(p)) return null;
  const base = path.basename(p);
  let dest = path.join(dirs().trash, `${base}-${Date.now()}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try { fs.renameSync(p, dest); } catch {
    // 跨设备等情况退回复制
    fs.cpSync(p, dest, { recursive: true });
    fs.rmSync(p, { recursive: true, force: true });
  }
  record(p, dest, kind);
  return dest;
}
function undoLast() {
  const d = loadIndex();
  const rec = d.records.pop();
  if (!rec) return null;
  try {
    fs.mkdirSync(path.dirname(rec.origin), { recursive: true });
    if (!fs.existsSync(rec.origin)) fs.renameSync(rec.trash, rec.origin);
  } catch { /* 恢复失败：保留回收站文件 */ }
  saveIndex(d);
  return rec;
}
function trashList() {
  const d = loadIndex();
  return d.records.map((r) => ({
    origin: r.origin, trash: r.trash, kind: r.kind, time: r.time,
    name: path.basename(r.origin),
    exists: fs.existsSync(r.trash),
    originFree: !fs.existsSync(r.origin),
  }));
}
function purgeOld(days = 7) {
  const d = loadIndex();
  const keep = [];
  const now = Date.now();
  for (const r of d.records) {
    if (now - r.time > days * 86400 * 1000) {
      try { fs.rmSync(r.trash, { recursive: true, force: true }); } catch { /* */ }
    } else keep.push(r);
  }
  d.records = keep;
  saveIndex(d);
}

module.exports = { record, deleteToTrash, undoLast, trashList, purgeOld };
