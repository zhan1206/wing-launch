// 模组管理：本地列表 / 启用禁用 / 在线搜索安装（Modrinth）/ 前置解析 / Iris 一键安装
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { instanceDir } = require('../core/paths');
const instances = require('./instances');
const manager = require('../core/download/manager');
const sources = require('../core/download/sources');
const { UserError } = require('../core/ipc-gateway');
const trash = require('../core/trash');
const { toast } = require('../core/emitter');

const LOADER_NAMES = { forge: 'Forge', fabric: 'Fabric', quilt: 'Quilt', neoforge: 'NeoForge', vanilla: '原版' };

function modsDir(id) { return path.join(instanceDir(id), 'mods'); }

// 解析 jar 内模组元数据
function parseModMeta(file) {
  const out = { file: path.basename(file), enabled: !file.endsWith('.disabled'), name: path.basename(file).replace(/\.jar(\.disabled)?$/, ''), version: '', loader: '', modIds: [], deps: [], size: 0 };
  try {
    out.size = fs.statSync(file).size;
    const zip = new AdmZip(file);
    const read = (p) => { try { const e = zip.getEntry(p); return e ? e.getData().toString('utf8') : null; } catch { return null; } };
    const fmj = read('fabric.mod.json');
    if (fmj) {
      try {
        const j = JSON.parse(fmj.replace(/^\uFEFF/, ''));
        out.name = j.name || j.id; out.version = j.version || ''; out.loader = 'fabric';
        out.modIds = [j.id];
        const deps = j.depends || {};
        out.deps = Object.keys(deps).filter((k) => !['minecraft', 'java', 'fabricloader', 'fabric-api', 'java-intermediary'].includes(k)).map((k) => ({ id: k, required: true }));
      } catch { /* */ }
      return out;
    }
    const toml = read('META-INF/mods.toml') || read('META-INF/neoforge.mods.toml');
    if (toml) {
      const modId = /modId\s*=\s*"([^"]+)"/.exec(toml);
      const disp = /displayName\s*=\s*"([^"]+)"/.exec(toml);
      const ver = /version\s*=\s*"([^"]+)"/.exec(toml);
      out.loader = 'forge'; out.modIds = modId ? [modId[1]] : [];
      out.name = disp ? disp[1] : out.name; out.version = ver ? ver[1] : '';
      const depBlocks = toml.split(/(?=\[\[dependencies\.\w+\]\])/).filter((b) => b.startsWith('[[dependencies.'));
      for (const b of depBlocks) {
        const id = /modId\s*=\s*"([^"]+)"/.exec(b)?.[1];
        const mandatory = /mandatory\s*=\s*true/.test(b);
        if (id && !['minecraft', 'java', 'forge', 'neoforge'].includes(id)) out.deps.push({ id, required: mandatory });
      }
      return out;
    }
    const info = read('mcmod.info');
    if (info) {
      try {
        const j = JSON.parse(info);
        if (j[0]) { out.name = j[0].name || out.name; out.version = j[0].version || ''; out.loader = 'forge'; out.modIds = j[0].modid ? [j[0].modid] : []; }
      } catch { /* */ }
    }
  } catch { /* jar 损坏也照样列出 */ }
  return out;
}

function list(instanceId) {
  instances.get(instanceId);
  const dir = modsDir(instanceId);
  fs.mkdirSync(dir, { recursive: true });
  const files = fs.readdirSync(dir).filter((f) => /\.jar(\.disabled)?$/.test(f)).sort();
  return files.map((f) => parseModMeta(path.join(dir, f)));
}

async function search({ query, gameVersion, loader, limit = 20 }) {
  const facets = [['project_type:mod']];
  if (gameVersion) facets.push([`versions:${gameVersion}`]);
  if (loader && loader !== 'vanilla') facets.push([`categories:${loader}`]);
  const url = `https://api.modrinth.com/v2/search?limit=${limit}&index=relevance&query=${encodeURIComponent(query || '')}&facets=${encodeURIComponent(JSON.stringify(facets))}`;
  try {
    const r = await sources.fetchJson(url);
    return (r.hits || []).map((h) => ({
      projectId: h.project_id, slug: h.slug, title: h.title, description: h.description,
      author: h.author, downloads: h.downloads, iconUrl: h.icon_url || null,
      versions: h.versions || [], loaders: (h.display_categories || []).filter((c) => ['forge', 'fabric', 'quilt', 'neoforge'].includes(c)),
    }));
  } catch (e) {
    if (e.userMessage) throw e; // 离线模式等已分类的错误直接透传
    throw new UserError('暂时连不上 Modrinth 模组商店。请检查网络后重试。');
  }
}

