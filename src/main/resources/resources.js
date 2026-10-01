// 资源管理器：扫描所有实例资源 + 未使用清理 + 批量操作 + 回收站
const fs = require('fs');
const path = require('path');
const { dirs, instanceDir } = require('../core/paths');
const { list: instancesRaw } = require('../instances/instances');
const accounts = require('../accounts/accounts');
const trash = require('../core/trash');
const { UserError } = require('../core/ipc-gateway');
const { broadcast } = require('../core/emitter');

const KIND_INFO = {
  mod: { label: '模组', dir: 'mods', icon: '🧩' },
  resourcepack: { label: '资源包', dir: 'resourcepacks', icon: '🎨' },
  shaderpack: { label: '光影包', dir: 'shaderpacks', icon: '✨' },
  world: { label: '存档', dir: 'saves', icon: '🗺️' },
};

function dirSize(p) {
  try {
    const st = fs.statSync(p);
    if (st.isFile()) return st.size;
    let total = 0;
    for (const f of fs.readdirSync(p)) total += dirSize(path.join(p, f));
    return total;
  } catch { return 0; }
}

function scan() {
  const out = [];
  for (const inst of instancesRaw()) {
    const base = instanceDir(inst.id);
    for (const [kind, info] of Object.entries(KIND_INFO)) {
      const dir = path.join(base, info.dir);
      if (!fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir)) {
        if (name.startsWith('.')) continue;
        const p = path.join(dir, name);
        const isDir = fs.statSync(p).isDirectory();
        if (!isDir && !/\.(zip|jar|mcpack)$/.test(name) && kind !== 'world') continue;
        if (kind === 'world' && !isDir) continue;
        out.push({
          path: p, kind, name, instanceId: inst.id, instanceName: inst.name,
          size: dirSize(p), mtime: fs.statSync(p).mtimeMs,
          enabled: kind === 'mod' ? !name.endsWith('.disabled') : true,
          referenced: kind === 'mod' ? !name.endsWith('.disabled') : true,
        });
      }
    }
  }
  // 皮肤
  try {
    for (const s of JSON.parse(fs.readFileSync(path.join(dirs().skins, 'skins.json'), 'utf8'))) {
      const p = path.join(dirs().skins, s.id + '.png');
      if (fs.existsSync(p)) out.push({ path: p, kind: 'skin', name: s.name + '.png', size: fs.statSync(p).size, instanceName: '皮肤库', mtime: fs.statSync(p).mtimeMs, enabled: true, referenced: isSkinUsed(s.id) });
    }
  } catch { /* */ }
  return out;
}

function isSkinUsed(skinId) {
  try {
    const d = require('../accounts/accounts').load();
    return d.accounts.some((a) => a.skinId === skinId);
  } catch { return false; }
}

function cleanScan() {
  return scan().filter((r) => r.referenced === false || r.enabled === false);
}

function deletePaths({ paths }) {
  let n = 0;
  for (const p of paths) {
    if (fs.existsSync(p)) { trash.deleteToTrash(p, '资源'); n++; }
  }
  broadcast('bb:instances-changed', instancesRaw());
  return { count: n };
}
function undoDelete() {
  const rec = trash.undoLast();
  if (!rec) throw new UserError('没有可以撤销的删除操作。');
  broadcast('bb:instances-changed', instancesRaw());
  return { name: rec.name };
}
function trashList() { return trash.trashList(); }

function moveToInstance({ paths, instanceId, kind }) {
  const info = KIND_INFO[kind];
  if (!info) throw new UserError('不支持的资源类型。');
  const dest = path.join(instanceDir(instanceId), info.dir);
  fs.mkdirSync(dest, { recursive: true });
  const moved = [];
  for (const p of paths) {
    if (!fs.existsSync(p)) continue;
    let target = path.join(dest, path.basename(p));
    if (fs.existsSync(target)) target = path.join(dest, `${Date.now()}-${path.basename(p)}`);
    fs.cpSync(p, target, { recursive: true });
    moved.push(path.basename(target));
  }
  broadcast('bb:instances-changed', instancesRaw());
  return { moved };
}
function exportPaths({ paths, destDir }) {
  fs.mkdirSync(destDir, { recursive: true });
  const copied = [];
  for (const p of paths) {
    if (!fs.existsSync(p)) continue;
    let target = path.join(destDir, path.basename(p));
    if (fs.existsSync(target)) target = path.join(destDir, `${Date.now()}-${path.basename(p)}`);
    fs.cpSync(p, target, { recursive: true });
    copied.push(target);
  }
  return { copied };
}

function registerAll(register) {
  register({
    'resources.scan': () => scan(),
    'resources.cleanScan': () => cleanScan(),
    'resources.delete': (p) => deletePaths(p),
    'resources.undoDelete': () => undoDelete(),
    'resources.trashList': () => trashList(),
    'resources.moveToInstance': (p) => moveToInstance(p),
    'resources.export': (p) => exportPaths(p),
  });
}
module.exports = { registerAll };
