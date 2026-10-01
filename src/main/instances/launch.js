// 游戏启动管线：参数拼装、进程监控、崩溃检测、Java 失败自动降级
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const config = require('../core/config');
const { dirs } = require('../core/paths');
const javaMgr = require('../java/java-manager');
const accounts = require('../accounts/accounts');
const offlineSkin = require('../accounts/offline-skin');
const { ensureVersionFiles, ARCH, mcVersionOf } = require('./game-install');
const { getMergedMeta } = require('../meta/versions');
const { broadcast, toast } = require('../core/emitter');
const { UserError } = require('../core/ipc-gateway');
const log = require('../core/log');

const sessions = new Map(); // session -> info
const lastExit = new Map(); // instanceId -> { lastLines, code, lifetimeMs }
let SEQ = 1;

function emitProgress(session, stage, text, percent) {
  broadcast('bb:launch-progress', { session, stage, text, percent });
}

// 处理带规则的参数对象：features 规则默认不启用；os 规则按平台匹配（macos/osx 等价）
function ruleAllowsArg(rules) {
  for (const r of rules || []) {
    if (r.features) return false;
    if (r.os) {
      const n = r.os.name;
      if (n && n !== 'macos' && n !== 'osx' && n !== process.platform) return false;
      if (r.os.arch && r.os.arch !== ARCH) return false;
    }
  }
  return true;
}
function filterJvmArgs(args) {
  const out = [];
  for (const a of args || []) {
    if (typeof a === 'string') { out.push(a); continue; }
    if (!a || typeof a !== 'object') continue;
    if (ruleAllowsArg(a.rules)) out.push(...(Array.isArray(a.value) ? a.value : [a.value]));
  }
  return out;
}

function buildLaunchArgs({ meta, account, instance, instanceDir, nativesDir, classpath, logConfigPath, memoryMB, agentArg }) {
  const sep = process.platform === 'win32' ? ';' : ':';
  const substitutions = {
    auth_player_name: account.name,
    version_name: meta.id,
    game_directory: instanceDir,
    assets_root: dirs().assets,
    assets_index_name: meta.assetIndex?.id || meta.assets || 'legacy',
    auth_uuid: account.uuidHex,
    auth_access_token: account.accessToken || '0',
    auth_session: `token:${account.accessToken || '0'}:${account.uuidHex}`,
    user_type: account.type === 'microsoft' ? 'msa' : account.type === 'yggdrasil' ? 'msa' : 'legacy',
    user_properties: '{}',
    version_type: meta.type || 'release',
    natives_directory: nativesDir,
    launcher_name: 'BlockBox',
    launcher_version: '1.0.0',
    classpath: classpath.join(sep),
    classpath_separator: sep,
    library_directory: dirs().libraries,
    clientid: 'blockbox',
    auth_xuid: '0',
    resolution_width: String(instance?.settings?.width || config.get().width),
    resolution_height: String(instance?.settings?.height || config.get().height),
    quickPlayPath: '', quickPlaySingleplayer: '', quickPlayMultiplayer: '', quickPlayRealms: '',
    game_assets: path.join(dirs().assets, 'virtual', 'legacy'),
  };
  const subst = (s) => String(s).replace(/\$\{(\w+)\}/g, (_, k) => substitutions[k] ?? '');

  const jvm = [
    `-Xms${Math.min(512, memoryMB)}M`, `-Xmx${memoryMB}M`,
    '-XX:+UseG1GC', '-XX:MaxGCPauseMillis=50',
    '-Dlog4j2.formatMsgNoLookups=true',
    `-Djava.library.path=${nativesDir}`,
    '-Duser.language=zh', '-Duser.country=CN',
  ];
  if (logConfigPath) jvm.push(`-Dlog4j.configurationFile=${logConfigPath}`);
  if (agentArg) jvm.push(agentArg);

  const metaJvm = filterJvmArgs(meta.arguments?.jvm || []).map(subst).filter((s) => !s.includes('${')); // 无法替换的参数丢弃
  jvm.push(...metaJvm);
  if (!(meta.arguments?.jvm || []).length && meta.minecraftArguments) {
    // 旧版：无 jvm 元数据，补基础参数
  }

  const game = [];
  if (meta.arguments?.game?.length) {
    for (const a of meta.arguments.game) {
      if (typeof a !== 'string') {
        // 条件参数：resolution 等
        const featOk = ruleAllowsArg(a.rules);
        if (!featOk) continue;
        game.push(...(a.value || []).map(String));
        continue;
      }
      game.push(subst(a));
    }
  } else if (meta.minecraftArguments) {
    game.push(...meta.minecraftArguments.split(' ').map(subst));
  }
  const w = instance?.settings?.width || config.get().width, h = instance?.settings?.height || config.get().height;
  if (w && h && !meta.minecraftArguments) { game.push('--width', String(w), '--height', String(h)); }
  const qpWorld = instance?.settings?.quickPlayWorld;
  if (qpWorld) { game.push('--quickPlaySingleplayer', String(qpWorld)); }
  if (!game.includes('--gameDir')) { game.push('--gameDir', instanceDir); }
  return { jvm: jvm.map(subst).filter((s) => !s.includes('${')), game };
}

