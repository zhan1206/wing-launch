// 崩溃自动分析：读取崩溃日志 → 中文报告 + 一键修复
const fs = require('fs');
const path = require('path');
const { instanceDir } = require('../core/paths');
const instances = require('../instances/instances');
const { sanitize } = require('../core/sanitize');
const { UserError } = require('../core/ipc-gateway');

function latestCrashReport(instanceId, since = 0) {
  const dir = instanceDir(instanceId);
  const crDir = path.join(dir, 'crash-reports');
  const candidates = [];
  try {
    for (const f of fs.readdirSync(crDir)) {
      if (f.endsWith('.txt')) candidates.push({ p: path.join(crDir, f), m: fs.statSync(path.join(crDir, f)).mtimeMs, kind: 'crash-report' });
    }
  } catch { /* */ }
  const latestLog = path.join(dir, 'logs', 'latest.log');
  if (fs.existsSync(latestLog)) candidates.push({ p: latestLog, m: fs.statSync(latestLog).mtimeMs, kind: 'latest-log' });
  candidates.sort((a, b) => b.m - a.m);
  return candidates.find((c) => c.m >= since) || candidates[0] || null;
}

const RULES = [
  {
    test: /java\.lang\.OutOfMemoryError/i,
    what: '游戏因为内存不足退出了。',
    causes: [
      { title: '给游戏分配的内存太小了', detail: '游戏运行时需要的内存超过了分配上限（-Xmx）。', likelihood: 'high' },
      { title: '模组太多，内存不够用', detail: '装了较多模组时，2GB 以内的内存经常不够。', likelihood: 'medium' },
      { title: '系统本身内存紧张', detail: '同时开了很多大型程序也会挤占游戏内存。', likelihood: 'low' },
    ],
    fixes: [{ text: '把内存调高到 4GB', action: { type: 'setMemory', value: 4096 } }],
  },
  {
    test: /MissingModsException|Missing or unsupported mandatory dependencies|MissingModsHttpException/i,
    what: '有模组缺少它依赖的前置模组，游戏启动被阻止了。',
    causes: [
      { title: '缺少前置模组', detail: '日志里列出了缺失的模组 ID，把对应前置装上即可。', likelihood: 'high' },
      { title: '前置模组版本不匹配', detail: '前置装了但版本太旧或太新，需要换一个版本。', likelihood: 'medium' },
    ],
    fixes: [{ text: '打开实例的模组页，使用“检查缺失前置”', action: { type: 'openMods' } }],
  },
  {
    test: /UnsupportedClassVersionError|unsupported major\.minor|class file version/i,
    what: 'Java 版本和这个游戏版本不匹配。',
    causes: [
      { title: 'Java 版本太旧或太新', detail: '每个 MC 版本要求特定的 Java 大版本（例如 1.20.5+ 需要 Java 21）。', likelihood: 'high' },
    ],
    fixes: [{ text: '打开 Java 管理页面', action: { type: 'openJavaSettings' } }],
  },
  {
    test: /NoSuchMethodError|NoSuchFieldError|NoClassDefFoundError|Incompatible mod set|mod\.fingerprint/i,
    what: '模组之间发生了冲突（一个模组调用了另一个模组里不存在的方法）。',
    causes: [
      { title: '模组版本不匹配', detail: '某个模组和游戏版本或它的前置版本对不上。', likelihood: 'high' },
      { title: '同一模组装了两份', detail: '同一个模组的新旧版本同时在 mods 文件夹里。', likelihood: 'medium' },
    ],
    fixes: [{ text: '打开实例的模组页逐个排查（优先看日志里提到的模组）', action: { type: 'openMods' } }],
  },
  {
    test: /Failed to create window|GLX error|Unable to create GL context|LWJGL Exception|EXCEPTION_ACCESS_VIOLATION|hs_err_pid|no renderer available|Failed to initialize SDL|No available video device/i,
    what: '游戏图形界面初始化失败（显卡/图形驱动相关）。',
    causes: [
      { title: '图形驱动太旧', detail: '更新 macOS 与显卡驱动通常可以解决。', likelihood: 'high' },
      { title: '分辨率或窗口参数不被支持', detail: '在实例设置里把窗口分辨率改回 854×480 再试。', likelihood: 'medium' },
    ],
    fixes: [{ text: '打开实例设置', action: { type: 'openInstanceSettings' } }],
  },
  {
    test: /Failed to load datapacks|Registry loading errors|Errors in currently selected datapacks/i,
    what: '数据包加载出错，游戏无法继续。',
    causes: [
      { title: '数据包与游戏版本不匹配', detail: '数据包是给其他版本做的。', likelihood: 'high' },
      { title: '数据包文件损坏', detail: '重新导出或重新下载数据包。', likelihood: 'medium' },
    ],
    fixes: [{ text: '打开实例文件夹（saves/<世界>/datapacks）', action: { type: 'openFolder' } }],
  },
  {
    test: /java\.net\.ConnectException|Session servers|authserver|Failed to verify authentication/i,
    what: '游戏在联网验证环节出了问题。',
    causes: [
      { title: '网络不通或被拦截', detail: '检查网络；如果用了代理，试试关闭代理。', likelihood: 'high' },
      { title: '登录凭证过期', detail: '到账户管理里重新登录一次。', likelihood: 'medium' },
    ],
    fixes: [{ text: '打开账户管理', action: { type: 'openAccounts' } }],
  },
  {
    test: /Insufficient Permission|Permission denied|AccessDeniedException/i,
    what: '游戏文件访问被系统拒绝。',
    causes: [
      { title: '实例文件夹权限不对', detail: '把启动器数据文件夹移动出"下载"等受保护目录可以解决。', likelihood: 'high' },
    ],
    fixes: [{ text: '打开实例所在文件夹查看', action: { type: 'openFolder' } }],
  },
];

function analyzeFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8').slice(0, 400000);
  for (const rule of RULES) {
    if (rule.test.test(text)) {
      return { rule, text };
    }
  }
  // 内存信息
  const mem = /-Xmx(\d+)[mMgG]/.exec(text);
  const modLine = /Mod File: ([^\s]+\.jar)/.exec(text);
  const modId = /Mod Id: (\w+)/.exec(text) || /the following mods?[^\n]*?['"]?([\w-]+)['"]?/i.exec(text);
  return { rule: null, text, mem: mem?.[1], modFile: modLine?.[1], modId: modId?.[1] };
}

function analyzeText(text, logPath) {
  const parsed = matchRules(text);
  if (!parsed.rule) {
    if (parsed.mem) {
      return { what: '游戏意外退出了。日志显示当前内存分配是 ' + parsed.mem + 'MB，这不一定是原因，但调大内存通常更稳。', causes: [ { title: '内存偏小', detail: '模组较多时建议 4GB 以上。', likelihood: 'medium' }, { title: '某个模组在特定时机出错', detail: '如果反复在同一个操作后崩溃，试试逐个禁用模组定位。', likelihood: 'low' } ], fixes: [{ text: '把内存调高到 4GB', action: { type: 'setMemory', value: 4096 } }], reportText: sanitize(text).slice(0, 20000), logPath: logPath ? sanitize(logPath) : undefined, empty: false };
    }
    return { empty: true, message: '启动器没能从日志中找到明确的崩溃原因。这通常不是你的错。你可以把日志复制下来发给模组作者或社区。', reportText: sanitize(text).slice(0, 20000), logPath: logPath ? sanitize(logPath) : undefined };
  }
  return { what: parsed.rule.what, causes: parsed.rule.causes, fixes: [...parsed.rule.fixes], reportText: text.slice(0, 20000), logPath: logPath || undefined, empty: false };
}
function matchRules(text) {
  for (const rule of RULES) if (rule.test.test(text)) return { rule, text };
  const mem = /-Xmx(\d+)[mMgG]/.exec(text);
  return { rule: null, text, mem: mem?.[1] };
}
function analyze(instanceId, { since = 0 } = {}) {
  instances.get(instanceId);
  const hit = latestCrashReport(instanceId, since);
  // 兜底：游戏秒退没写日志时，用启动器捕获的进程输出
  let launcherLines = null;
  try { launcherLines = require('../instances/launch').getLastExit(instanceId); } catch { /* */ }
  if (!hit && launcherLines?.lastLines?.length) {
    return analyzeText(launcherLines.lastLines.join('\n'), null);
  }
  if (!hit) return { empty: true, message: '启动器没有找到崩溃日志。如果游戏刚刚闪退，等它完全关闭后再点一次“查看崩溃分析”。' };

  const dir = instanceDir(instanceId);
  let parsed;
  try { parsed = analyzeFile(hit.p); } catch {
    return { empty: true, message: '日志文件无法读取（可能被其他程序占用）。稍后再试一次。' };
  }
  const reportText = (() => {
    try { return sanitize(fs.readFileSync(hit.p, 'utf8').slice(0, 20000)); } catch { return ''; }
  })();

  if (!parsed.rule) {
    // 尝试从日志提取有用信息
    if (parsed.mem) {
      return {
        what: '游戏意外退出了。日志显示当前内存分配是 ' + parsed.mem + 'MB，这不一定是原因，但调大内存通常更稳。',
        causes: [
          { title: '内存偏小', detail: '模组较多时建议 4GB 以上。', likelihood: 'medium' },
          { title: '某个模组在特定时机出错', detail: '如果反复在同一个操作后崩溃，试试逐个禁用模组定位。', likelihood: 'low' },
        ],
        fixes: [{ text: '把内存调高到 4GB', action: { type: 'setMemory', value: 4096 } }],
        reportText, logPath: hit.p, empty: false,
      };
    }
    return {
      empty: true,
      message: '启动器没能从日志中找到明确的崩溃原因。这通常不是你的错。你可以把日志复制下来发给模组作者或社区。',
      reportText, logPath: hit.p,
    };
  }

  const causes = parsed.rule.causes;
  const fixes = [...parsed.rule.fixes];
  if (parsed.rule.fixes.some((f) => f.action?.type === 'setMemory')) {
    // OOM：附内存操作按钮已含
  }
  return {
    what: sanitize(parsed.rule.what) + (parsed.modFile ? `（日志中提到的模组：${parsed.modFile}）` : ''),
    causes,
    fixes,
    reportText,
    logPath: sanitize(hit.p),
    empty: false,
  };
}

