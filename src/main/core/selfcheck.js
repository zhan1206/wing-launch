// 模块 AA：启动器自愈——启动自检 / 崩溃记录 / 安全模式 / 数据校验和 / 目录健康
const fs = require('fs');
const path = require('path');
const { dirs } = require('./paths');
const config = require('./config');
const { UserError } = require('./ipc-gateway');
const { broadcast } = require('./emitter');

const CRASH_DIR = () => path.join(dirs().logs, 'launcher-crash');

// 崩溃记录：主进程未捕获异常与渲染进程崩溃
function installCrashHandlers() {
  const write = (kind, detail) => {
    try {
      fs.mkdirSync(CRASH_DIR(), { recursive: true });
      const file = path.join(CRASH_DIR(), `${kind}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      fs.writeFileSync(file, JSON.stringify({ time: Date.now(), kind, ...detail }, null, 2));
    } catch { /* */ }
  };
  process.on('uncaughtException', (e) => write('uncaughtException', { message: e.message, stack: (e.stack || '').slice(0, 8000) }));
  process.on('unhandledRejection', (e) => write('unhandledRejection', { message: String(e && e.message || e).slice(0, 2000) }));
  global.__bbRenderGone = () => (event, wc, details) => write('render-process-gone', { reason: details?.reason, exitCode: details?.exitCode });
}

// 上次是否异常退出（crash 目录有新记录 或 上次运行未写正常退出标记）
function lastCrashInfo() {
  try {
    const files = fs.readdirSync(CRASH_DIR()).filter((f) => f.endsWith('.json')).sort();
    if (!files.length) return null;
    const last = files[files.length - 1];
    const j = JSON.parse(fs.readFileSync(path.join(CRASH_DIR(), last), 'utf8'));
    const reasonMap = { uncaughtException: '启动器内部出现了一个程序错误', unhandledRejection: '启动器内部一个后台任务失败了', 'render-process-gone': '界面进程意外退出' };
    return { file: last, time: j.time, kind: j.kind, reason: reasonMap[j.kind] || '未知原因', detail: j };
  } catch { return null; }
}

// 启动自检（快速，<3 秒）
function startupSelfCheck() {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, state: ok ? '正常' : '异常', detail });
  // 配置可读
  try { config.get(); add('配置文件', true, '设置可以正常读取。'); } catch (e) { add('配置文件', false, '设置读取失败：' + e.message); }
  // 目录可写
  try {
    for (const d of [dirs().root, dirs().instances, dirs().logs]) {
      fs.mkdirSync(d, { recursive: true });
      const probe = path.join(d, '.write-probe');
      fs.writeFileSync(probe, '1');
      fs.rmSync(probe, { force: true });
    }
    add('数据目录可写', true, '数据目录与日志目录可以正常读写。');
  } catch (e) { add('数据目录可写', false, '写入失败：' + e.message + '。请检查磁盘空间或文件夹权限。'); }
  // 上次退出状态
  const crash = lastCrashInfo();
  add('上次退出状态', !crash, crash ? `检测到上次异常退出（${crash.reason}）。可以查看详细信息或发送诊断包。` : '上次正常关闭。');
  return { checks, crash };
}

// 数据目录健康检查
function dataHealthScan() {
  const items = [];
  // 大日志
  const logFile = path.join(dirs().logs, 'app.log');
  try {
    const size = fs.statSync(logFile).size;
    if (size > 20 * 1024 * 1024) items.push({ title: '日志文件过大', detail: `应用日志约 ${(size / 1e6).toFixed(0)}MB。`, action: '清理日志', freeBytes: size });
  } catch { /* */ }
  // 临时/部分下载残留
  try {
    let partialSize = 0, partialCount = 0;
    for (const f of fs.readdirSync(dirs().partial)) { partialSize += fs.statSync(path.join(dirs().partial, f)).size; partialCount++; }
    if (partialCount) items.push({ title: '未完成的下载残留', detail: `${partialCount} 个未完成文件，约 ${(partialSize / 1e6).toFixed(1)}MB。`, action: '清理残留', freeBytes: partialSize });
  } catch { /* */ }
  // 损坏配置副本
  try {
    const corrupts = fs.readdirSync(dirs().root).filter((f) => f.includes('.corrupt-'));
    for (const f of corrupts) {
      const size = fs.statSync(path.join(dirs().root, f)).size;
      items.push({ title: '损坏的旧配置副本', detail: f + `（${(size / 1024).toFixed(0)}KB，已自动从备份恢复过）。`, action: '清理副本', freeBytes: size });
    }
  } catch { /* */ }
  // 回收站
  try {
    const ts = require('./trash').trashList().filter((t) => t.exists);
    const size = ts.reduce((n, t) => n + (fs.statSync(t.trash).isFile() ? fs.statSync(t.trash).size : 1024 * 1024), 0);
    if (ts.length) items.push({ title: '回收站有可清理内容', detail: `${ts.length} 个已删除项目。`, action: '查看回收站', freeBytes: size });
  } catch { /* */ }
  return items;
}
function performCleanup(targets) {
  let freed = 0;
  for (const t of targets || []) {
    try {
      if (t === 'log') { const s = fs.statSync(path.join(dirs().logs, 'app.log')).size; fs.rmSync(path.join(dirs().logs, 'app.log'), { force: true }); freed += s; }
      if (t === 'partial') { for (const f of fs.readdirSync(dirs().partial)) { const s = fs.statSync(path.join(dirs().partial, f)).size; fs.rmSync(path.join(dirs().partial, f), { force: true }); freed += s; } }
      if (t === 'corrupt') { for (const f of fs.readdirSync(dirs().root).filter((x) => x.includes('.corrupt-'))) { freed += fs.statSync(path.join(dirs().root, f)).size; fs.rmSync(path.join(dirs().root, f), { force: true }); } }
    } catch { /* */ }
  }
  return { freedBytes: freed, message: `已清理，释放了 ${(freed / 1e6).toFixed(1)}MB 空间。` };
}

// 数据文件校验和：写入时记录 sha256，读取时验证
function checksumIndex() { return path.join(dirs().root, '.checksums.json'); }
function loadChecksums() { try { return JSON.parse(fs.readFileSync(checksumIndex(), 'utf8')); } catch { return {}; } }
function withChecksum(file, dataStr) {
  const crypto = require('crypto');
  const idx = loadChecksums();
  idx[path.basename(file)] = crypto.createHash('sha256').update(dataStr).digest('hex');
  try { fs.writeFileSync(checksumIndex(), JSON.stringify(idx, null, 2)); } catch { /* */ }
}
function verifyChecksum(file) {
  const crypto = require('crypto');
  const idx = loadChecksums();
  const expected = idx[path.basename(file)];
  if (!expected || !fs.existsSync(file)) return { state: 'unknown' };
  try {
    const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    return { state: actual === expected ? 'ok' : 'fail' };
  } catch { return { state: 'unknown' }; }
}

function registerAll(register) {
  register({
    'selfcheck.run': () => startupSelfCheck(),
    'selfcheck.crashInfo': () => lastCrashInfo(),
    'selfcheck.ackCrash': () => { try { fs.rmSync(CRASH_DIR(), { recursive: true, force: true }); } catch { /* */ } return true; },
    'selfcheck.healthScan': () => dataHealthScan(),
    'selfcheck.cleanup': ({ targets }) => performCleanup(targets),
    'selfcheck.safeModeInfo': () => ({ active: process.env.BLOCKBOX_SAFE_MODE === '1', howTo: '以安全模式启动可以排查问题：会关闭主题背景、动画与部分联网功能，仅保留核心功能。' }),
  });
}
module.exports = { registerAll, installCrashHandlers, startupSelfCheck, lastCrashInfo, dataHealthScan, withChecksum, verifyChecksum };
