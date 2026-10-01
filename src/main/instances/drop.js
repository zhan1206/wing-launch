// 拖拽导入：文件类型识别 + 自动安装
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const instances = require('./instances');
const mods = require('./mods');
const contents = require('./contents');
const modpack = require('../modpack/modpack');
const { UserError } = require('../core/ipc-gateway');
const { toast, broadcast } = require('../core/emitter');

function sniff(p) {
  let st;
  try { st = fs.statSync(p); } catch { return { kind: 'unknown', reason: '文件不存在' }; }
  const ext = path.extname(p).toLowerCase();
  if (st.isDirectory()) {
    if (fs.existsSync(path.join(p, 'level.dat'))) return { kind: 'world' };
    if (fs.existsSync(path.join(p, 'pack.mcmeta'))) return { kind: 'resourcepack' };
    if (fs.existsSync(path.join(p, 'shaders'))) return { kind: 'shaderpack' };
    return { kind: 'unknown', reason: '这个文件夹看起来不是存档、资源包或光影包。' };
  }
  if (ext === '.mrpack') return { kind: 'modpack' };
  if (ext === '.zip') {
    try {
      const zip = new AdmZip(p);
      const names = zip.getEntries().map((e) => e.entryName);
      if (names.some((n) => n === 'modrinth.index.json')) return { kind: 'modpack', format: 'mrpack' };
      if (names.some((n) => n === 'manifest.json' && names.some((x) => x.startsWith('overrides/')))) return { kind: 'modpack', format: 'curseforge' };
      if (names.some((n) => n === 'level.dat' || n.endsWith('/level.dat'))) return { kind: 'world' };
      if (names.some((n) => n === 'pack.mcmeta' || n.endsWith('/pack.mcmeta'))) return { kind: 'resourcepack' };
      if (names.some((n) => /(^|\/)shaders\//.test(n))) return { kind: 'shaderpack' };
    } catch {
      return { kind: 'unknown', reason: '压缩包无法读取，可能已损坏。' };
    }
    return { kind: 'unknown', reason: '这个压缩包的内容不像模组包、资源包、光影包或存档。' };
  }
  if (ext === '.jar' || ext === '.litemod') return { kind: 'mod' };
  if (ext === '.litematic' || ext === '.schematic' || ext === '.schem') return { kind: 'schematic' };
  return { kind: 'unknown', reason: `启动器还不认识 .${ext.slice(1) || '?'} 这种文件。` };
}

function classify(paths) {
  return paths.map((p) => {
    const s = sniff(p);
    return { path: p, kind: s.kind, detail: s };
  });
}

async function install({ paths, instanceId = null, targetTab = null }) {
  const results = [];
  let lastMessage = null;
  for (const p of paths) {
    const s = sniff(p);
    try {
      if (s.kind === 'modpack') {
        const r = await modpack.install({ path: p });
        lastMessage = { type: 'ok', message: `整合包安装成功！已创建实例“${r.instanceName}”。` };
        broadcast('bb:instances-changed', instances.list());
      } else if (s.kind === 'mod') {
        if (!instanceId) throw new UserError('请先打开一个实例的“模组”标签页，再把模组拖进去。');
        const r = await mods.addFiles(instanceId, [p]);
        if (r.installed.length) lastMessage = { type: 'ok', message: `模组已安装到实例。` };
        else if (r.failed.length) lastMessage = { type: 'error', message: r.failed[0].message };
      } else if (s.kind === 'resourcepack' || s.kind === 'shaderpack') {
        if (!instanceId) throw new UserError(`请先打开一个实例的“${s.kind === 'resourcepack' ? '资源包' : '光影包'}”标签页，再拖进来。`);
        const kind = s.kind === 'resourcepack' ? 'resourcepacks' : 'shaderpacks';
        const r = await contents.packsAdd(instanceId, kind, [p]);
        if (r.installed.length) lastMessage = { type: 'ok', message: `已安装到实例的${s.kind === 'resourcepack' ? '资源包' : '光影包'}列表。` };
        else lastMessage = { type: 'error', message: r.failed[0]?.message || '安装失败。' };
      } else if (s.kind === 'world') {
        if (!instanceId) throw new UserError('请先打开一个实例的“存档”标签页，再把存档拖进来。');
        const r = await contents.worldsImport(instanceId, [p]);
        if (r.imported.length) lastMessage = { type: 'ok', message: `存档“${r.imported[0]}”导入成功！` };
        else lastMessage = { type: 'error', message: r.failed[0]?.message || '导入失败。' };
      } else if (s.kind === 'schematic') {
        lastMessage = { type: 'info', message: '这是投影文件。请到「工具集 → 投影工坊」打开查看。' };
      } else {
        lastMessage = {
          type: 'warn',
          message: '这个文件看起来不是 MC 模组/资源包/光影/存档。你可以把它放到实例文件夹中手动管理（实例详情 → 打开文件夹），或者换一个文件试试。',
        };
      }
    } catch (e) {
      lastMessage = { type: 'error', message: e.userMessage || `导入失败：${e.message}` };
    }
    results.push({ path: p, kind: s.kind });
  }
  broadcast('bb:instances-changed', instances.list());
  return { results, ...lastMessage };
}

function registerAll(register) {
  register({
    'drop.classify': ({ paths }) => classify(paths || []),
    'drop.install': ({ paths, instanceId, targetTab }) => install({ paths: paths || [], instanceId, targetTab }),
    'drop.sniff': ({ path: p }) => sniff(p),
  });
}
module.exports = { registerAll, classify, sniff, install };
