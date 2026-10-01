// 整合包：Modrinth (.mrpack) 与 CurseForge (.zip) 解析安装
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const instances = require('../instances/instances');
const manager = require('../core/download/manager');
const sources = require('../core/download/sources');
const javaMgr = require('../java/java-manager');
const { UserError } = require('../core/ipc-gateway');
const { broadcast, toast } = require('../core/emitter');
const zipsafe = require('../core/zipsafe');
const { mapMajor } = require('../java/java-manager');
const servers = require('../server/servers');

function progress(taskId, stage, text, received, total) {
  broadcast('bb:install-progress', { taskId, stage, text, received, total });
}

function readZipJson(zip, name) {
  const e = zip.getEntry(name);
  if (!e) return null;
  try { return JSON.parse(e.getData().toString('utf8')); } catch { return null; }
}

async function inspect(p) {
  if (!fs.existsSync(p)) throw new UserError('文件不存在，可能已被移动或删除。');
  const ext = path.extname(p).toLowerCase();
  if (ext === '.mrpack') {
    const zip = new AdmZip(p);
    const idx = readZipJson(zip, 'modrinth.index.json');
    if (!idx) throw new UserError('这个 .mrpack 文件缺少 modrinth.index.json，可能不完整。');
    const deps = idx.dependencies || {};
    const loader = deps['fabric-loader'] ? 'fabric' : deps['quilt-loader'] ? 'quilt' : deps['neoforge'] ? 'neoforge' : deps['forge'] ? 'forge' : 'vanilla';
    return {
      type: 'mrpack', name: idx.name || path.basename(p, '.mrpack'), version: idx.versionId || '',
      loader, loaderVersion: deps['fabric-loader'] || deps['quilt-loader'] || deps['neoforge'] || deps['forge'] || null,
      mcVersion: deps.minecraft, modsCount: (idx.files || []).length,
      serverSupported: (idx.files || []).some((f) => f.env?.server === 'required') || true,
      javaMajor: mapMajor(deps.minecraft).major,
    };
  }
  if (ext === '.zip') {
    const zip = new AdmZip(p);
    const manifest = readZipJson(zip, 'manifest.json');
    if (!manifest) throw new UserError('这个压缩包不是整合包（没有 manifest.json / modrinth.index.json）。');
    const ml = manifest.minecraft?.modLoaders?.[0]?.id || '';
    const loader = ml.startsWith('forge') ? 'forge' : ml.startsWith('neoforge') ? 'neoforge' : ml.startsWith('fabric') ? 'fabric' : ml.startsWith('quilt') ? 'quilt' : 'vanilla';
    return {
      type: 'curseforge', name: manifest.name || path.basename(p, '.zip'), version: manifest.version || '',
      loader, loaderVersion: ml.split('-').slice(1).join('-') || null,
      mcVersion: manifest.minecraft?.version, modsCount: (manifest.files || []).length,
      serverSupported: true, javaMajor: mapMajor(manifest.minecraft?.version).major,
    };
  }
  throw new UserError('整合包需要是 .zip 或 .mrpack 文件。');
}

