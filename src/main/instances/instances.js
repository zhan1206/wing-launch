// 实例存储 / 创建 / 加载器安装 / 路由
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const config = require('../core/config');
const { dirs, ensure, instanceDir } = require('../core/paths');
const { UserError } = require('../core/ipc-gateway');
const { broadcast, toast } = require('../core/emitter');
const manager = require('../core/download/manager');
const sources = require('../core/download/sources');
const { getMergedMeta } = require('../meta/versions');
const javaMgr = require('../java/java-manager');
const { readJson, writeJson } = require('../core/config');
const { list: accountsList } = require('../accounts/accounts');

const FILE = () => dirs().instancesFile;
function load() { return readJson(FILE(), { instances: [] }); }
function save(d) { try { writeJson(FILE(), d); } catch (e) { console.log('[store] WRITE FAIL:', e.message); } broadcast('bb:instances-changed', list()); }
function list() {
  return load().instances.map((i) => ({
    id: i.id, name: i.name, versionId: i.versionId, launchVersionId: i.launchVersionId,
    loader: i.loader, loaderVersion: i.loaderVersion || null, cover: i.cover || null,
    lastPlayed: i.lastPlayed || null, createdAt: i.createdAt, boundAccountId: i.boundAccountId || null,
    modsCount: countMods(i.id), dir: i.dir,
  }));
}
function get(id) {
  const i = load().instances.find((x) => x.id === id);
  if (!i) throw new UserError('找不到这个实例，它可能已被删除。');
  return i;
}
function mutate(id, fn) {
  const d = load();
  const i = d.instances.find((x) => x.id === id);
  if (!i) throw new UserError('找不到这个实例，它可能已被删除。');
  fn(i);
  save(d);
  return i;
}
function countMods(id) {
  try { return fs.readdirSync(path.join(instanceDir(id), 'mods')).filter((f) => /\.jar$/.test(f)).length; } catch { return 0; }
}
function uniqueName(name) {
  const d = load();
  if (!d.instances.find((i) => i.name === name)) return name;
  for (let n = 2; ; n++) {
    const candidate = `${name} (${n})`;
    if (!d.instances.find((i) => i.name === candidate)) return candidate;
  }
}
function createDirs(id) {
  const dir = instanceDir(id);
  for (const sub of ['mods', 'saves', 'resourcepacks', 'shaderpacks', 'config', 'backups', '.blockbox']) {
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
  }
  return dir;
}

async function create({ name, versionId, loader = 'vanilla', loaderVersion = null }) {
  name = String(name || '').trim() || '我的世界';
  if (!versionId) throw new UserError('请选择一个游戏版本。');
  const finalName = uniqueName(name);
  const id = 'inst-' + crypto.randomBytes(4).toString('hex');
  const dir = createDirs(id);
  const inst = {
    id, name: finalName, versionId, launchVersionId: versionId, loader, loaderVersion,
    createdAt: Date.now(), lastPlayed: null, cover: null, boundAccountId: null,
    dir, settings: { memory: 'auto', width: config.get().width, height: config.get().height, fullscreen: false, jvmArgs: '' },
  };

  const progress = (taskId, stage, text, received, total) => broadcast('bb:install-progress', { taskId, stage, text, received, total });
  progress(id, 'meta', '正在读取版本信息…', 0, 1);
  const meta = await getMergedMeta(versionId);

  // Java 预备（自动下载缺失版本）
  const major = meta.javaVersion?.majorVersion || javaMgr.mapMajor(versionId).major;
  progress(id, 'java', `正在准备 Java ${major}（如已安装会直接使用）…`, 10, 100);
  await javaMgr.ensure(major);

  // 加载器
  if (loader !== 'vanilla') {
    progress(id, 'loader', loader === 'forge' ? '正在安装 Forge（需要联网，约 1-3 分钟）…' : `正在安装 ${loader}…`, 40, 100);
    const launchVersionId = await installLoader(loader, versionId, loaderVersion, id);
    inst.launchVersionId = launchVersionId;
    progress(id, 'loader', '加载器安装完成', 90, 100);
  } else {
    inst.launchVersionId = versionId;
  }

  const d = load();
  d.instances.push(inst);
  save(d);
  if (finalName !== name) toast(`已经有同名实例了，帮你改成了“${finalName}”`, 'info', 4000);
  return { id, renamedTo: finalName !== name ? finalName : null, instance: list().find((x) => x.id === id) };
}

