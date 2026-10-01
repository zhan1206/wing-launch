// 模块 P/Q/R/T 主进程：同步迁移导出 / 开发者模式与本地API / 启动器健康 / 截图日志快捷指令
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const config = require('./config');
const { dirs, instanceDir } = require('./paths');
const { UserError } = require('./ipc-gateway');
const { broadcast, toast } = require('./emitter');
const trash = require('./trash');
const { sanitize } = require('./sanitize');
const { assertSafe, safeExtract } = require('./zipsafe');

function dirSize(p) {
  try {
    const st = fs.statSync(p);
    if (st.isFile()) return st.size;
    let n = 0;
    for (const f of fs.readdirSync(p)) n += dirSize(path.join(p, f));
    return n;
  } catch { return 0; }
}

/* ---------- P：导出 / 同步 / 迁移 ---------- */
async function exportInstance({ instanceId, dest, includeSaves = true, includeMods = true, includeConfig = true }) {
  const inst = (require('../instances/instances')).get(instanceId);
  const free = (() => { try { const st = fs.statfsSync(path.dirname(dest)); return st.bsize * st.bavail; } catch { return Infinity; } })();
  const approx = Math.min(dirSize(inst.dir), 20 * 1024 * 1024 * 1024);
  if (free < approx * 1.1) throw new UserError(`磁盘空间不足：导出大约需要 ${(approx / 1e9).toFixed(1)}GB，目标位置只剩 ${(free / 1e9).toFixed(1)}GB。`);
  const zip = new AdmZip();
  const top = path.basename(inst.dir);
  if (includeMods) zip.addLocalFolder(path.join(inst.dir, 'mods'), top + '/mods');
  if (includeSaves) zip.addLocalFolder(path.join(inst.dir, 'saves'), top + '/saves');
  if (includeConfig) {
    for (const item of ['config', 'options.txt', 'servers.dat', '.blockbox']) {
      const p = path.join(inst.dir, item);
      if (!fs.existsSync(p)) continue;
      if (fs.statSync(p).isDirectory()) zip.addLocalFolder(p, top + '/' + item);
      else zip.addLocalFile(p, top);
    }
  }
  // 版本信息（导入方可据此重建实例）
  zip.addFile(top + '/.blockbox/instance.json', Buffer.from(JSON.stringify({ name: inst.name, versionId: inst.versionId, launchVersionId: inst.launchVersionId, loader: inst.loader, loaderVersion: inst.loaderVersion }, null, 2)));
  const out = dest.endsWith('.zip') ? dest : dest + '.zip';
  zip.writeZip(out);
  const size = fs.statSync(out).size;
  return { path: out, size, message: `已导出到「${path.basename(path.dirname(out))}」文件夹，文件名是「${path.basename(out)}」，大小 ${(size / 1e9).toFixed(1)}GB。` };
}