async function projectVersions({ projectId, gameVersion, loader }) {
  let url = `https://api.modrinth.com/v2/project/${projectId}/version?loaders=`;
  const params = [];
  if (loader && loader !== 'vanilla') params.push(`loaders=["${loader}"]`);
  if (gameVersion) params.push(`game_versions=["${gameVersion}"]`);
  url += params.length ? params.join('&') : '';
  let versions;
  try { versions = await sources.fetchJson(url); }
  catch (e) { if (e.userMessage) throw e; throw new UserError('获取模组版本列表失败，请检查网络后重试。'); }
  if (!versions.length && gameVersion) {
    // 放宽 loader 限制再试
    try { versions = await sources.fetchJson(`https://api.modrinth.com/v2/project/${projectId}/version?game_versions=["${gameVersion}"]`); } catch { /* */ }
  }
  if (!versions.length && loader) {
    try { versions = await sources.fetchJson(`https://api.modrinth.com/v2/project/${projectId}/version?loaders=["${loader}"]`); } catch { /* */ }
  }
  return versions.map((v) => {
    const primary = (v.files || []).find((f) => f.primary) || v.files?.[0];
    return {
      id: v.id, name: v.name || v.version_number, date: v.date_published,
      loaders: v.loaders, gameVersions: v.game_versions,
      filename: primary?.filename,
      deps: (v.dependencies || []).filter((d) => d.dependency_type === 'required' && d.project_id).map((d) => ({ projectId: d.project_id, versionId: d.version_id || null })),
      fileUrl: primary?.url, fileSha1: primary?.hashes?.sha1, fileSize: primary?.size || 0,
    };
  });
}

async function projectInfos(ids) {
  try {
    const r = await sources.fetchJson(`https://api.modrinth.com/v2/projects?ids=${encodeURIComponent(JSON.stringify(ids))}`);
    return Object.fromEntries(r.map((p) => [p.id, { title: p.title, slug: p.slug }]));
  } catch { return {}; }
}

async function installedModIds(instanceId) {
  const ids = new Set();
  for (const m of list(instanceId)) {
    for (const id of m.modIds || []) ids.add(id);
    const base = m.file.replace(/\.jar(\.disabled)?$/, '').toLowerCase();
    ids.add(base);
  }
  return ids;
}

async function install({ instanceId, projectId, versionId = null, extraVersionIds = [], force = false }) {
  const inst = instances.get(instanceId);
  const gv = inst.versionId;
  const loader = inst.loader === 'vanilla' ? null : inst.loader;

  const pickVersion = async (pid, vid) => {
    if (vid) {
      const vs = await projectVersions({ projectId: pid });
      return vs.find((v) => v.id === vid) || vs[0];
    }
    const vs = await projectVersions({ projectId: pid, gameVersion: gv, loader });
    if (!vs.length) return null;
    return vs[0];
  };

  const primary = await pickVersion(projectId, versionId);
  if (!primary) throw new UserError('这个模组没有适配当前游戏版本/加载器的版本。可以打开"显示所有版本"看看有没有可用的。');

  // 前置检查
  const have = await installedModIds(instanceId);
  const depProjects = primary.deps.filter((d) => d.projectId && !d.versionId);
  const depInfos = depProjects.length ? await projectInfos(depProjects.map((d) => d.projectId)) : {};
  const depPicks = [];
  for (const dep of primary.deps) {
    if (dep.versionId) { depPicks.push(dep); continue; }
    const depVer = await pickVersion(dep.projectId, null);
    if (!depVer) continue; // 没适配版本就先跳过，兼容性警告兜底
    const title = depInfos[dep.projectId]?.title || dep.projectId;
    // 通过文件名猜测 modId 判断是否已安装：不精确，按 slug 常见 modid 判断
    depPicks.push({ projectId: dep.projectId, versionId: depVer.id, title, filename: depVer.filename });
  }
  if (!force && !extraVersionIds.length && depPicks.length) {
    // 主进程无法精确判断"已安装的前置"，交给 UI 确认：返回 needsDeps
    const infos = await projectInfos([projectId]);
    return {
      needsDeps: depPicks,
      primary: { projectId, versionId: primary.id, title: infos[projectId]?.title || projectId, filename: primary.filename },
    };
  }

  const warnings = [];
  if (primary.gameVersions && primary.gameVersions.length && !primary.gameVersions.includes(gv)) {
    warnings.push(`这个模组标注支持的是 ${primary.gameVersions.slice(-3).join('、')}，你当前实例是 ${gv}。可能可以运行，但有可能出问题。`);
  }
  if (primary.loaders && primary.loaders.length && loader && !primary.loaders.includes(loader)) {
    warnings.push(`这个模组是为 ${primary.loaders.join('/')} 制作的，你的实例用的是 ${LOADER_NAMES[loader] || loader}。装上大概率会无法启动。`);
  }

  const targets = [{ url: primary.fileUrl, name: primary.filename, versionId: primary.id }];
  for (const d of depPicks) {
    if (!d.versionId) continue;
    const v = (await projectVersions({ projectId: d.projectId })).find((x) => x.id === d.versionId);
    if (v) targets.push({ url: v.fileUrl, name: v.filename, versionId: v.id });
  }

  const dir = modsDir(instanceId);
  fs.mkdirSync(dir, { recursive: true });
  const installed = [];
  for (const t of targets) {
    if (!t.url) continue;
    const dest = conflictFree(path.join(dir, t.name));
    await manager.download({ name: t.name, type: '模组', url: t.url, dest, sha1: null, size: 0 });
    installed.push(path.basename(dest));
  }
  return { ok: true, warnings, installed };
}