async function installLoader(loader, mcVersion, loaderVersion, taskId) {
  if (loader === 'fabric') return installFabricQuilt('fabric', mcVersion, loaderVersion);
  if (loader === 'quilt') return installFabricQuilt('quilt', mcVersion, loaderVersion);
  if (loader === 'forge') return installForgeNeo('forge', mcVersion, loaderVersion, taskId);
  if (loader === 'neoforge') return installForgeNeo('neoforge', mcVersion, loaderVersion, taskId);
  throw new UserError(`暂不支持的加载器类型：${loader}`);
}

// Fabric / Quilt：拉取官方 profile json
async function installFabricQuilt(kind, mc, lv) {
  const baseUrl = kind === 'fabric' ? 'https://meta.fabricmc.net/v2' : 'https://meta.quiltmc.org/v3';
  if (!lv) {
    try {
      const arr = await sources.fetchJson(`${baseUrl}/versions/loader/${mc}`);
      const hit = (arr || []).find((x) => x.loader?.stable !== false) || arr?.[0];
      lv = hit?.loader?.version;
    } catch {
      throw new UserError(`获取 ${kind === 'fabric' ? 'Fabric' : 'Quilt'} 版本列表失败，请检查网络后重试。`);
    }
    if (!lv) throw new UserError(`暂不支持为 ${mc} 安装 ${kind === 'fabric' ? 'Fabric' : 'Quilt'}（官方还没有适配这个版本）。`);
  }
  const profileUrl = kind === 'fabric'
    ? `${baseUrl}/versions/loader/${mc}/${lv}/profile/json`
    : `${baseUrl}/versions/loader/${mc}/${lv}/profile/json`;
  let profile;
  try { profile = await sources.fetchJson(profileUrl); }
  catch { throw new UserError(`下载 ${kind === 'fabric' ? 'Fabric' : 'Quilt'} 配置失败，请检查网络后重试。`); }
  const id = profile.id || `${kind}-loader-${lv}-${mc}`;
  const vdir = path.join(dirs().versions, id);
  fs.mkdirSync(vdir, { recursive: true });
  fs.writeFileSync(path.join(vdir, `${id}.json`), JSON.stringify(profile, null, 2));
  return id;
}

// Forge / NeoForge：下载官方安装包并静默安装
async function installForgeNeo(kind, mc, lv, taskId) {
  let installerUrl, fname;
  if (kind === 'forge') {
    if (!lv) {
      lv = await forgeLatest(mc);
      if (!lv) throw new UserError(`没找到支持 ${mc} 的 Forge 版本。换个游戏版本试试。`);
    }
    installerUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${mc}-${lv}/forge-${mc}-${lv}-installer.jar`;
    fname = `forge-${mc}-${lv}-installer.jar`;
  } else {
    if (!lv) {
      lv = await neoforgeLatest(mc);
      if (!lv) throw new UserError(`没找到支持 ${mc} 的 NeoForge 版本。换个游戏版本试试。`);
    }
    const group = 'net/neoforged/neoforge';
    installerUrl = `https://maven.neoforged.net/releases/${group}/${lv}/neoforge-${lv}-installer.jar`;
    fname = `neoforge-${lv}-installer.jar`;
  }
  const installerJar = path.join(dirs().meta, fname);
  if (!fs.existsSync(installerJar) || fs.statSync(installerJar).size < 100000) {
    await manager.download({ name: fname, type: '游戏', url: installerUrl, dest: installerJar });
  }
  const installerJava = mcNum(mc) >= 11700 ? await javaMgr.ensure(21) : await javaMgr.ensure(8);
  const runInstaller = (javaPath) => new Promise((resolve, reject) => {
    execFile(path.join(javaPath, 'bin', 'java'), ['-jar', installerJar, '--installClient', dirs().root],
      { timeout: 10 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 }, (err, _o, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve()));
  });
  try {
    await runInstaller(installerJava.path);
  } catch (firstErr) {
    // 兼容性重试：换 Java 8 再跑一次（部分老安装包只兼容 Java 8）
    try {
      const j8 = await javaMgr.ensure(8);
      await runInstaller(j8.path);
    } catch {
      throw new UserError(`${kind === 'forge' ? 'Forge' : 'NeoForge'} 安装器运行失败。可能和当前 Java 环境不兼容，请稍后重试或换个版本。（${String(firstErr.message || firstErr).slice(0, 120)}）`);
    }
  }
  // 找到安装出来的版本 id
  const versionsRoot = dirs().versions;
  let best = null, bestTime = 0;
  for (const name of fs.readdirSync(versionsRoot)) {
    const jf = path.join(versionsRoot, name, `${name}.json`);
    if (!fs.existsSync(jf)) continue;
    const st = fs.statSync(jf);
    if (st.mtimeMs < Date.now() - 30 * 60 * 1000) continue; // 只看最近装的
    try {
      const j = JSON.parse(fs.readFileSync(jf, 'utf8'));
      if ((j.inheritsFrom === mc) && new RegExp(kind === 'forge' ? 'forge' : 'neoforge', 'i').test(name)) {
        if (st.mtimeMs > bestTime) { best = name; bestTime = st.mtimeMs; }
      }
    } catch { /* */ }
  }
  if (!best) throw new UserError(`${kind === 'forge' ? 'Forge' : 'NeoForge'} 安装器没有生成版本信息，请重试。`);
  return best;
}