// 同步到文件夹（iCloud Drive / 任意文件夹）：默认关闭；导出与导入双向；不含令牌与 API Key
function syncPayload() {
  const accData = config.readJson(dirs().accountsFile, { accounts: [], currentId: null });
  return {
    format: 'blockbox-sync', version: 1, time: Date.now(),
    settings: { ...config.get(), translate: { ...(config.get().translate || {}), apiKey: '' } },
    accounts: (accData.accounts || []).map((a) => ({ id: a.id, type: a.type, name: a.name, displayName: a.displayName, note: a.note })),
    instancesIndex: config.readJson(dirs().instancesFile, { instances: [] }).instances.map((i) => ({ id: i.id, name: i.name, versionId: i.versionId, loader: i.loader, settings: i.settings })),
    skins: fs.existsSync(dirs().skins) ? fs.readdirSync(dirs().skins).filter((f) => f.endsWith('.png')) : [],
  };
}
async function syncExport({ destDir }) {
  if (!destDir) throw new UserError('请先选择同步文件夹（可以是 iCloud Drive 里的任意文件夹）。');
  fs.mkdirSync(destDir, { recursive: true });
  const payload = syncPayload();
  fs.writeFileSync(path.join(destDir, 'blockbox-sync.json'), JSON.stringify(payload, null, 2));
  // 皮肤二进制
  const skinDir = path.join(destDir, 'skins');
  fs.mkdirSync(skinDir, { recursive: true });
  for (const f of payload.skins) fs.copyFileSync(path.join(dirs().skins, f), path.join(skinDir, f));
  return { what: `已同步：设置、${payload.accounts.length} 个账户的显示信息（不含密码与令牌）、${payload.instancesIndex.length} 个实例的配置索引、${payload.skins.length} 张皮肤。存档与模组文件较大，默认不同步（可在导出实例时单独打包）。存放位置：你选择的文件夹。删除方式：删除该文件夹中的 blockbox-sync.json 即可。` };
}
async function syncImport({ srcDir, conflict = 'keep-both' }) {
  const file = path.join(srcDir, 'blockbox-sync.json');
  if (!fs.existsSync(file)) throw new UserError('所选文件夹里没有找到同步文件（blockbox-sync.json）。');
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (payload.format !== 'blockbox-sync') throw new UserError('这个同步文件不是本启动器生成的。');
  const results = [];
  // 设置：按冲突策略
  if (conflict === 'cloud' || conflict === 'keep-both') {
    config.set(payload.settings || {});
  } // 'local' → 不动本机设置
  // 账户：合并（不覆盖已存在的）
  const accData = config.readJson(dirs().accountsFile, { accounts: [], currentId: null });
  let merged = 0;
  for (const a of payload.accounts || []) {
    if (!accData.accounts.find((x) => x.uuidHex === a.uuidHex || x.name === a.name)) { accData.accounts.push({ ...a, note: (a.note || '') + '（来自同步：需要重新登录）' }); merged++; }
  }
  config.writeJson(dirs().accountsFile, accData);
  results.push(`账户信息合并了 ${merged} 个（都需要重新登录，令牌不会同步）`);
  // 皮肤
  const skinDir = path.join(srcDir, 'skins');
  if (fs.existsSync(skinDir)) {
    fs.mkdirSync(dirs().skins, { recursive: true });
    for (const f of fs.readdirSync(skinDir)) {
      let target = path.join(dirs().skins, f);
      if (conflict === 'keep-both' && fs.existsSync(target)) target = path.join(dirs().skins, Date.now() + '-' + f);
      else if (conflict === 'local' && fs.existsSync(target)) continue;
      fs.copyFileSync(path.join(skinDir, f), target);
    }
    results.push('皮肤已按所选冲突策略合并');
  }
  broadcast('bb:settings-changed', config.get());
  broadcast('bb:accounts-changed', {});
  return { message: '同步导入完成：' + results.join('；') + '。' };
}

