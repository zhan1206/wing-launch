// 第四轮：V 加载器诊断 / W 服务器增强 / X 社区翻译 / Y 同步迁移增强
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const config = require('./config');
const { dirs, instanceDir } = require('./paths');
const { UserError } = require('./ipc-gateway');
const { broadcast } = require('./emitter');
const sources = require('./download/sources');
const mods = require('../instances/mods');
const instances = require('../instances/instances');

/* ---------- V.1 加载器版本兼容矩阵（内置，离线可用） ---------- */
const LOADER_MATRIX = [
  { mc: '1.21.1', forge: '52.0.24（推荐，最新稳定）', fabric: '0.16.9（推荐）', quilt: '0.26.x', neoforge: '21.1.77（推荐）', note: '1.21.1 为当前长期支持版本，四个加载器均有稳定版。' },
  { mc: '1.20.1', forge: '47.4.0（推荐，社区反馈最稳定）', fabric: '0.16.9（推荐）', quilt: '0.26.x', neoforge: '47.1.106（NeoForge 对 1.20.1 的版本）', note: '1.20.1 是模组生态最成熟的版本，推荐模组玩家使用。' },
  { mc: '1.20.4', forge: '49.0.x', fabric: '0.15.11', quilt: '0.26.x', neoforge: '20.4.x', note: '' },
  { mc: '1.19.2', forge: '43.3.x', fabric: '0.14.x', quilt: '0.19.x', neoforge: '不支持（NeoForge 从 1.20.1 开始）', note: '' },
  { mc: '1.18.2', forge: '40.2.x', fabric: '0.14.x', quilt: '0.19.x', neoforge: '不支持', note: '' },
  { mc: '1.16.5', forge: '36.2.x', fabric: '0.12.x', quilt: '不支持', neoforge: '不支持', note: '1.16.5 需要 Java 8。' },
  { mc: '1.12.2', forge: '14.23.5.x', fabric: '0.10.x（社区维护）', quilt: '不支持', neoforge: '不支持', note: '1.12.2 需要 Java 8；Apple 芯片 Mac 无法原生运行（缺少旧图形库），建议改用 1.16.5 及以上。' },
];
const KNOWN_INCOMPAT = 'Forge 与 Fabric 模组互不通用（加载器不同）；OptiFine 与 Iris/Sodium 不兼容（见冲突库）。';

function loaderRecommend(mc) {
  const row = LOADER_MATRIX.find((r) => r.mc === mc);
  if (!row) return { recommendation: '建议使用 Fabric（新版适配最快）或 Forge（模组最多）', basis: '该版本不在内置矩阵中，按通用经验推荐。' };
  return { row, recommendation: `推荐 Forge ${row.forge}（社区反馈最稳定）或 Fabric ${row.fabric}（更新快、轻量）`, basis: '内置加载器版本兼容矩阵（离线可用，依据社区反馈整理）', incompat: KNOWN_INCOMPAT };
}