async function install({ path: packPath, name = null, createServer = false }) {
  const info = await inspect(packPath);
  const zip = new AdmZip(packPath);
  const instanceName = name || info.name || '整合包实例';

  // Java 提示（整合包需要更高 Java 时自动下载）
  progress('modpack', 'java', `这个整合包需要 Java ${info.javaMajor}，正在确认 Java 环境…`, 5, 100);
  await javaMgr.ensure(info.javaMajor);

  const r = await instances.create({ name: instanceName, versionId: info.mcVersion, loader: info.loader, loaderVersion: info.loaderVersion });
  const instanceId = r.id;
  const inst = instances.get(instanceId);
  const dir = inst.dir;

  let missing = [];
  if (info.type === 'mrpack') {
    const idx = readZipJson(zip, 'modrinth.index.json');
    // overrides 解压
    progress('modpack', 'files', '正在解压整合包配置…', 20, 100);
    extractOverride(zip, 'overrides', dir);
    // 下载文件
    const files = (idx.files || []).filter((f) => f.env?.client !== 'unavailable');
    const dl = files
      .filter((f) => zipsafe.safeName(f.path)) // 索引里的相对路径可能带 ../，跳过以免写到实例目录之外
      .map((f) => ({
        name: path.basename(f.path), type: '模组', url: f.downloads[0], dest: path.join(dir, zipsafe.safeName(f.path)),
        sha1: f.hashes?.sha1 || null, size: f.fileSize || 0,
      }));
    progress('modpack', 'mods', `正在下载整合包内容 ${dl.length} 个文件…`, 40, 100);
    if (dl.length) {
      const res = await manager.addBulk(dl);
      missing = res.failures || [];
    }
  } else {
    // CurseForge
    const manifest = readZipJson(zip, 'manifest.json');
    progress('modpack', 'files', '正在解压整合包配置…', 20, 100);
    extractOverride(zip, 'overrides', dir);
    progress('modpack', 'mods', `正在解析整合包中的 ${manifest.files?.length || 0} 个文件（CurseForge 需要在线解析）…`, 40, 100);
    const resolved = await resolveCurseforgeFiles(manifest.files || []);
    const dl = resolved.ok
      .filter((f) => zipsafe.safeName(f.filename))
      .map((f) => ({ name: f.filename, type: '模组', url: f.url, dest: path.join(dir, 'mods', zipsafe.safeName(f.filename)) }));
    if (dl.length) {
      const res = await manager.addBulk(dl);
      missing = res.failures || [];
    }
    missing.push(...resolved.failed.map((f) => ({ name: `CurseForge 项目 ${f.projectID} 文件 ${f.fileID}`, error: '未能解析下载地址' })));
  }

  let serverId = null;
  if (createServer) {
    progress('modpack', 'server', '正在准备服务器（下载服务端可能需要几分钟）…', 70, 100);
    try {
      const sr = await servers.createFromModpack({ info, zip, instanceName: info.name, dir });
      serverId = sr.id;
    } catch (e) {
      toast(`服务器创建失败：${e.userMessage || e.message}。客户端实例不受影响。`, 'error', 6000);
    }
  }

  progress('modpack', 'done', '整合包安装完成', 100, 100);
  broadcast('bb:instances-changed', instances.list());
  if (missing.length) {
    toast(`整合包基本安装完成，但有 ${missing.length} 个文件没能下载（${missing[0].name} 等）。可以稍后在模组列表里搜索补装。`, 'warn', 8000);
  }
  return { instanceId, serverId, instanceName: inst.name, missingCount: missing.length };
}

function extractOverride(zip, prefix, destDir) {
  const { safeExtract } = require('../core/zipsafe');
  try { safeExtract(zip, destDir, { prefix }); } catch (e) { throw e.userMessage ? e : new Error('整合包压缩包安全检查未通过：' + e.message); }
}

// CurseForge 文件解析：cfwidget / curse.tools 镜像 + forgecdn 直链拼装
async function resolveCurseforgeFiles(fileRefs) {
  const ok = [], failed = [];
  const cache = new Map();
  for (const ref of fileRefs) {
    try {
      let data = cache.get(ref.projectID);
      if (!data) {
        data = await fetchCfProject(ref.projectID);
        cache.set(ref.projectID, data);
      }
      const file = (data.files || []).find((f) => f.id === ref.fileID);
      if (!file || !file.name) throw new Error('未找到文件');
      const url = forgecdnUrl(file.id, file.name);
      ok.push({ filename: file.name, url });
    } catch {
      failed.push(ref);
    }
  }
  return { ok, failed };
}
async function fetchCfProject(projectId) {
  const endpoints = [
    `https://api.cfwidget.com/minecraft/mc-mods/id/${projectId}`,
    `https://cfwidget.com/${projectId}`,
  ];
  for (const u of endpoints) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 8000);
      const res = await fetch(u, { signal: ctl.signal, headers: { 'user-agent': 'WingLaunch/1.0' } });
      clearTimeout(timer);
      if (!res.ok) continue;
      const j = await res.json();
      if (j?.files?.length) return j;
    } catch { /* 下一个 */ }
  }
  throw new Error('CF 解析失败');
}
function forgecdnUrl(fileId, filename) {
  // https://mediafilez.forgecdn.net/files/<fid/1000>/<fid%1000>/<filename>
  const a = Math.floor(fileId / 1000), b = fileId % 1000;
  return `https://mediafilez.forgecdn.net/files/${a}/${b}/${encodeURIComponent(filename)}`;
}

function registerAll(register) {
  register({
    'modpack.inspect': ({ path: p }) => inspect(p),
    'modpack.install': (p) => install(p),
  });
}
module.exports = { registerAll, inspect, install, extractOverride, resolveCurseforgeFiles };