// 从 Windows 启动器迁移（选择 .minecraft 或其实例文件夹）
async function migrateImport({ srcDir, instanceId = null }) {
  if (!srcDir || !fs.existsSync(srcDir)) throw new UserError('所选文件夹不存在。');
  const finds = { saves: [], mods: [], resourcepacks: [], shaderpacks: [] };
  const scan = (base) => {
    for (const [key, name] of [['saves', 'saves'], ['mods', 'mods'], ['resourcepacks', 'resourcepacks'], ['shaderpacks', 'shaderpacks']]) {
      const p = path.join(base, name);
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
        for (const f of fs.readdirSync(p)) {
          const fp = path.join(p, f);
          const st = fs.statSync(fp);
          if (st.isFile() && /\.(jar|zip|disabled)$/i.test(f)) finds[key].push({ path: fp, kind: key, name: f, size: st.size });
          else if (st.isDirectory() && key === 'saves' && fs.existsSync(path.join(fp, 'level.dat'))) finds[key].push({ path: fp, kind: key, name: f, size: dirSize(fp) });
        }
      }
    }
  };
  scan(srcDir);
  for (const sub of fs.existsSync(srcDir) ? fs.readdirSync(srcDir) : []) {
    const p = path.join(srcDir, sub);
    if (fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, 'saves'))) scan(p);
  }
  const total = finds.saves.length + finds.mods.length + finds.resourcepacks.length + finds.shaderpacks.length;
  if (!total) throw new UserError('在这个文件夹里没有找到可导入的内容（需要包含 saves/mods/resourcepacks/shaderpacks 其中之一）。请确认选择的是 .minecraft 或启动器实例文件夹。');
  // Windows 专属模组提示（依据：Forge/Fabric 模组中常见的仅 Windows 依赖如 starscore？诚实说明无法完全判断）
  const warnings = [];
  const inst = instanceId ? (require('../instances/instances')).get(instanceId) : null;
  const target = inst ? { id: inst.id, name: inst.name } : null;
  let imported = 0, failed = [];
  if (inst) {
    const drop = require('../instances/drop');
    for (const key of ['mods', 'resourcepacks', 'shaderpacks']) {
      if (!finds[key].length) continue;
      const r = key === 'mods'
        ? await Promise.resolve(require('../instances/mods').addFiles(inst.id, finds[key].map((x) => x.path)))
        : await Promise.resolve(require('../instances/contents').packsAdd(inst.id, key === 'mods' ? 'mods' : key, finds[key].map((x) => x.path)));
      imported += (r.installed || []).length;
      failed = failed.concat(r.failed || []);
    }
    if (finds.saves.length) {
      const r = await Promise.resolve(require('../instances/contents').worldsImport(inst.id, finds.saves.map((x) => x.path)));
      imported += r.imported.length;
      failed = failed.concat(r.failed || []);
    }
  }
  warnings.push('跨平台提示：极少数模组包含仅 Windows 可用的依赖（如某些原生库），导入后如果游戏无法启动，请在模组页禁用最近导入的模组试试。');
  return { found: { saves: finds.saves.length, mods: finds.mods.length, resourcepacks: finds.resourcepacks.length, shaderpacks: finds.shaderpacks.length }, target, imported, failed: failed.slice(0, 5), warnings };
}

/* ---------- Q：开发者模式 / 模组开发辅助 / 本地 API ---------- */
function fileTree(base, depth = 0, maxDepth = 3) {
  const out = [];
  if (depth > maxDepth) return out;
  try {
    for (const f of fs.readdirSync(base)) {
      if (f.startsWith('.')) continue;
      const p = path.join(base, f);
      const st = fs.statSync(p);
      out.push({ name: f, dir: st.isDirectory(), size: st.isFile() ? st.size : 0, children: st.isDirectory() ? fileTree(p, depth + 1, maxDepth) : undefined });
    }
  } catch { /* */ }
  return out;
}

let apiServer = null, apiToken = null;
async function startLocalApi(port) {
  if (apiServer) return { port: apiServer.address().port };
  apiToken = crypto.randomBytes(16).toString('hex');
  apiServer = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json; charset=utf-8');
    if (req.headers['x-blockbox-token'] !== apiToken) { res.statusCode = 401; res.end(JSON.stringify({ error: '令牌不对' })); return; }
    const url = (req.url || '').split('?')[0];
    if (url === '/status') {
      res.end(JSON.stringify({ ok: true, version: require('electron').app.getVersion(), instances: (require('../instances/instances')).list().map((i) => ({ id: i.id, name: i.name })), currentAccount: (require('../accounts/accounts')).current()?.name || null }));
    } else if (url === '/launch' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          const { instanceId, accountId } = JSON.parse(body || '{}');
          require('../instances/launch-routes');
          (require('../instances/instances')).get(instanceId);
          require('../instances/launch').launch((require('../instances/instances')).get(instanceId), { accountId }).then(() => { res.end(JSON.stringify({ ok: true })); }).catch((e) => { res.statusCode = 500; res.end(JSON.stringify({ error: e.userMessage || e.message })); });
        } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: e.message })); }
      });
    } else { res.statusCode = 404; res.end(JSON.stringify({ error: '未知接口' })); }
  });
  await new Promise((resolve, reject) => {
    const onError = (e) => {
      try { apiServer.close(); } catch { /* */ }
      apiServer = null; apiToken = null;
      reject(new UserError(e.code === 'EADDRINUSE' ? `端口 ${port} 已被占用，请换一个端口再试。` : '本地 API 启动失败：' + e.message));
    };
    apiServer.once('error', onError);
    apiServer.listen(port || 0, '127.0.0.1', () => {
      apiServer.removeListener('error', onError);
      apiServer.on('error', () => { /* 运行期错误不应让主进程崩溃 */ });
      resolve();
    });
  });
  return { port: apiServer.address().port, token: apiToken };
}
function stopLocalApi() { try { apiServer?.close(); } catch { /* */ } apiServer = null; apiToken = null; return true; }
function apiDocs() {
  return {
    base: 'http://127.0.0.1:' + (apiServer?.address()?.port || '<端口>'),
    auth: '每个请求需带请求头 x-blockbox-token: <令牌>（令牌只在开启 API 时显示一次，可重新生成）',
    endpoints: [
      { method: 'GET', path: '/status', desc: '查看启动器状态、实例列表、当前账户', example: `curl -H "x-blockbox-token: 令牌" http://127.0.0.1:端口/status` },
      { method: 'POST', path: '/launch', desc: '启动实例。请求体：{"instanceId":"实例ID","accountId":"可选账户ID"}', example: `curl -X POST -H "x-blockbox-token: 令牌" -d '{"instanceId":"xxx"}' http://127.0.0.1:端口/launch` },
    ],
    security: 'API 仅监听本机（127.0.0.1），外部设备无法访问；但本机任何程序拿到令牌都能控制启动器，请勿把令牌交给不信任的脚本。',
  };
}