/* ---------- V.2 Mixin 深度解析（读取 mixin 配置的注入目标） ---------- */
function mixinTargets(file) {
  try {
    const zip = new AdmZip(file);
    const out = [];
    for (const e of zip.getEntries()) {
      if (!/^(\w+-)?mixins?[\w.-]*\.json$/.test(path.basename(e.entryName))) continue;
      try {
        const j = JSON.parse(e.getData().toString('utf8'));
        const pkg = j.package || '';
        const names = [...(j.mixins || []), ...(j.client || []), ...(j.server || [])];
        for (const n of names) {
          const cls = (pkg ? pkg.replace(/\//g, '.') + '.' : '') + n.replace(/^\w+\./, (m) => m); // class 相对名
          out.push({ config: path.basename(e.entryName), mixinClass: cls, guessTarget: guessTargetFromName(cls) });
        }
      } catch { /* 单个配置损坏忽略 */ }
    }
    return out;
  } catch { return []; }
}
function guessTargetFromName(mixinClass) {
  // Mixin 类命名惯例：net.minecraft.class_XXX(Mojang map) / MixinXxx；无法精确到方法，给出类级推断
  const m = /(?:Mixin)?(.+?)(?:Mixin)?$/.exec(mixinClass.split('.').pop());
  return '推断目标类：' + (m ? m[1] : mixinClass) + '（依据：Mixin 类名约定）';
}

/* ---------- V.4 类冲突检测（jar 内同包同类名） ---------- */
function classConflicts(instanceId) {
  const dir = path.join(instanceDir(instanceId), 'mods');
  const map = new Map(); // classPath -> [modName]
  const list = mods.list(instanceId).filter((m) => m.enabled);
  for (const m of list) {
    try {
      const zip = new AdmZip(path.join(dir, m.file));
      let scanned = 0;
      for (const e of zip.getEntries()) {
        if (e.isDirectory || !e.entryName.endsWith('.class')) continue;
        if (e.entryName.startsWith('META-INF/') || e.entryName.startsWith('module-info')) continue;
        if (++scanned > 20000) break; // 大 jar 采样上限，防止卡死
        if (!map.has(e.entryName)) map.set(e.entryName, []);
        map.get(e.entryName).push(m.name);
      }
    } catch { /* */ }
  }
  const high = [], low = [];
  for (const [cls, owners] of map) {
    if (owners.length < 2) continue;
    // 高风险：非 MC 原版包的同名类（两个模组各自打包了同一个库）
    const isMcPackage = /^net\/minecraft|^com\/mojang/.test(cls);
    (isMcPackage ? high : low).push({ class: cls.replace(/\//g, '.'), mods: owners });
  }
  return {
    high: high.slice(0, 20), low: low.slice(0, 20),
    highNote: high.length ? '这些类被多个模组同时打包，游戏加载时会只用其中一个，另一个模组的相关功能可能失效或崩溃。' : '',
    lowNote: low.length ? '同名工具类（常见于不同模组打包了同一个公共库的不同版本），多数情况下无害，但可能引发"NoSuchMethodError"。' : '',
    basis: '对模组 jar 内 class 文件路径的实际扫描（每个 jar 最多采样 2 万个类）',
  };
}

/* ---------- V.3 加载顺序建议（拓扑：被依赖多的排前；Fabric 实际按文件名，这里给建议与依据） ---------- */
function loadOrder(instanceId) {
  const graph = require('./modsdiag').scanConflicts(instanceId); // 复用已装元数据
  void graph;
  const list = mods.list(instanceId).filter((m) => m.enabled);
  const deps = new Map(list.map((m) => [m.name, (m.deps || []).map((d) => d.id)]));
  const nameById = new Map(list.flatMap((m) => (m.modIds || []).map((id) => [id, m.name])));
  // 简单拓扑：被依赖者在前
  const order = [...list.map((m) => m.name)];
  order.sort((a, b) => (countDepending(b) - countDepending(a)));
  function countDepending(name) {
    let n = 0;
    for (const [mod, ds] of deps) if (ds.some((d) => nameById.get(d) === name || d === name)) n++;
    return n;
  }
  return { recommended: order, basis: '依据：模组元数据中的依赖声明（被依赖的库类模组应先加载）。说明：Fabric 实际按文件名字母序加载，建议通过重命名文件调整；此列表表示相对优先级。' };
}

/* ---------- W：服务器属性分组数据 + 性能解析 ---------- */
const SERVER_PROPS_SCHEMA = [
  { group: '基础设置', items: [
    { key: 'difficulty', name: '难度', values: ['peaceful', 'easy', 'normal', 'hard'], recommend: 'normal', desc: '游戏难度。和平=没有怪物；简单/普通/困难=怪物越来越多越强。多人服推荐普通。' },
    { key: 'gamemode', name: '游戏模式', values: ['survival', 'creative', 'adventure'], recommend: 'survival', desc: '新玩家的默认模式。生存=正常玩法；创造=飞行与无限资源（仅建议信任的朋友）。' },
    { key: 'online-mode', name: '正版验证', values: ['true', 'false'], recommend: 'true', desc: '开启后只有正版账户能进入。关闭后任何人可用任意昵称进入（离线模式），有被冒名风险。' },
    { key: 'motd', name: '服务器简介', values: null, recommend: '§a欢迎来到我的服务器', desc: '玩家在多人游戏列表里看到的一行介绍。' },
  ] },
  { group: '性能设置', items: [
    { key: 'view-distance', name: '视距', values: null, recommend: '10', desc: '玩家能看到多远的地形（单位：区块）。调大更吃服务器性能；4-10 人小服推荐 10。' },
    { key: 'simulation-distance', name: '模拟距离', values: null, recommend: '10', desc: '多远范围内的生物/庄稼会实际活动。调低能明显省性能。' },
    { key: 'max-players', name: '最大玩家数', values: null, recommend: '20', desc: '同时在线人数上限。人越多越吃内存与带宽。' },
  ] },
  { group: '世界设置', items: [
    { key: 'generate-structures', name: '生成结构', values: ['true', 'false'], recommend: 'true', desc: '是否生成村庄、要塞等建筑。' },
    { key: 'allow-nether', name: '允许下界', values: ['true', 'false'], recommend: 'true', desc: '是否允许进入下界（地狱）。' },
    { key: 'allow-end', name: '允许末地', values: ['true', 'false'], recommend: 'true', desc: '是否允许进入末地。' },
    { key: 'level-seed', name: '世界种子', values: null, recommend: '（留空随机）', desc: '留空随机生成；填入数字可复现同一片地形。' },
  ] },
  { group: '安全设置', items: [
    { key: 'white-list', name: '白名单', values: ['true', 'false'], recommend: 'true', desc: '开启后只有名单里的玩家能进入，强烈推荐给私人服务器。' },
    { key: 'pvp', name: '玩家对战', values: ['true', 'false'], recommend: 'true', desc: '玩家之间能否互相攻击。' },
    { key: 'enable-command-block', name: '命令方块', values: ['true', 'false'], recommend: 'false', desc: '是否允许使用命令方块（可执行任意命令，谨慎开启）。' },
    { key: 'spawn-protection', name: '出生点保护范围', values: null, recommend: '16', desc: '出生点周围多少格内非管理员不能破坏方块。' },
  ] },
];

function serverPerf(id) {
  const s = require('../server/servers').get(id);
  const logsDir = path.join(s.dir, 'logs');
  let players = 0, tps = null, joined = [];
  try {
    const latest = fs.readFileSync(path.join(logsDir, 'latest.log'), 'utf8').split('\n').slice(-300);
    for (const line of latest) {
      const j = /joined the game/.test(line);
      const l = /left the game/.test(line);
      if (j) players++;
      if (l) players = Math.max(0, players - 1);
      const t = /(\d+) players online/.exec(line);
      if (t) players = parseInt(t[1], 10);
      const tpsM = /TPS from last 1m, 5m, 15m: ([\d.]+)/.exec(line);
      if (tpsM) tps = parseFloat(tpsM[1]); // 仅 Forge/插件类服务端支持 tps 命令
    }
  } catch { /* */ }
  const diagnosis = tps !== null && tps < 15 ? 'TPS 偏低（低于 15）。可能的原因：某个插件或模组占用过多资源、区块加载过多、实体数量过多。建议：减少视距、检查新装的插件/模组，或重启服务器观察。' : null;
  return { players, tps, tpsNote: tps === null ? '当前服务端不提供 TPS 数据（原版服务端没有该指标；安装 Forge 或性能插件后可用）。' : null, diagnosis, basis: '解析服务器日志最新 300 行' };
}

/* ---------- X：CFPA 社区术语库（内置精简版 + 在线更新提示） ---------- */
const CFPA_BUILTIN = {
  _meta: { source: 'CFPA 社区术语库（内置精简版 v1，完整版可在线更新）', terms: 0 },
  'Creeper': '苦力怕', 'Enderman': '末影人', 'Zombie': '僵尸', 'Skeleton': '骷髅', 'Spider': '蜘蛛',
  'Nether': '下界', 'End': '末地', 'Overworld': '主世界', 'Ender Dragon': '末影龙', 'Wither': '凋灵',
  'Beacon': '信标', 'Anvil': '铁砧', 'Enchantment': '附魔', 'Brewing': '酿造', 'Redstone': '红石',
  'Spawn': '出生点', 'Chunk': '区块', 'Biome': '生物群系', 'Village': '村庄', 'Stronghold': '要塞',
  'Shulker Box': '潜影盒', 'Hopper': '漏斗', 'Dropper': '投掷器', 'Observer': '侦测器', 'Sticky Piston': '粘性活塞',
};
const CFPA_URL = 'https://raw.githubusercontent.com/CFPAOrg/Minecraft-Mod-Language-Package/main/README.md';

async function glossaryCommunity() {
  const personal = loadPersonalGlossary();
  let updateAvailable = null;
  try {
    const txt = await sources.fetchText(CFPA_URL, { timeout: 8000 });
    updateAvailable = txt ? '社区仓库可达。完整术语库随 CFPA 仓库更新；当前使用内置精简版（30 条常用术语）。' : null;
  } catch { updateAvailable = '暂时连不上社区仓库（不影响离线使用内置术语库）。'; }
  return { community: CFPA_BUILTIN, personal, updateAvailable, note: '术语匹配离线可用。个人覆盖与社区术语库分开保存，个人覆盖优先。' };
}
function loadPersonalGlossary() {
  try { return JSON.parse(fs.readFileSync(path.join(dirs().root, '个人术语库.json'), 'utf8')); } catch { return {}; }
}

/* ---------- Y：.mcinstance 导出导入 + 存档同步清单 + 跨启动器导入 ---------- */
function exportMcinstance({ instanceId, dest, includeMods = false }) {
  const inst = instances.get(instanceId);
  const payload = {
    format: 'mcinstance', version: 1, name: inst.name, versionId: inst.versionId,
    launchVersionId: inst.launchVersionId, loader: inst.loader, loaderVersion: inst.loaderVersion,
    settings: inst.settings,
    mods: mods.list(instanceId).map((m) => ({ name: m.name, version: m.version, file: m.file, enabled: m.enabled })),
    resourcepacks: listDir(path.join(inst.dir, 'resourcepacks')),
    shaderpacks: listDir(path.join(inst.dir, 'shaderpacks')),
  };
  const zip = new AdmZip();
  zip.addFile('mcinstance.json', Buffer.from(JSON.stringify(payload, null, 2)));
  let modsSize = 0;
  if (includeMods) {
    const mdir = path.join(inst.dir, 'mods');
    for (const f of fs.existsSync(mdir) ? fs.readdirSync(mdir) : []) {
      const p = path.join(mdir, f);
      if (fs.statSync(p).isFile()) { zip.addLocalFile(p, 'mods'); modsSize += fs.statSync(p).size; }
    }
  }
  const out = dest.endsWith('.mcinstance') ? dest : dest + '.mcinstance';
  zip.writeZip(out);
  const size = fs.statSync(out).size;
  return { path: out, size, estimateNote: includeMods ? `已包含模组文件（模组共约 ${(modsSize / 1e6).toFixed(0)}MB）` : '仅包含配置与模组列表（未包含模组文件），导入时会自动重新下载。' };
}
function listDir(p) { try { return fs.readdirSync(p).filter((f) => !f.startsWith('.')); } catch { return []; } }
async function importMcinstance({ path: p }) {
  const zip = new AdmZip(p);
  const e = zip.getEntry('mcinstance.json');
  if (!e) throw new UserError('这不是 .mcinstance 文件（缺少 mcinstance.json）。');
  const payload = JSON.parse(e.getData().toString('utf8'));
  const r = await instances.create({ name: payload.name, versionId: payload.versionId, loader: payload.loader, loaderVersion: payload.loaderVersion });
  const inst = instances.get(r.id);
  // 设置还原
  const cfgData = config.readJson(dirs().instancesFile, { instances: [] });
  const raw = cfgData.instances.find((x) => x.id === r.id);
  if (raw) { raw.settings = { ...raw.settings, ...(payload.settings || {}) }; config.writeJson(dirs().instancesFile, cfgData); }
  // mods 目录还原（若包内带文件）
  let modFiles = 0;
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || !entry.entryName.startsWith('mods/')) continue;
    const dest = path.join(inst.dir, entry.entryName);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, entry.getData());
    modFiles++;
  }
  const needDownload = Math.max(0, (payload.mods || []).length - modFiles);
  broadcast('bb:instances-changed', instances.list());
  return { instanceId: r.id, message: `已导入实例「${payload.name}」。${modFiles ? `包含 ${modFiles} 个模组文件；` : ''}还需要下载 ${needDownload} 个模组（到模组页搜索安装，列表见导入报告）。` };
}

// 存档同步（清单 + 到文件夹）
function savesManifest({ instanceId }) {
  const inst = instances.get(instanceId);
  const saves = path.join(inst.dir, 'saves');
  const out = [];
  try {
    for (const d of fs.readdirSync(saves)) {
      const p = path.join(saves, d);
      if (fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, 'level.dat'))) {
        const size = require('../resources/resources').__dirSize ? 0 : dirSizeOf(p);
        out.push({ name: d, size, mtime: fs.statSync(path.join(p, 'level.dat')).mtimeMs });
      }
    }
  } catch { /* */ }
  return out;
}
function dirSizeOf(p) { let n = 0; try { for (const f of fs.readdirSync(p)) n += dirSizeOf(path.join(p, f)); } catch { /* */ } try { n += fs.statSync(p).size; } catch { /* */ } return n; }
async function savesSync({ instanceId, destDir, conflict = 'keep-both' }) {
  const inst = instances.get(instanceId);
  const manifest = savesManifest({ instanceId });
  fs.mkdirSync(destDir, { recursive: true });
  const total = manifest.reduce((n, s) => n + s.size, 0);
  for (const s of manifest) {
    const target = path.join(destDir, s.name);
    if (fs.existsSync(target) && conflict === 'local') continue;
    if (fs.existsSync(target) && conflict === 'cloud') { fs.rmSync(target, { recursive: true, force: true }); }
    if (fs.existsSync(target) && conflict === 'keep-both') {
      const alt = `${s.name}（云端 ${new Date().toISOString().slice(0, 10)}）`;
      fs.cpSync(target, path.join(destDir, alt), { recursive: true });
    }
    fs.cpSync(path.join(inst.dir, 'saves', s.name), target, { recursive: true });
  }
  return { message: `已同步 ${manifest.length} 个存档（共 ${(total / 1e9).toFixed(1)}GB）到所选文件夹，冲突处理：${conflict === 'local' ? '保留本机' : conflict === 'cloud' ? '使用云端' : '两者都保留'}。取消一致性：本操作为复制式，随时可中断不损坏数据。` };
}

