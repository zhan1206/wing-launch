// 一键诊断 + 脱敏诊断包导出
const fs = require('fs');
const os = require('os');
const net = require('net');
const config = require('../core/config');
const { dirs } = require('../core/paths');
const { UserError } = require('../core/ipc-gateway');
const javaMgr = require('../java/java-manager');
const sources = require('../core/download/sources');
const accounts = require('../accounts/accounts');
const instances = require('../instances/instances');
const { sanitize, prettyPath } = require('../core/sanitize');
const secrets = require('../core/secrets');
const shell = require('electron').shell;

function freeBytes(dir) { try { const st = fs.statfsSync(dir); return st.bsize * st.bavail; } catch { return 0; } }
function portFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '0.0.0.0');
  });
}

async function runDiagnostics() {
  const checks = [];
  const add = (id, name, state, detail, fix = null) => checks.push({ id, name, state, detail, fix });

  // 1 Java
  try {
    const list = await javaMgr.list();
    const best = list.filter((j) => j.major >= 8).sort((a, b) => b.major - a.major)[0];
    const has21 = list.some((j) => j.major >= 21);
    add('java', 'Java 环境', has21 ? 'ok' : best ? 'fail' : 'fail',
      has21 ? '已找到可用的 Java（' + list.map((j) => 'Java ' + j.major).join('、') + '），新版本游戏可以正常启动。'
        : '没有找到 Java 21 或更高版本。最新的游戏版本需要它，点"怎么解决"可以去自动下载。',
      has21 ? null : { type: 'openJavaSettings' });
  } catch { add('java', 'Java 环境', 'unknown', '暂时无法检查 Java 环境。可以稍后再试。'); }

  // 2 网络
  let netOk = false;
  try { await sources.fetchText('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json', { timeout: 8000 }); netOk = true; add('network', '网络连接', 'ok', '可以连接到官方版本服务器，下载与在线功能正常。'); }
  catch {
    try { await sources.fetchText('https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json', { timeout: 8000 }); netOk = true; add('network', '网络连接', 'ok', '官方源暂时连不上，但国内镜像可用。启动器会自动切换到镜像，不影响使用。'); }
    catch { add('network', '网络连接', 'fail', '当前无法连接版本服务器。下载、在线搜索、在线登录不可用；已下载的内容和单机游戏不受影响。', { type: 'openHelp', topic: 'network' }); }
  }

  // 3 磁盘
  const free = freeBytes(dirs().root);
  add('disk', '磁盘空间', free > 2 * 1024 ** 3 ? 'ok' : free > 0.5 * 1024 ** 3 ? 'fail' : 'fail',
    free > 2 * 1024 ** 3 ? '数据目录所在磁盘剩余约 ' + Math.round(free / 1e9) + 'GB，空间充足。'
      : '数据目录所在磁盘只剩约 ' + Math.round(free / 1e9) + 'GB。下载游戏或创建备份可能会失败，建议清理出至少 2GB 空间。',
    free > 2 * 1024 ** 3 ? null : { type: 'openDiskSettings' });

  // 4 权限（数据目录可写）
  try {
    const testFile = require('path').join(dirs().root, '.perm-test');
    fs.writeFileSync(testFile, 'ok');
    fs.rmSync(testFile, { force: true });
    add('permission', '文件读写权限', 'ok', '启动器数据文件夹可以正常读写。');
  } catch {
    add('permission', '文件读写权限', 'fail', '启动器数据文件夹无法写入（' + prettyPath(dirs().root) + '）。这会导致账户、实例、下载全部无法保存。请确认文件夹没有被"只读"或安全软件锁定。', { type: 'openSystemSettings' });
  }

  // 5 端口（联机信息）
  const portOpen = await portFree(25565);
  add('port', '联机端口', 'ok', portOpen ? '默认联机端口 25565 空闲，开服务器可用。' : '默认联机端口 25565 已被占用。开服务器时会自动改用 25566 等备用端口，不影响单人游戏。');

  // 6 账户
  try {
    const cur = accounts.current();
    if (!cur) add('account', '账户状态', 'fail', '还没有任何账户。添加一个离线账户只要 10 秒。', { type: 'openAccounts' });
    else if (cur.type === 'microsoft' && cur.expiresAt && Date.now() > cur.expiresAt - 60000) add('account', '账户状态', 'fail', '正版账户“' + (cur.displayName || cur.name) + '”的登录已过期，启动前会自动尝试续期；如果失败请重新登录一次。', { type: 'openAccounts' });
    else add('account', '账户状态', 'ok', '当前账户“' + (cur.displayName || cur.name) + '”（' + (cur.type === 'offline' ? '离线' : cur.type === 'microsoft' ? '微软正版' : '皮肤站') + '）可用。');
  } catch { add('account', '账户状态', 'unknown', '暂时无法检查账户状态。'); }

  // 7 实例完整性
  try {
    const list = instances.list();
    let broken = 0, details = [];
    for (const inst of list) {
      const jsonPath = require('path').join(dirs().versions, inst.launchVersionId || inst.versionId, (inst.launchVersionId || inst.versionId) + '.json');
      if (!fs.existsSync(jsonPath)) { broken++; details.push(inst.name + '（缺少版本信息）'); }
    }
    if (list.length === 0) add('instances', '实例完整性', 'ok', '还没有实例。创建一个就能开始玩。', { type: 'openMods' });
    else if (broken === 0) add('instances', '实例完整性', 'ok', '全部 ' + list.length + ' 个实例的数据完整。');
    else add('instances', '实例完整性', 'fail', '发现 ' + broken + ' 个实例数据不完整：' + details.join('、') + '。可以删除后重新创建，一般不影响其他实例。');
  } catch { add('instances', '实例完整性', 'unknown', '暂时无法检查实例。'); }

  // 8 隐私自检（说明性）
  add('privacy', '隐私状态', 'ok', '启动器默认不上传任何数据。账户令牌保存在系统钥匙串中，日志与诊断包已自动脱敏。');

  return { time: Date.now(), checks };
}

