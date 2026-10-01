// 实例内容管理：存档 / 资源包 / 光影包 / 备份
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { instanceDir, dirs } = require('../core/paths');
const instances = require('./instances');
const mods = require('./mods');
const trash = require('../core/trash');
const { UserError } = require('../core/ipc-gateway');

const INSTANCE_KINDS = { world: '存档', mod: '模组', resourcepack: '资源包', shaderpack: '光影包' };

/* ---------- options.txt 读写 ---------- */
function readOptions(instanceId) {
  const p = path.join(instanceDir(instanceId), 'options.txt');
  const map = {};
  try {
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const i = line.indexOf(':');
      if (i > 0) map[line.slice(0, i)] = line.slice(i + 1);
    }
  } catch { /* */ }
  return map;
}
function writeOptions(instanceId, patch) {
  const p = path.join(instanceDir(instanceId), 'options.txt');
  const map = readOptions(instanceId);
  Object.assign(map, patch);
  const text = Object.entries(map).map(([k, v]) => `${k}:${v}`).join('\n');
  fs.writeFileSync(p, text);
}

/* ---------- 存档 ---------- */
async function worldMeta(worldDir) {
  const levelDat = path.join(worldDir, 'level.dat');
  if (!fs.existsSync(levelDat)) return null;
  try {
    const nbt = await import('prismarine-nbt');
    const parse = nbt.parse || nbt.default?.parse;
    const { parsed } = await new Promise((resolve, reject) => parse(fs.readFileSync(levelDat), (e, r) => (e ? reject(e) : resolve({ parsed: r }))));
    const nbt2 = nbt.simplify || nbt.default?.simplify;
    const data = nbt2 ? nbt2(parsed) : parsed;
    const d = data.Data || data.data || {};
    return {
      name: d.LevelName || path.basename(worldDir),
      version: d.Version?.Name || '',
      lastPlayed: Number(d.LastPlayed) || fs.statSync(levelDat).mtimeMs,
      hardcore: !!d.hardcore,
    };
  } catch { return { name: path.basename(worldDir), version: '', lastPlayed: fs.statSync(levelDat).mtimeMs }; }
}
function worldsList(instanceId) {
  instances.get(instanceId);
  const saves = path.join(instanceDir(instanceId), 'saves');
  fs.mkdirSync(saves, { recursive: true });
  const out = [];
  for (const name of fs.readdirSync(saves)) {
    const dir = path.join(saves, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    const meta = worldMetaSync(dir);
    if (!meta) continue;
    out.push({ dir: name, ...meta, icon: fs.existsSync(path.join(dir, 'icon.png')) ? 'bbimg://' + encodeURIComponent(path.join(dir, 'icon.png')) : null });
  }
  return out;
}
function worldMetaSync(dir) {
  const levelDat = path.join(dir, 'level.dat');
  if (!fs.existsSync(levelDat)) return null;
  return { name: path.basename(dir), version: '', lastPlayed: fs.statSync(levelDat).mtimeMs };
}
function uniqueIn(dir, name) {
  if (!fs.existsSync(path.join(dir, name))) return name;
  for (let i = 2; ; i++) if (!fs.existsSync(path.join(dir, `${name} (${i})`))) return `${name} (${i})`;
}
function worldsImport(instanceId, paths) {
  const saves = path.join(instanceDir(instanceId), 'saves');
  fs.mkdirSync(saves, { recursive: true });
  const imported = [], failed = [];
  for (const p of paths) {
    try {
      if (fs.statSync(p).isDirectory()) {
        const root = findWorldRoot(p);
        if (!root) throw new Error('这个文件夹里没有找到 level.dat，不像是一个完整的存档。');
        const name = uniqueIn(saves, path.basename(root));
        fs.cpSync(root, path.join(saves, name), { recursive: true });
        imported.push(name);
      } else if (/\.zip$/i.test(p)) {
        const zip = new AdmZip(p);
        const { assertSafe, safeExtract } = require('../core/zipsafe');
        assertSafe(zip, { maxTotalBytes: 8 * 1024 * 1024 * 1024 });
        const tmp = path.join(saves, `.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        safeExtract(zip, tmp);
        const root = findWorldRoot(tmp);
        if (!root) { fs.rmSync(tmp, { recursive: true, force: true }); throw new Error('这个压缩包里没有找到 level.dat，不像是一个完整的存档。'); }
        const name = uniqueIn(saves, path.basename(root));
        fs.renameSync(root, path.join(saves, name));
        fs.rmSync(tmp, { recursive: true, force: true });
        imported.push(name);
      } else {
        throw new Error('存档需要是一个文件夹或 .zip 压缩包。');
      }
    } catch (e) {
      failed.push({ path: p, message: e.userMessage || e.message });
    }
  }
  return { imported, failed };
}
function findWorldRoot(p) {
  if (fs.existsSync(path.join(p, 'level.dat'))) return p;
  for (const c of fs.readdirSync(p)) {
    const d = path.join(p, c);
    if (fs.statSync(d).isDirectory() && fs.existsSync(path.join(d, 'level.dat'))) return d;
  }
  return null;
}
function worldsExport(instanceId, worldDir, destZip) {
  const src = path.join(instanceDir(instanceId), 'saves', path.basename(worldDir));
  if (!fs.existsSync(src)) throw new UserError('存档不存在，可能已被删除。');
  const zip = new AdmZip();
  zip.addLocalFolder(src, path.basename(src));
  const out = destZip.endsWith('.zip') ? destZip : destZip + '.zip';
  zip.writeZip(out);
  return out;
}
function worldsRemove(instanceId, worldDir) {
  trash.deleteToTrash(path.join(instanceDir(instanceId), 'saves', path.basename(worldDir)), '存档');
  return true;
}

/* ---------- 资源包 / 光影包 ---------- */
function packDir(instanceId, kind) { return path.join(instanceDir(instanceId), kind === 'resourcepacks' ? 'resourcepacks' : 'shaderpacks'); }
function packsList(instanceId, kind) {
  instances.get(instanceId);
  const dir = packDir(instanceId, kind);
  fs.mkdirSync(dir, { recursive: true });
  const files = fs.readdirSync(dir).filter((f) => !f.startsWith('.')).sort();
  const opts = readOptions(instanceId);
  let enabledSet;
  if (kind === 'resourcepacks') {
    let arr = [];
    try { arr = JSON.parse(opts.resourcePacks || '[]'); } catch { /* */ }
    enabledSet = new Set(arr.map((x) => String(x).replace(/^file\//, '')));
  } else {
    const state = configReadJson(instanceId, 'shaders.json', { enabled: [] });
    enabledSet = new Set(state.enabled);
  }
  return files.map((f) => {
    const st = fs.statSync(path.join(dir, f));
    return { file: f, enabled: enabledSet.has(f), size: st.size, isDir: st.isDirectory(), mtime: st.mtimeMs };
  });
}
function configReadJson(instanceId, name, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(instanceDir(instanceId), '.blockbox', name), 'utf8')); } catch { return fallback; }
}
function configWriteJson(instanceId, name, data) {
  fs.mkdirSync(path.join(instanceDir(instanceId), '.blockbox'), { recursive: true });
  fs.writeFileSync(path.join(instanceDir(instanceId), '.blockbox', name), JSON.stringify(data, null, 2));
}
function packsAdd(instanceId, kind, paths) {
  const dir = packDir(instanceId, kind);
  fs.mkdirSync(dir, { recursive: true });
  const installed = [], failed = [];
  for (const p of paths) {
    try {
      const isZip = /\.zip$/i.test(p);
      const isDir = fs.statSync(p).isDirectory();
      if (!isZip && !(isDir && kind === 'resourcepacks')) throw new Error('资源包/光影包需要是 .zip 文件。');
      // 内容校验
      if (isZip) {
        const zip = new AdmZip(p);
        require('../core/zipsafe').assertSafe(zip);
        const names = zip.getEntries().map((e) => e.entryName);
        const okPack = kind === 'resourcepacks'
          ? names.some((n) => n === 'pack.mcmeta' || n.endsWith('/pack.mcmeta'))
          : names.some((n) => /shaders/.test(n));
        if (!okPack) throw new Error(kind === 'resourcepacks' ? '压缩包里没有 pack.mcmeta，不是有效的资源包。' : '压缩包里没有 shaders 目录，不是有效的光影包。');
      }
      const dest = path.join(dir, uniqueIn(dir, path.basename(p)));
      if (isDir) fs.cpSync(p, dest, { recursive: true });
      else fs.copyFileSync(p, dest);
      installed.push(path.basename(dest));
    } catch (e) { failed.push({ path: p, message: e.message }); }
  }
  return { installed, failed };
}
function packsRemove(instanceId, kind, files) {
  const dir = packDir(instanceId, kind);
  for (const f of files) {
    const p = path.join(dir, f);
    if (fs.existsSync(p)) trash.deleteToTrash(p, kind === 'resourcepacks' ? '资源包' : '光影包');
  }
  if (kind === 'resourcepacks') packsReorder(instanceId, packsList(instanceId, kind).filter((x) => !files.includes(x.file)).map((x) => x.file));
  return true;
}
function packsToggle(instanceId, kind, file, enabled) {
  if (kind === 'resourcepacks') {
    const current = packsList(instanceId, kind);
    const set = current.filter((x) => x.enabled).map((x) => x.file);
    const next = enabled ? [...set.filter((f) => f !== file), file] : set.filter((f) => f !== file);
    packsReorder(instanceId, next);
  } else {
    const state = configReadJson(instanceId, 'shaders.json', { enabled: [] });
    const set = new Set(state.enabled);
    if (enabled) set.add(file); else set.delete(file);
    configWriteJson(instanceId, 'shaders.json', { enabled: [...set] });
    writeOptions(instanceId, { shaderPack: enabled ? `shaderpacks/${file}` : '' });
  }
  return true;
}
function packsReorder(instanceId, orderedFiles) {
  writeOptions(instanceId, { resourcePacks: JSON.stringify(['vanilla', ...orderedFiles.map((f) => `file/${f}`)]) });
  return true;
}

/* ---------- 光影加载器检测 ---------- */
function shadersDetect(instanceId) {
  const all = mods.list(instanceId);
  const hasIris = all.some((m) => m.enabled && (m.modIds || []).some((x) => /iris/i.test(x)) || /iris/i.test(m.name) && m.enabled);
  const hasOptifine = all.some((m) => m.enabled && (m.modIds || []).some((x) => /optifine/i.test(x)) || /optifine/i.test(m.name) && m.enabled);
  if (hasIris) return { loader: 'iris' };
  if (hasOptifine) return { loader: 'optifine' };
  return { loader: null, suggestion: '使用光影需要先安装 Iris 或 OptiFine，要现在安装吗？' };
}
async function shadersInstall(instanceId) {
  return mods.installIris(instanceId);
}

/* ---------- 备份 ---------- */
function backupMeta(instanceId) { return configReadJson(instanceId, 'backup-meta.json', {}); }
function backupsList(instanceId) {
  instances.get(instanceId);
  const dir = path.join(instanceDir(instanceId), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const meta = backupMeta(instanceId);
  return fs.readdirSync(dir).filter((f) => f.endsWith('.bbbak')).map((f) => {
    const st = fs.statSync(path.join(dir, f));
    return { file: f, name: meta[f]?.name || f.replace(/\.bbbak$/, ''), time: st.mtimeMs, kind: meta[f]?.kind || 'full', size: st.size };
  }).sort((a, b) => b.time - a.time);
}
function makeBackup(instanceId, { name, kind = 'full', auto = false } = {}) {
  const dir = instanceDir(instanceId);
  const bdir = path.join(dir, 'backups');
  fs.mkdirSync(bdir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fname = `${stamp}-${(name || (auto ? '自动备份' : '手动备份')).replace(/[\\/:*?"<>|]/g, '_')}.bbbak`;
  const zip = new AdmZip();
  const includeLight = ['config', 'options.txt', 'servers.dat', '.blockbox'];
  const includeFull = [...includeLight, 'mods', 'saves', 'resourcepacks', 'shaderpacks'];
  for (const item of (kind === 'full' ? includeFull : includeLight)) {
    const p = path.join(dir, item);
    if (!fs.existsSync(p)) continue;
    if (fs.statSync(p).isDirectory()) zip.addLocalFolder(p, item);
    else zip.addLocalFile(p, '', item);
  }
  zip.writeZip(path.join(bdir, fname));
  const meta = backupMeta(instanceId);
  meta[fname] = { kind, auto, name: name || (auto ? '自动备份' : '手动备份'), time: Date.now() };
  configWriteJson(instanceId, 'backup-meta.json', meta);
  // 清理旧的自动备份：轻量保留 3 份，完整保留 2 份
  for (const k of ['light', 'full']) {
    const autos = backupsList(instanceId).filter((b) => b.kind === k && meta[b.file]?.auto);
    for (const old of autos.slice(k === 'light' ? 3 : 2)) {
      trash.deleteToTrash(path.join(bdir, old.file), '备份');
      delete meta[old.file];
    }
  }
  configWriteJson(instanceId, 'backup-meta.json', meta);
  return fname;
}
function backupsCreate(instanceId, opts) {
  instances.get(instanceId);
  return makeBackup(instanceId, { ...opts, auto: false });
}
function backupsRestore(instanceId, file) {
  const dir = instanceDir(instanceId);
  const p = path.join(dir, 'backups', file);
  if (!fs.existsSync(p)) throw new UserError('备份文件不存在，可能已被删除。');
  makeBackup(instanceId, { name: '恢复前自动备份', kind: 'full', auto: true });
  const zip = new AdmZip(p);
  require('../core/zipsafe').assertSafe(zip, { maxTotalBytes: 16 * 1024 * 1024 * 1024 });
  for (const e of zip.getEntries()) {
    if (e.isDirectory) continue;
    const rel = require('../core/zipsafe').safeName(e.entryName);
    if (rel === null) continue; // 拒绝路径穿越条目
    const dest = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, e.getData());
  }
  return true;
}
function backupsRemove(instanceId, file) {
  trash.deleteToTrash(path.join(instanceDir(instanceId), 'backups', file), '备份');
  return true;
}

// 启动前自动备份
function autoBackupBeforeLaunch(instanceId, lastFullBackupAt) {
  makeBackup(instanceId, { kind: 'light', auto: true });
  const needFull = !lastFullBackupAt || (Date.now() - lastFullBackupAt > 7 * 86400 * 1000);
  if (needFull) makeBackup(instanceId, { kind: 'full', auto: true });
  return true;
}

function registerAll(register) {
  register({
    'worlds.list': ({ instanceId }) => worldsList(instanceId),
    'worlds.importFiles': ({ instanceId, paths }) => worldsImport(instanceId, paths || []),
    'worlds.export': ({ instanceId, worldDir, destZip }) => worldsExport(instanceId, worldDir, destZip),
    'worlds.remove': ({ instanceId, worldDir }) => worldsRemove(instanceId, worldDir),
    'packs.list': ({ instanceId, kind }) => packsList(instanceId, kind),
    'packs.addFiles': ({ instanceId, kind, paths }) => packsAdd(instanceId, kind, paths || []),
    'packs.remove': ({ instanceId, kind, files }) => packsRemove(instanceId, kind, files || []),
    'packs.toggle': ({ instanceId, kind, file, enabled }) => packsToggle(instanceId, kind, file, enabled),
    'packs.reorder': ({ instanceId, files }) => packsReorder(instanceId, files || []),
    'shaders.detect': ({ instanceId }) => shadersDetect(instanceId),
    'shaders.install': ({ instanceId }) => shadersInstall(instanceId),
    'backups.list': ({ instanceId }) => backupsList(instanceId),
    'backups.create': ({ instanceId, name, kind }) => backupsCreate(instanceId, { name, kind }),
    'backups.restore': ({ instanceId, file }) => backupsRestore(instanceId, file),
    'backups.remove': ({ instanceId, file }) => backupsRemove(instanceId, file),
  });
}

module.exports = { registerAll, worldsList, worldsImport, packsList, packsAdd, packsReorder, shadersDetect, backupsList, makeBackup, autoBackupBeforeLaunch, INSTANCE_KINDS, worldsExport, packsToggle };
