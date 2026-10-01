// 启动相关路由：启动前检查 / launch / 自动备份 / 状态查询
const fs = require('fs');
const instances = require('./instances');
const mods = require('./mods');
const contents = require('./contents');
const launcher = require('./launch');
const javaMgr = require('../java/java-manager');
const config = require('../core/config');
const { UserError } = require('../core/ipc-gateway');
const { readJson, writeJson } = require('../core/config');
const { dirs } = require('../core/paths');
const { broadcast } = require('../core/emitter');
const path = require('path');

const LAST_FULL = () => path.join(dirs().root, '.last-full-backup.json');
function lastFullMap() { return readJson(LAST_FULL(), {}); }
function freeBytes(dir) { try { const st = fs.statfsSync(dir); return st.bsize * st.bavail; } catch { return Infinity; } }

// 分类失败：带 category 与"怎么解决"fixes
function fail(category, message, fixes) {
  const e = new UserError(message);
  e.category = category;
  e.fixes = fixes || [];
  return e;
}

// 启动前检查（模块D）：账户 / Java / 磁盘 / 内存 / 模组前置
async function preLaunchChecks(inst, accountId) {
  // 1 账户有效性
  try {
    await accountsValidate(accountId ?? inst.boundAccountId);
  } catch (e) {
    throw fail('账户', e.userMessage || e.message, [{ text: '打开账户管理', action: { type: 'openAccounts' } }, { text: '查看帮助', action: { type: 'openHelp', topic: 'account' } }]);
  }
  // 2 磁盘空间
  const free = freeBytes(inst.dir);
  if (free < 500 * 1024 * 1024) {
    throw fail('磁盘', '磁盘空间不足：启动游戏至少需要 0.5GB 剩余空间，当前只剩约 ' + Math.round(free / 1e6) + 'MB。清理空间后再试。',
      [{ text: '打开资源管理器清理', action: { type: 'openDiskSettings' } }]);
  }
  // 3 内存合理性（过低给出提示但不阻塞）
  const mem = inst.settings?.memory;
  const memMB = mem === 'auto' || !mem ? config.memoryMB() : Number(mem);
  if (memMB < 1024) {
    broadcast('bb:launch-warning', { instanceId: inst.id, text: '当前给游戏分配的内存只有 ' + memMB + 'MB，比较小，可能会卡顿或崩溃。建议在实例设置里调高到 4GB。' });
  }
  // 4 模组前置缺失（提示，不阻塞）
  try {
    const missing = mods.scanMissing(inst.id);
    if (missing.length) {
      broadcast('bb:launch-warning', { instanceId: inst.id, text: '有 ' + missing.length + ' 个模组缺少前置（如 ' + missing[0].name + '），游戏可能启动失败。可以到模组页点"检查缺失前置"补装。' });
    }
  } catch { /* 非阻塞 */ }
  // 5 Java 可用性（ensure 内部会自动下载；下载失败归类为网络/磁盘）
  try {
    const meta = await require('../meta/versions').getMergedMeta(inst.launchVersionId || inst.versionId);
    const major = meta.javaVersion?.majorVersion || javaMgr.mapMajor(inst.versionId).major;
    const list = await javaMgr.list();
    if (!list.some((j) => j.major === major)) {
      broadcast('bb:launch-warning', { instanceId: inst.id, text: '这台电脑还没有 Java ' + major + '，启动器正在自动下载（约 200MB），请稍候。' });
    }
  } catch { /* 非阻塞：启动流程中会再尝试 */ }
}
async function accountsValidate(accountId) {
  const accounts = require('../accounts/accounts');
  // validateForLaunch 会做微软/皮肤站续期（内部有超时与中文错误）
  return accounts.validateForLaunch(accountId);
}

function registerAll(register) {
  register({
    'instances.launch': async ({ id, accountId }) => {
      const inst = instances.get(id);
      await preLaunchChecks(inst, accountId);
      // 启动前自动备份（轻量 + 每 7 天完整）——失败通知但不阻塞启动
      try {
        const map = lastFullMap();
        contents.autoBackupBeforeLaunch(id, map[id]);
        map[id] = Date.now();
        writeJson(LAST_FULL(), map);
      } catch (e) {
        broadcast('bb:launch-warning', { instanceId: id, text: '启动前自动备份失败了（' + (e.message || e) + '）。游戏仍会继续启动，但建议检查磁盘空间。' });
      }
      let r;
      try {
        r = await launcher.launch(inst, { accountId });
      } catch (e) {
        e.category = e.category || classifyLaunchError(e);
        broadcast('bb:launch-failed', { instanceId: id, category: e.category, message: e.userMessage || e.message, fixes: e.fixes || defaultFixes(e.category) });
        throw e;
      }
      // 记录游玩时间
      const d = readJson(dirs().instancesFile, { instances: [] });
      const instRaw = d.instances.find((x) => x.id === id);
      if (instRaw) { instRaw.lastPlayed = Date.now(); writeJson(dirs().instancesFile, d); }
      return r;
    },
    'instances.session': ({ session }) => {
      const s = launcher.getSession(session);
      if (!s) throw new UserError('找不到这个启动会话。');
      return { session: s.session, lines: s.lines.slice(-100) };
    },
  });
}

function classifyLaunchError(e) {
  const m = String(e.message || e);
  if (/Java|UnsupportedClass/i.test(m)) return 'Java';
  if (/磁盘|空间/.test(m)) return '磁盘';
  if (/登录|账户|令牌|过期/.test(m)) return '账户';
  if (/网络|连不上|超时/.test(m)) return '网络';
  return '未知';
}
function defaultFixes(category) {
  const map = {
    'Java': [{ text: '打开 Java 管理页面', action: { type: 'openJavaSettings' } }],
    '磁盘': [{ text: '打开资源管理器清理', action: { type: 'openDiskSettings' } }],
    '账户': [{ text: '打开账户管理', action: { type: 'openAccounts' } }],
    '网络': [{ text: '查看网络帮助', action: { type: 'openHelp', topic: 'network' } }],
  };
  return map[category] || [{ text: '打开帮助中心', action: { type: 'openHelp' } }];
}
module.exports = { registerAll };