function conflictFree(p) {
  if (!fs.existsSync(p)) return p;
  const dir = path.dirname(p), ext = path.extname(p), base = path.basename(p, ext);
  for (let i = 1; ; i++) {
    const c = path.join(dir, `${base}-${i}${ext}`);
    if (!fs.existsSync(c)) return c;
  }
}

function scanMissing(instanceId) {
  const all = list(instanceId);
  const have = new Set();
  for (const m of all) { (m.modIds || []).forEach((x) => have.add(x)); }
  const missing = [];
  for (const m of all) {
    if (!m.enabled) continue;
    for (const d of m.deps || []) {
      if (!d.required) continue;
      if (!have.has(d.id)) missing.push({ name: d.id, from: m.name });
    }
  }
  return missing;
}

function toggle(instanceId, file, enabled) {
  const dir = modsDir(instanceId);
  const src = path.join(dir, file);
  const disabledSrc = path.join(dir, file.endsWith('.disabled') ? file : file + '.disabled');
  if (enabled) {
    if (!fs.existsSync(src) && fs.existsSync(disabledSrc)) fs.renameSync(disabledSrc, src);
  } else {
    if (fs.existsSync(src)) fs.renameSync(src, src + '.disabled');
  }
  return true;
}
function remove(instanceId, files) {
  const dir = modsDir(instanceId);
  for (const f of files) {
    const p = path.join(dir, f);
    if (fs.existsSync(p)) trash.deleteToTrash(p, '模组');
  }
  return true;
}
async function addFiles(instanceId, paths) {
  const dir = modsDir(instanceId);
  fs.mkdirSync(dir, { recursive: true });
  const installed = [], failed = [];
  for (const p of paths) {
    try {
      if (!/\.(jar|litemod)$/i.test(p)) throw new Error('不是模组文件（需要 .jar）');
      parseModMeta(p); // 顺带校验能否打开
      const dest = conflictFree(path.join(dir, path.basename(p)));
      fs.copyFileSync(p, dest);
      installed.push(path.basename(dest));
    } catch (e) {
      failed.push({ path: p, message: e.message === '不是模组文件（需要 .jar）' ? '这个文件不是模组（需要 .jar 文件）。' : '这个文件看起来不是有效的模组文件，可能已损坏。' });
    }
  }
  return { installed, failed };
}

// Iris 一键安装（Fabric/Quilt/NeoForge）
async function installIris(instanceId) {
  const inst = instances.get(instanceId);
  if (inst.loader === 'forge' || inst.loader === 'vanilla') {
    throw new UserError('Iris 目前只支持 Fabric/Quilt/NeoForge。Forge 实例请改用 OptiFine（暂未内置），或把实例换成 Fabric 后再装光影。');
  }
  const r = await search({ query: 'iris', gameVersion: inst.versionId, loader: inst.loader === 'vanilla' ? 'fabric' : inst.loader, limit: 5 });
  const iris = r.find((x) => x.slug === 'iris') || r[0];
  if (!iris) throw new UserError('没找到 Iris，请检查网络后重试。');
  const res = await install({ instanceId, projectId: iris.projectId, force: true });
  return res;
}

function registerAll(register) {
  register({
    'mods.list': ({ instanceId }) => list(instanceId),
    'mods.toggle': ({ instanceId, file, enabled }) => toggle(instanceId, file, enabled),
    'mods.remove': ({ instanceId, files }) => remove(instanceId, files || []),
    'mods.addFiles': ({ instanceId, paths }) => addFiles(instanceId, paths || []),
    'mods.scanMissing': ({ instanceId }) => scanMissing(instanceId),
    'mods.search': (p) => search(p),
    'mods.versions': (p) => projectVersions(p),
    'mods.install': (p) => install(p),
    'mods.meta': ({ instanceId, file }) => parseModMeta(path.join(modsDir(instanceId), file)),
  });
}

module.exports = { registerAll, list, parseModMeta, install, installIris, search, modsDir, addFiles, toggle, scanMissing };