function applyFix(instanceId, fix) {
  if (fix?.type === 'setMemory') {
    const i = instances.get(instanceId);
    i.settings = { ...i.settings, memory: fix.value };
    instances; // settings saved via instances.setSettings route logic
    const d = require('../core/config').readJson(require('../core/paths').dirs().instancesFile, { instances: [] });
    const inst = d.instances.find((x) => x.id === instanceId);
    if (inst) { inst.settings = { ...inst.settings, memory: fix.value }; require('../core/config').writeJson(require('../core/paths').dirs().instancesFile, d); }
    return '已把内存调高到 4GB，重新启动游戏即可生效。';
  }
  if (fix?.type === 'openMods') { require('../core/emitter').broadcast('bb:goto', `/instances/${instanceId}/mods`); return '已打开模组页面。'; }
  if (fix?.type === 'openInstanceSettings') { require('../core/emitter').broadcast('bb:goto', `/instances/${instanceId}`); return '已打开实例页面。'; }
  if (fix?.type === 'openJavaSettings') { require('../core/emitter').broadcast('bb:goto', '/settings/java'); return '已打开 Java 管理页面。'; }
  if (fix?.type === 'openAccounts') { require('../core/emitter').broadcast('bb:goto', '/accounts'); return '已打开账户页面。'; }
  if (fix?.type === 'openFolder') { require('electron').shell.openPath(instanceDir(instanceId)); return '已打开实例文件夹。'; }
  throw new UserError('这个修复暂时不能一键执行，请按报告里的说明手动处理。');
}

function registerAll(register) {
  register({
    'crash.analyze': ({ instanceId, since }) => analyze(instanceId, { since: since || 0 }),
    'crash.applyFix': ({ instanceId, fix }) => ({ message: applyFix(instanceId, fix) }),
    'crash.history': ({ instanceId }) => {
      const crDir = path.join(instanceDir(instanceId), 'crash-reports');
      try {
        return fs.readdirSync(crDir).filter((f) => f.endsWith('.txt')).map((f) => ({
          file: f, time: fs.statSync(path.join(crDir, f)).mtimeMs,
        })).sort((a, b) => b.time - a.time);
      } catch { return []; }
    },
  });
}
module.exports = { registerAll, analyze };