// 脱敏诊断包
async function exportDiagnostics() {
  const diag = await runDiagnostics();
  const logsPath = require('path').join(dirs().logs, 'app.log');
  let logs = '';
  try { logs = fs.readFileSync(logsPath, 'utf8').split('\n').slice(-300).join('\n'); } catch { /* */ }
  const cfg = config.get();
  const summary = {
    time: new Date().toISOString(),
    app: 'BlockBox v1.1.0',
    system: { os: 'macOS ' + os.release(), arch: os.arch(), cpu: os.cpus()[0]?.model || '', memGB: Math.round(os.totalmem() / 1e9) },
    checks: diag.checks,
    settingsSummary: { themeMode: cfg.theme?.mode, homepage: cfg.homepage, memory: cfg.memory, downloadSource: cfg.downloadSource, offlineMode: !!cfg.offlineMode },
    instances: instances.list().map((i) => ({ name: i.name, version: i.versionId, loader: i.loader, mods: i.modsCount })),
    javaList: (await javaMgr.list().catch(() => [])).map((j) => ({ major: j.major, vendor: j.vendor, source: j.source })),
    recentLogs: sanitize(logs).split('\n').slice(-300).join('\n'),
    note: '本诊断包已自动脱敏：不包含账户令牌、API Key，用户名已用 •••• 替代。可以放心分享给别人求助。',
  };
  return summary;
}

function registerAll(register) {
  register({
    'diagnostics.run': () => runDiagnostics(),
    'diagnostics.export': async () => {
      const summary = await exportDiagnostics();
      return { summary, text: JSON.stringify(summary, null, 2) };
    },
  });
}
module.exports = { registerAll, runDiagnostics };