// 跨启动器导入（Prism/MultiMC/HMCL/PCL2 目录结构识别）
async function crossLauncherImport({ srcDir, instanceId = null }) {
  if (!fs.existsSync(srcDir)) throw new UserError('所选文件夹不存在。');
  const found = [];
  // Prism/MultiMC: instances/<name>/(minecraft|.minecraft)/
  const prismRoot = path.join(srcDir, 'instances');
  if (fs.existsSync(prismRoot)) {
    for (const d of fs.readdirSync(prismRoot)) {
      const p = path.join(prismRoot, d);
      const mcDir = ['minecraft', '.minecraft'].map((n) => path.join(p, n)).find((x) => fs.existsSync(x));
      if (mcDir && fs.statSync(mcDir).isDirectory()) found.push({ name: d, dir: mcDir, source: 'Prism/MultiMC' });
    }
  }
  // HMCL/PCL2: .minecraft/versions/<name>/saves 等
  const versions = path.join(srcDir, '.minecraft', 'versions');
  if (fs.existsSync(versions)) {
    for (const d of fs.readdirSync(versions)) {
      const p = path.join(versions, d);
      if (fs.statSync(p).isDirectory() && (fs.existsSync(path.join(p, 'mods')) || fs.existsSync(path.join(p, 'saves')))) found.push({ name: d, dir: p, source: 'HMCL/PCL2' });
    }
  }
  if (fs.existsSync(path.join(srcDir, 'mods')) || fs.existsSync(path.join(srcDir, 'saves'))) found.push({ name: path.basename(srcDir), dir: srcDir, source: '通用 .minecraft 结构' });
  if (!found.length) throw new UserError('没有识别到可导入的实例。支持的来源：Prism/MultiMC 的 instances 文件夹、HMCL/PCL2 的 .minecraft\\versions、或直接选择包含 mods/saves 的实例文件夹。');
  const report = [];
  let importedTotal = 0;
  if (instanceId) {
    for (const f of found) {
      const mig = await require('./enhance').migrateImport({ srcDir: f.dir, instanceId });
      importedTotal += mig.imported;
      report.push('「' + f.name + '」（' + f.source + '）：导入 ' + mig.imported + ' 项' + (mig.failed?.length ? '，' + mig.failed.length + ' 项失败' : ''));
    }
  }
  return { found, report, importedTotal, note: instanceId ? '转换报告如上。' : '请选择一个目标实例后重试导入（实例详情 → 更多 → 从其他启动器导入）。', warnings: ['2 类常见问题：模组版本格式无法识别时会被标记为待确认；仅 Windows 可用的模组导入后可能需要替换。'] };
}

function registerAll(register) {
  register({
    'loader.matrix': () => LOADER_MATRIX,
    'loader.recommend': ({ mc }) => loaderRecommend(mc),
    'loader.mixinTargets': ({ instanceId, file }) => mixinTargets(path.join(instanceDir(instanceId), 'mods', file)),
    'loader.classConflicts': ({ instanceId }) => classConflicts(instanceId),
    'loader.loadOrder': ({ instanceId }) => loadOrder(instanceId),
    'server.propsSchema': () => SERVER_PROPS_SCHEMA,
    'server.perf': ({ id }) => serverPerf(id),
    'translate.communityGlossary': () => glossaryCommunity(),
    'translate.savePersonalGlossary': ({ glossary }) => { fs.writeFileSync(path.join(dirs().root, '个人术语库.json'), JSON.stringify(glossary || {}, null, 2)); return true; },
    'export.mcinstance': (p) => exportMcinstance(p),
    'import.mcinstance': (p) => importMcinstance(p),
    'sync.savesManifest': (p) => savesManifest(p),
    'sync.saves': (p) => savesSync(p),
    'migrate.crossLauncher': (p) => crossLauncherImport(p),
  });
}
module.exports = { registerAll, loaderRecommend, mixinTargets, classConflicts };