/* ---------- T：截图 / 实时日志 / 快捷指令 ---------- */
function screenshots({ instanceId = null }) {
  const out = [];
  const scan = (id, name) => {
    const dir = path.join(instanceDir(id), 'screenshots');
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      if (!/\.(png|jpg|jpeg)$/i.test(f)) continue;
      const st = fs.statSync(path.join(dir, f));
      out.push({ instanceId: id, instanceName: name, file: f, path: path.join(dir, f), size: st.size, time: st.mtimeMs, url: 'bbimg://' + encodeURIComponent(path.join(dir, f)) });
    }
  };
  if (instanceId) { const i = (require('../instances/instances')).get(instanceId); scan(i.id, i.name); }
  else for (const i of (require('../instances/instances')).list()) scan(i.id, i.name);
  return out.sort((a, b) => b.time - a.time);
}
function exportScreenshots({ paths, destDir }) {
  fs.mkdirSync(destDir, { recursive: true });
  let n = 0;
  for (const p of paths) if (fs.existsSync(p)) { fs.copyFileSync(p, path.join(destDir, path.basename(p))); n++; }
  return { count: n };
}

function registerAll(register) {
  register({
    // P
    'export.instance': (p) => exportInstance(p),
    'sync.export': (p) => syncExport(p),
    'sync.import': (p) => syncImport(p),
    'sync.migrateImport': (p) => migrateImport(p),
    // Q
    'dev.fileTree': ({ instanceId }) => {
      if (!config.get().devMode) throw new UserError('请先在设置中开启开发者模式。');
      return fileTree(instanceDir(instanceId));
    },
    'dev.fullDiagnose': ({ instanceId }) => {
      if (!config.get().devMode) throw new UserError('请先在设置中开启开发者模式。');
      const inst = (require('../instances/instances')).get(instanceId);
      let logs = '';
      try { logs = fs.readFileSync(path.join(inst.dir, 'logs', 'latest.log'), 'utf8').slice(-100000); } catch { /* */ }
      return { instance: inst, logs: sanitize(logs), settings: inst.settings, mods: (require('../instances/mods')).list(instanceId) };
    },
    'dev.createDevInstance': ({ name }) => {
      if (!config.get().devMode) throw new UserError('请先在设置中开启开发者模式。');
      const r = require('../instances/instances').create({ name: (name || '开发实例') + '（开发）', versionId: '1.21.1', loader: 'fabric' });
      const dir = instanceDir(r.id);
      fs.mkdirSync(path.join(dir, 'mods'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'mods', 'example.mod.json'), JSON.stringify({ schemaVersion: 1, id: 'example_mod', version: '0.1.0', name: '示例模组', entrypoint: {} }, null, 2));
      fs.writeFileSync(path.join(dir, '.blockbox', '开发说明.txt'), '这是开发实例：mods 文件夹放你正在开发的 jar；启动游戏后如果修改了模组文件，启动器会提示你重启游戏。');
      return r;
    },
    'dev.metaTemplate': ({ type, data }) => {
      if (type === 'fabric') {
        return JSON.stringify({ schemaVersion: 1, id: data.id || 'my_mod', version: data.version || '0.1.0', name: data.name || '我的模组', description: data.description || '', authors: [data.author || ''], license: data.license || 'MIT', environment: data.environment || '*', entrypoints: { main: [data.entry || ''] }, depends: { fabricloader: '>=0.16.0', minecraft: '~' + (data.mc || '1.21.1') } }, null, 2);
      }
      return `modLoader="javafml"\nloaderVersion="[47,)"\nlicense="${data.license || 'MIT'}"\n[[mods]]\nmodId="${data.id || 'my_mod'}"\nversion="${data.version || '0.1.0'}"\ndisplayName="${data.name || '我的模组'}"\nauthors="${data.author || ''}"\ndescription='''${data.description || ''}'''\n[[dependencies.${data.id || 'my_mod'}]]\n    modId="minecraft"\n    mandatory=true\n    versionRange="[1.20.1,1.21)"\n`;
    },
    'localApi.start': async ({ port }) => {
      if (!config.get().localApiEnabled) throw new UserError('请先在设置中开启本地 API。');
      const r = await startLocalApi(port);
      return { ...r, docs: apiDocs() };
    },
    'localApi.stop': () => stopLocalApi(),
    'localApi.docs': () => apiDocs(),
    // R
    'app.health': async () => {
      const hw = { totalGB: Math.round(os.totalmem() / 1e9) };
      const javaDir = dirs().java;
      const javas = [];
      let javaSize = 0;
      try {
        for (const d of fs.readdirSync(javaDir)) {
          if (!d.startsWith('java-')) continue;
          const size = dirSize(path.join(javaDir, d));
          javaSize += size;
          const major = /^java-(\d+)-/.exec(d)?.[1];
          javas.push({ major: Number(major) || d, size });
        }
      } catch { /* */ }
      let lastCrash = null;
      try {
        const log = fs.readFileSync(path.join(dirs().logs, 'app.log'), 'utf8');
        const m = /启动器自身崩溃|uncaughtException|render-process-gone/.exec(log);
        if (m) lastCrash = '检测到过（详见日志）';
      } catch { /* */ }
      return {
        version: require('electron').app.getVersion(),
        channel: config.get().update?.channel || '稳定版',
        dataDir: dirs().root,
        sizes: { instances: dirSize(dirs().instances), assets: dirSize(dirs().assets), libraries: dirSize(dirs().libraries), versions: dirSize(dirs().versions), java: javaSize, cache: dirSize(dirs().partial) + dirSize(dirs().objects), trash: dirSize(dirs().trash) },
        javas,
        lastCrash,
        totalGB: hw.totalGB,
      };
    },
    // T
    'gametools.screenshots': (p) => screenshots(p),
    'gametools.exportScreenshots': (p) => exportScreenshots(p),
    'gametools.setCover': ({ instanceId, path: p }) => {
      (require('../instances/instances')).get(instanceId);
      const d = config.readJson(dirs().instancesFile, { instances: [] });
      const inst = d.instances.find((x) => x.id === instanceId);
      if (inst) { inst.cover = p; config.writeJson(dirs().instancesFile, d); }
      broadcast('bb:instances-changed', (require('../instances/instances')).list());
      return true;
    },
    'gametools.quickCommands': ({ instanceId }) => {
      const p = path.join(instanceDir(instanceId), '.blockbox', '快捷指令.json');
      try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return []; }
    },
    'gametools.saveQuickCommands': ({ instanceId, commands }) => {
      const p = path.join(instanceDir(instanceId), '.blockbox', '快捷指令.json');
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, JSON.stringify(commands || [], null, 2));
      return true;
    },
  });
}

function watchInstanceLogs() { /* 实时日志由渲染层轮询 session 接口实现，无需文件监听 */ }

module.exports = { registerAll, watchInstanceLogs, apiDocs, migrateImport };