async function findJavaFor(meta, preferredMajor) {
  const want = preferredMajor ?? meta.javaVersion?.majorVersion ?? javaMgr.mapMajor(meta).major;
  const j = await javaMgr.ensure(want);
  return { java: j, want };
}

async function launch(instance, { accountId, preferredMajor = null, sessionOverride = null } = {}) {
  const session = sessionOverride || 'ls-' + (SEQ++) + '-' + Date.now().toString(36);
  const instanceDir = instance.dir;
  const account = await accounts.validateForLaunch(accountId || instance.boundAccountId || null);
  emitProgress(session, 'meta', '正在读取版本信息…', 5);

  const meta = await getMergedMeta(instance.launchVersionId || instance.versionId);
  const memoryMB = instance.settings?.memory === 'auto' || !instance.settings?.memory ? config.memoryMB() : Number(instance.settings.memory);

  emitProgress(session, 'java', '正在检查 Java 环境…', 12);
  const { java, want } = await findJavaFor(meta, preferredMajor);

  emitProgress(session, 'libs', '正在准备游戏文件（首次会下载较多内容）…', 20);
  const files = await ensureVersionFiles(meta, { taskId: session });

  // 离线账户皮肤
  let agentArg = null;
  if (account.type === 'offline' && account.skinId) {
    try {
      const skinFile = path.join(dirs().skins, account.skinId + '.png');
      if (fs.existsSync(skinFile)) {
        const port = await offlineSkin.start();
        offlineSkin.setSkin(account.uuidHex, account.name, skinFile, account.model || 'classic');
        const agentJar = await offlineSkin.ensureAgentJar();
        if (agentJar) agentArg = `-javaagent:${agentJar}=http://127.0.0.1:${port}`;
      }
    } catch (e) { log.warn('本地皮肤服务不可用：', e.message); }
  }

  emitProgress(session, 'launch', '正在启动游戏…', 85);
  const { jvm, game } = buildLaunchArgs({ meta, account, instance, instanceDir, nativesDir: files.nativesDir, classpath: files.classpath, logConfigPath: files.logConfigPath, memoryMB, agentArg });

  const javaExe = path.join(java.path, 'bin', 'java');
  const args = [...jvm, meta.mainClass, ...game];
  log.info('启动：', javaExe, args.slice(0, 8).join(' '), '…');
  if (process.env.BLOCKBOX_SMOKE) { try { fs.writeFileSync('/tmp/mc-args.json', JSON.stringify({ javaExe, args, cwd: instanceDir }, null, 1)); } catch { /* */ } }

  const startedAt = Date.now();
  let child;
  try {
    child = spawn(javaExe, args, { cwd: instanceDir, env: { ...process.env }, detached: true });
    child.unref(); // 游戏进程脱离启动器：启动器退出后游戏继续运行
  } catch (e) {
    throw new UserError('无法启动游戏进程：' + e.message);
  }
  const info = {
    session, instanceId: instance.id, pid: child.pid, startedAt, exited: false,
    lines: [], crashed: false, lastLines: [], account: account.name,
  };
  sessions.set(session, info);

  const capture = (buf) => {
    const text = buf.toString('utf8');
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      info.lines.push(line);
      if (info.lines.length > 600) info.lines.shift();
    }
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  child.on('error', (e) => {
    info.exited = true;
    broadcast('bb:launch-exit', { session, instanceId: instance.id, code: -1, signal: null, startedAt, lifetimeMs: Date.now() - startedAt, crashed: true, lastLines: info.lines.slice(-80), errorMessage: e.message });
  });
  child.on('exit', async (code, signal) => {
    info.exited = true;
    const lifetimeMs = Date.now() - startedAt;
    const out = info.lines.join('\n');
    // 崩溃判定
    const classVersionErr = /UnsupportedClassVersionError/.test(out);
    let crashed = code !== 0 || /Crash report saved|Manifest of the JVM| GAME ERROR/i.test(out) && code !== 0;
    if (code === 0) crashed = false;
    if (lifetimeMs < 8000 && code !== 0) crashed = true;
    info.crashed = crashed;
    info.lastLines = info.lines.slice(-80);

    // Java 版本不匹配自动换一个重试（一次）
    if (classVersionErr && !sessionOverride && !info._retried) {
      const cvm = /class file version ([\d.]+)/.exec(out);
      let need = null;
      if (cvm) need = Math.round(parseFloat(cvm[1]) - 44); // 61→17, 65→21, 52→8
      if (need && need !== want && need >= 8 && need <= 25) {
        toast(`Java ${want} 启动失败了，正在尝试 Java ${need}。`, 'warn', 5000);
        const { java: java2 } = { java: await javaMgr.ensure(need) };
        sessions.delete(session);
        return launch(instance, { accountId: account.id, preferredMajor: need, sessionOverride: session });
      }
    }

    lastExit.set(instance.id, { lastLines: info.lastLines, code, lifetimeMs });
    broadcast('bb:launch-exit', { session, instanceId: instance.id, code, signal, startedAt, lifetimeMs, crashed, lastLines: info.lastLines });
    if (!crashed && code === 0) { /* 正常退出 */ }
  });

  // 90 秒仍未见游戏窗口：给出可能原因提示，避免用户以为卡死
  setTimeout(() => {
    if (!info.exited && !info.lines.some((x) => /Backend library: LWJGL|Setting user/.test(x))) {
      broadcast('bb:launch-warning', { instanceId: instance.id, text: '游戏已经启动但 90 秒了还没出现窗口。第一次启动要加载很久属正常；如果超过 5 分钟还没窗口，可以查看崩溃分析或到帮助中心搜索"启动慢"。' });
    }
  }, 90000);
  // 启动成功提示
  setTimeout(() => {
    if (!info.exited) {
      toast(`游戏已启动（${instance.name} · ${account.name}）。最小化启动器也可以，游戏会自己开窗口。`, 'ok', 5000);
      try { require('../core/download/manager').clearFinished(); } catch { /* */ } // 启动后资源释放：清理已完成下载任务
    }
  }, 9000);

  return { session, pid: child.pid };
}

function getSession(session) { return sessions.get(session); }

function anyAlive() { for (const s of sessions.values()) { if (!s.exited) return true; } return false; }
module.exports = { launch, getSession, buildLaunchArgs, getLastExit: (id) => lastExit.get(id), anyAlive };