async function forgeLatest(mc) {
  try {
    const promos = await sources.fetchJson('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json');
    const p = promos.promos || {};
    return p[`${mc}-recommended`] || p[`${mc}-latest`] || null;
  } catch { return null; }
}
function mcNum(v) {
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(v));
  return m ? (+m[1]) * 10000 + (+m[2]) * 100 + (+m[3] || 0) : 0;
}
async function neoforgeLatest(mc) {
  try {
    const xml = await sources.fetchText('https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml');
    const versions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]);
    const prefix = mc === '1.20.1' ? '1.20.1-' : `${String(mc).slice(2)}.`;
    const hits = versions.filter((v) => v.startsWith(prefix));
    if (!hits.length) return null;
    hits.sort((a, b) => {
      const pa = a.replace(prefix, '').split('.').map(Number);
      const pb = b.replace(prefix, '').split('.').map(Number);
      for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0); }
      return 0;
    });
    return hits[hits.length - 1];
  } catch { return null; }
}

// ---------- 路由 ----------
function registerAll(register) {
  register({
    'instances.list': () => list(),
    'instances.create': (p) => create(p),
    'instances.get': ({ id }) => { const i = get(id); return { ...i, modsCount: countMods(i.id) }; },
    'instances.rename': ({ id, name }) => {
      let finalName;
      mutate(id, (i) => { finalName = uniqueName(String(name || '').trim() || i.name); i.name = finalName; });
      return { name: finalName, renamed: finalName !== name };
    },
    'instances.remove': ({ id }) => {
      const d = load();
      const idx = d.instances.findIndex((x) => x.id === id);
      if (idx < 0) throw new UserError('实例不存在。');
      const inst = d.instances[idx];
      // 移入回收站（可撤销）
      const trashDir = path.join(dirs().trash, `实例-${inst.name}-${Date.now()}`);
      fs.mkdirSync(path.dirname(trashDir), { recursive: true });
      try { fs.renameSync(inst.dir, trashDir); } catch { fs.rmSync(inst.dir, { recursive: true, force: true }); }
      require('../core/trash').record(inst.dir, trashDir, '实例');
      d.instances.splice(idx, 1);
      save(d);
      return true;
    },
    'instances.setCover': ({ id, p }) => {
      mutate(id, (i) => { i.cover = p; });
      return true;
    },
    'instances.openFolder': ({ id }) => { const i = get(id); require('electron').shell.openPath(i.dir); return true; },
    'instances.getSettings': ({ id }) => get(id).settings,
    'instances.setSettings': ({ id, patch }) => {
      mutate(id, (i) => { i.settings = { ...i.settings, ...(patch || {}) }; });
      return get(id).settings;
    },
    'instances.setBoundAccount': ({ id, accountId }) => {
      mutate(id, (i) => { i.boundAccountId = accountId || null; });
      return true;
    },
    'instances.detail': (p) => { const id = typeof p === 'string' ? p : p?.id;
      const i = get(id);
      return {
        id: i.id, name: i.name, versionId: i.versionId, launchVersionId: i.launchVersionId,
        loader: i.loader, loaderVersion: i.loaderVersion || null, cover: i.cover || null,
        lastPlayed: i.lastPlayed, boundAccountId: i.boundAccountId || null,
        settings: i.settings, modsCount: countMods(i.id), dir: i.dir,
      };
    },
  });
}

module.exports = { registerAll, list, get, create, createDirs, installLoader, uniqueName, countMods };
