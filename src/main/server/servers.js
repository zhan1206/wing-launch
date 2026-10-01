// 服务器：创建 / 一键开服 / 控制台 / 端口探测
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const config = require('../core/config');
const { dirs, ensure, serverDir } = require('../core/paths');
const { readJson, writeJson } = config;
const { UserError } = require('../core/ipc-gateway');
const { broadcast, toast } = require('../core/emitter');
const manager = require('../core/download/manager');
const sources = require('../core/download/sources');
const javaMgr = require('../java/java-manager');
const { getMergedMeta } = require('../meta/versions');
const trash = require('../core/trash');
const modpack = require('../modpack/modpack');
const zipsafe = require('../core/zipsafe');

const FILE = () => dirs().serversFile;
function load() { return readJson(FILE(), { servers: [] }); }
function save(d) { writeJson(FILE(), d); broadcast('bb:servers-changed', list()); }

const running = new Map(); // id -> {proc, buffer, startedAt}

function list() {
  return load().servers.map((s) => ({
    id: s.id, name: s.name, dir: s.dir, versionId: s.versionId, loader: s.loader || 'vanilla',
    loaderVersion: s.loaderVersion || null, port: s.port || 25565, eulaAccepted: !!s.eulaAccepted,
    status: running.has(s.id) ? (running.get(s.id).starting ? 'starting' : 'running') : 'stopped',
    portNotice: s.portNotice || null,
  }));
}
function get(id) {
  const s = load().servers.find((x) => x.id === id);
  if (!s) throw new UserError('找不到这个服务器，它可能已被删除。');
  return s;
}

function portFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '0.0.0.0');
  });
}

async function createVanilla({ name, versionId }) {
  name = String(name || '').trim() || '我的服务器';
  const id = 'srv-' + crypto.randomBytes(4).toString('hex');
  const dir = serverDir(id);
  fs.mkdirSync(dir, { recursive: true });
  const s = { id, name, dir, versionId, loader: 'vanilla', loaderVersion: null, port: 25565, eulaAccepted: false, createdAt: Date.now() };
  // 预下载服务端 jar
  const meta = await getMergedMeta(versionId);
  const sd = meta.downloads?.server;
  if (sd?.url) {
    await manager.download({ name: `服务端 ${versionId}`, type: '游戏', url: sd.url, dest: path.join(dir, 'server.jar'), sha1: sd.sha1, size: sd.size || 0 });
  } else {
    throw new UserError(`版本 ${versionId} 没有官方服务端下载，换个正式版试试。`);
  }
  writeServerProperties(dir, 25565);
  fs.writeFileSync(path.join(dir, 'eula.txt'), '# 在启动器界面勾选同意 EULA 后，这里会自动变成 true\neula=false\n');
  const d = load();
  d.servers.push(s);
  save(d);
  return { id };
}

function writeServerProperties(dir, port) {
  const props = [
    `server-port=${port}`, `view-distance=10`, `online-mode=true`, `max-players=20`,
    `motd=\u00A7a\u4E00\u4E2A\u65B9\u5757\u76D2\u5B50\u670D\u52A1\u5668`, `difficulty=normal`, `gamemode=survival`,
    `white-list=false`, `enable-command-block=false`, `spawn-protection=16`,
  ];
  fs.writeFileSync(path.join(dir, 'server.properties'), props.join('\n') + '\n');
}

// 从整合包创建服务器
async function createFromModpack({ info, zip, instanceName, dir: _clientDir }) {
  const id = 'srv-' + crypto.randomBytes(4).toString('hex');
  const dir = serverDir(id);
  fs.mkdirSync(dir, { recursive: true });
  const s = {
    id, name: `${instanceName} 服务器`, dir, versionId: info.mcVersion, loader: info.loader,
    loaderVersion: info.loaderVersion, port: 25565, eulaAccepted: false, createdAt: Date.now(),
  };
  // 服务端模组与配置
  if (info.type === 'mrpack') {
    const idx = JSON.parse(zip.getEntry('modrinth.index.json').getData().toString('utf8'));
    const serverFiles = (idx.files || []).filter((f) => f.env?.server === 'required' || (f.env?.server !== 'unsupported' && f.env?.client === 'required'));
    const dl = serverFiles
      .filter((f) => zipsafe.safeName(f.path)) // 索引里的相对路径可能带 ../，跳过以免写到服务器目录之外
      .map((f) => ({ name: path.basename(f.path), type: '模组', url: f.downloads[0], dest: path.join(dir, zipsafe.safeName(f.path)), sha1: f.hashes?.sha1 }));
    if (dl.length) await manager.addBulk(dl);
    modpack.extractOverride(zip, 'overrides', dir);
  } else {
    modpack.extractOverride(zip, 'overrides', dir);
    // CF 模组：尽力下载全部
    const manifest = JSON.parse(zip.getEntry('manifest.json').getData().toString('utf8'));
    const resolved = await require('../modpack/modpack').resolveCurseforgeFiles(manifest.files || []);
    const dl = resolved.ok
      .filter((f) => zipsafe.safeName(f.filename))
      .map((f) => ({ name: f.filename, type: '模组', url: f.url, dest: path.join(dir, 'mods', zipsafe.safeName(f.filename)) }));
    if (dl.length) await manager.addBulk(dl);
  }
  writeServerProperties(dir, 25565);
  fs.writeFileSync(path.join(dir, 'eula.txt'), 'eula=false\n');
  const d = load();
  d.servers.push(s);
  save(d);
  return { id };
}

// 服务端文件就绪（loader 服务端安装）
async function ensureServerFiles(s) {
  const dir = s.dir;
  if (s.loader === 'vanilla') {
    if (!fs.existsSync(path.join(dir, 'server.jar'))) {
      const meta = await getMergedMeta(s.versionId);
      const sd = meta.downloads?.server;
      if (sd?.url) await manager.download({ name: `服务端 ${s.versionId}`, type: '游戏', url: sd.url, dest: path.join(dir, 'server.jar'), sha1: sd.sha1 });
      else throw new UserError('这个版本没有官方服务端。');
    }
    return { cmd: [path.join((await javaMgr.ensure(javaMajorFor(s.versionId))).path, 'bin', 'java'), '-Xms512M', `-Xmx${Math.max(1024, Math.round(require('os').totalmem() / 4 / 1e6) * 1)}M`, '-jar', 'server.jar', 'nogui'] };
  }
  if (s.loader === 'fabric' || s.loader === 'quilt') {
    const base = s.loader === 'fabric' ? 'https://meta.fabricmc.net/v2' : 'https://meta.quiltmc.org/v3';
    const lv = s.loaderVersion || (s.loader === 'fabric' ? 'latest' : 'latest');
    const jarPath = path.join(dir, 'fabric-server-launch.jar');
    if (!fs.existsSync(jarPath)) {
      const url = s.loader === 'fabric'
        ? `${base}/versions/loader/${s.versionId}/${lv}/1.0.3/server/jar`
        : `${base}/versions/loader/${s.versionId}/${lv}/installer/server/jar`;
      await manager.download({ name: `${s.loader} 服务端`, type: '游戏', url, dest: jarPath });
    }
    return { cmd: [path.join((await javaMgr.ensure(javaMajorFor(s.versionId))).path, 'bin', 'java'), '-jar', 'fabric-server-launch.jar', 'nogui'] };
  }
  // forge / neoforge
  const unixArgs = findUnixArgs(dir, s.loader);
  if (!unixArgs) {
    // 下载安装器并安装
    let installerUrl, fname;
    if (s.loader === 'forge') {
      const lv = s.loaderVersion || 'recommended';
      let fvl = lv;
      if (fvl === 'recommended' || fvl === 'latest') {
        const promos = await sources.fetchJson('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json');
        fvl = promos.promos?.[`${s.versionId}-${fvl}`];
      }
      installerUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${s.versionId}-${fvl}/forge-${s.versionId}-${fvl}-installer.jar`;
      fname = `forge-${s.versionId}-${fvl}-installer.jar`;
      s.loaderVersion = fvl;
    } else {
      const lv = s.loaderVersion;
      installerUrl = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${lv}/neoforge-${lv}-installer.jar`;
      fname = `neoforge-${lv}-installer.jar`;
    }
    const installerJar = path.join(dir, fname);
    await manager.download({ name: fname, type: '游戏', url: installerUrl, dest: installerJar });
    toast('这个整合包没有包含服务端文件，启动器正在从在线源下载对应版本的服务端。这个过程可能需要几分钟。', 'info', 6000);
    const j = await javaMgr.ensure(javaMajorFor(s.versionId));
    await new Promise((resolve, reject) => {
      execFile(path.join(j.path, 'bin', 'java'), ['-jar', installerJar, '--installServer', dir], { timeout: 15 * 60 * 1000, maxBuffer: 64e6, cwd: dir }, (err, _o, stderr) => err ? reject(new UserError('服务端安装器运行失败：' + String(stderr || err.message).slice(-200))) : resolve());
    });
  }
  const argsFile = findUnixArgs(dir, s.loader);
  if (!argsFile) throw new UserError('服务端安装后仍找不到启动配置，请稍后重试。');
  return { cmd: [path.join((await javaMgr.ensure(javaMajorFor(s.versionId))).path, 'bin', 'java'), '-Xms512M', '-Xmx2G', `@${argsFile}`, 'nogui'] };
}
function javaMajorFor(v) {
  const m = javaMgr.mapMajor(v);
  return m.major;
}
function findUnixArgs(dir, loader) {
  const libRoot = path.join(dir, 'libraries');
  if (!fs.existsSync(libRoot)) return null;
  const rel = loader === 'forge' ? 'net/minecraftforge/forge' : 'net/neoforged/neoforge';
  const base = path.join(libRoot, rel);
  if (!fs.existsSync(base)) return null;
  for (const v of fs.readdirSync(base)) {
    for (const f of ['unix_args.txt', 'win_args.txt']) {
      const p = path.join(base, v, f);
      if (fs.existsSync(p)) return path.relative(dir, p);
    }
  }
  return null;
}

async function start(id) {
  const s = get(id);
  if (running.has(id)) return { port: s.port };
  // EULA 检查
  if (!s.eulaAccepted) throw new UserError('启动服务器前需要先同意 Minecraft EULA。在界面上勾选"我同意 Minecraft EULA"即可。');
  const info = { proc: null, starting: true, startedAt: Date.now() };
  running.set(id, info);
  broadcastServerStatus(id);
  try {
    // 端口探测
    let port = s.port || 25565;
    if (!(await portFree(port))) {
      for (const p of [25566, 25567, 25568, 25569]) {
        if (await portFree(p)) { port = p; break; }
      }
      s.portNotice = `25565 端口被占用了，已自动改为 ${port}。好友连接时请使用 你的IP:${port}。`;
      toast(s.portNotice, 'warn', 8000);
    } else {
      s.portNotice = null;
    }
    s.port = port;
    // 更新 properties
    writeServerProperties(dir0(s), port);
    const d2 = load();
    const s2 = d2.servers.find((x) => x.id === id);
    if (s2) { s2.port = port; s2.portNotice = s.portNotice; save(d2); }

    const { cmd } = await ensureServerFiles(s);
    info.proc = spawn(cmd[0], cmd.slice(1), { cwd: s.dir, env: process.env });
    // spawn 失败（Java 被删除 / 无执行权限）会异步 emit 'error'，不监听会变成未捕获异常并把状态卡在 starting
    info.proc.on('error', (e) => {
      pushConsole(id, `\n[无法启动服务器] ${e.message}\n`, 'error');
      running.delete(id);
      info.starting = false;
      broadcastServerStatus(id);
    });
    info.buffer = [];
    info.proc.stdout.on('data', (d) => pushConsole(id, d.toString('utf8')));
    info.proc.stderr.on('data', (d) => pushConsole(id, d.toString('utf8'), 'warn'));
    info.proc.on('exit', (code) => {
      pushConsole(id, `\n[服务器已退出，退出码 ${code}]\n`, code === 0 ? 'info' : 'error');
      running.delete(id);
      broadcastServerStatus(id);
      const raw = get(id);
      if (raw.autoRestart && code !== 0 && (info.restartCount = (info.restartCount || 0) + 1) <= 3) {
        pushConsole(id, '[崩溃自动重启] 正在自动重新启动（第 ' + info.restartCount + ' 次，最多 3 次）', 'warn');
        setTimeout(() => { start(id).catch(() => {}); }, 5000);
      }
    });
    info.starting = false;
    broadcastServerStatus(id);
    return { port };
  } catch (e) {
    running.delete(id);
    broadcastServerStatus(id);
    throw e;
  }
}
const dir0 = (s) => s.dir;

function pushConsole(id, text, forcedLevel = null) {
  const lines = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    let level = forcedLevel;
    if (!level) {
      const m = /\[(\d{2}:\d{2}:\d{2})\] \[[^\]]+\/(INFO|WARN|ERROR)\]/.exec(raw) || /\/(INFO|WARN|ERROR)\]/.exec(raw);
      level = m ? m[2].toLowerCase() : /ERROR|Exception|FATAL/.test(raw) ? 'error' : /WARN/.test(raw) ? 'warn' : 'info';
    }
    lines.push({ text: raw, level });
  }
  if (!lines.length) return;
  broadcast('bb:server-console', { id, lines });
}
function broadcastServerStatus(id) {
  const s = get(id);
  broadcast('bb:server-status', { id, status: running.has(id) ? (running.get(id).starting ? 'starting' : 'running') : 'stopped', port: s.port });
}

function stop(id) {
  const info = running.get(id);
  if (!info) return false;
  try { info.proc.stdin.write('stop\n'); } catch { /* */ }
  setTimeout(() => {
    if (running.has(id)) {
      try { info.proc.kill('SIGKILL'); } catch { /* */ }
    }
  }, 20000);
  return true;
}
function sendCommand(id, text) {
  const info = running.get(id);
  if (!info) throw new UserError('服务器还没有启动。');
  try { info.proc.stdin.write(text.replace(/^\//, '') + '\n'); return true; }
  catch { throw new UserError('命令发送失败，服务器可能刚刚退出。'); }
}
function acceptEula(id, accept) {
  const d = load();
  const s = d.servers.find((x) => x.id === id);
  if (!s) throw new UserError('找不到这个服务器，它可能已被删除。');
  s.eulaAccepted = !!accept;
  fs.writeFileSync(path.join(s.dir, 'eula.txt'), `# Generated by BlockBox\neula=${accept ? 'true' : 'false'}\n`);
  save(d);
  return true;
}
function remove(id) {
  const d = load();
  const idx = d.servers.findIndex((x) => x.id === id);
  if (idx < 0) throw new UserError('服务器不存在。');
  if (running.has(id)) throw new UserError('服务器正在运行，请先停止再删除。');
  const s = d.servers[idx];
  trash.deleteToTrash(s.dir, '服务器');
  d.servers.splice(idx, 1);
  save(d);
  return true;
}

let serverTimers = null;
function setupServerTimers() {
  if (serverTimers) { for (const t of serverTimers) clearInterval(t); }
  serverTimers = [];
  for (const s of load().servers) {
    if (s.backupIntervalMin && running.has(s.id)) {
      serverTimers.push(setInterval(() => {
        if (!running.has(s.id)) return;
        try { info_of(s.id)?.proc?.stdin?.write('say 自动备份中…\n'); } catch { /* */ }
        try {
          const AdmZip = require('adm-zip');
          const zip = new AdmZip();
          const worldDirs = fs.readdirSync(s.dir).filter((d) => fs.existsSync(path.join(s.dir, d, 'level.dat')));
          for (const w of worldDirs) zip.addLocalFolder(path.join(s.dir, w), w);
          const bdir = path.join(s.dir, 'backups');
          fs.mkdirSync(bdir, { recursive: true });
          zip.writeZip(path.join(bdir, '自动-' + Date.now() + '.zip'));
        } catch { /* */ }
      }, Math.max(5, s.backupIntervalMin) * 60000));
    }
  }
}
function info_of(id) { return running.get(id); }
// 崩溃自动重启：在 exit 回调中处理（见 start() 内）
function registerAll(register) {
  register({
    'servers.list': () => list(),
    'servers.detail': ({ id }) => {
      const s = get(id);
      const props = {};
      try {
        for (const line of fs.readFileSync(path.join(s.dir, 'server.properties'), 'utf8').split(/\r?\n/)) {
          const i = line.indexOf('=');
          if (i > 0 && !line.startsWith('#')) props[line.slice(0, i).trim()] = line.slice(i + 1).trim();
        }
      } catch { /* 无文件用默认 */ }
      return { ...s, status: running.has(id) ? 'running' : 'stopped', props };
    },
    'servers.createVanilla': (p) => createVanilla(p),
    'servers.remove': ({ id }) => remove(id),
    'servers.openFolder': ({ id }) => { require('electron').shell.openPath(get(id).dir); return true; },
    'servers.start': ({ id }) => start(id),
    'servers.stop': ({ id }) => stop(id),
    'servers.sendCommand': ({ id, text }) => sendCommand(id, text),
    'servers.acceptEula': ({ id, accept }) => acceptEula(id, accept),
    'servers.command': ({ id, cmd }) => sendCommand(id, cmd),
    'servers.inviteText': ({ id }) => {
      const s = get(id);
      const runningNow = running.has(id);
      return `【Minecraft 服务器邀请】
服务器地址：127.0.0.1:${s.port}（同一网络下的好友请把 127.0.0.1 换成你的 IP，可在启动器"联机"页查看本机 IP）
端口：${s.port}
版本：${s.versionId}（${s.loader === 'vanilla' ? '原版' : s.loader}）
状态：${runningNow ? '运行中' : '未启动'}
需要模组：${s.loader === 'vanilla' ? '无需模组，直接加入' : '需要 ' + s.loader + ' 客户端'}`;
    },
    'servers.exportProps': ({ id }) => {
      const s = get(id);
      return fs.readFileSync(path.join(s.dir, 'server.properties'), 'utf8');
    },
    'servers.importProps': ({ id, text }) => {
      const s = get(id);
      if (running.has(id)) throw new UserError('服务器正在运行，请先停止再导入配置。');
      // 先备份再导入（可回滚）
      fs.copyFileSync(path.join(s.dir, 'server.properties'), path.join(s.dir, 'server.properties.import-bak'));
      const clean = String(text || '').split(/\r?\n/).filter((l) => /^[\w.-]+=/.test(l)).join('\n');
      if (!clean) throw new UserError('导入内容不是有效的 server.properties 格式（每行应为 键=值）。');
      fs.writeFileSync(path.join(s.dir, 'server.properties'), clean + '\n');
      return { message: '配置已导入。原配置已备份为 server.properties.import-bak，可随时恢复。' };
    },
    'servers.restorePropsBak': ({ id }) => {
      const s = get(id);
      const bak = path.join(s.dir, 'server.properties.import-bak');
      if (!fs.existsSync(bak)) throw new UserError('没有找到导入前的备份。');
      fs.copyFileSync(bak, path.join(s.dir, 'server.properties'));
      return { message: '已恢复到导入前的配置。' };
    },
    'servers.scheduleBackup': ({ id, intervalMinutes }) => {
      const s = get(id);
      const d = load();
      const raw = d.servers.find((x) => x.id === id);
      raw.backupIntervalMin = Number(intervalMinutes) || 0;
      save(d);
      setupServerTimers();
      return { message: raw.backupIntervalMin ? '已开启自动备份，每 ' + raw.backupIntervalMin + ' 分钟一次（服务器运行时生效）。' : '已关闭自动备份。' };
    },
    'servers.setAutoRestart': ({ id, enabled }) => {
      const d = load();
      const raw = d.servers.find((x) => x.id === id);
      raw.autoRestart = !!enabled;
      save(d);
      return { message: raw.autoRestart ? '已开启崩溃自动重启：服务器意外退出时会自动再启动（最多连续 3 次）。' : '已关闭崩溃自动重启。' };
    },
    'servers.saveProps': ({ id, props }) => {
      const s = get(id);
      const file = path.join(s.dir, 'server.properties');
      if (running.has(id)) throw new UserError('服务器正在运行，请先停止再修改设置。');
      const cur = {};
      try {
        for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
          const i = line.indexOf(':');
          if (i > 0 && !line.startsWith('#')) cur[line.slice(0, i).trim()] = line.slice(i + 1).trim();
        }
      } catch { /* */ }
      const merged = { ...cur, ...(props || {}) };
      fs.writeFileSync(file, Object.entries(merged).map(([k, v]) => k + '=' + v).join('\n') + '\n');
      if (merged['server-port']) { s.port = Number(merged['server-port']) || s.port; save(load()); }
      return true;
    },
    'servers.backup': ({ id }) => {
      const s = get(id);
      if (running.has(id)) throw new UserError('服务器正在运行，请先停止再备份。');
      const AdmZip = require('adm-zip');
      const zip = new AdmZip();
      const bdir = path.join(s.dir, 'backups');
      fs.mkdirSync(bdir, { recursive: true });
      // 备份内容排除 backups 自身，避免滚雪球
      for (const item of fs.readdirSync(s.dir)) {
        if (item === 'backups') continue;
        const p = path.join(s.dir, item);
        if (fs.statSync(p).isDirectory()) zip.addLocalFolder(p, path.basename(s.dir) + '/' + item);
        else zip.addLocalFile(p, path.basename(s.dir));
      }
      const out = path.join(bdir, '服务器备份-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.zip');
      zip.writeZip(out);
      return { path: out };
    },
    'servers.restore': ({ id }) => {
      const s = get(id);
      if (running.has(id)) throw new UserError('服务器正在运行，请先停止再恢复。');
      const bdir = path.join(s.dir, 'backups');
      const files = fs.existsSync(bdir) ? fs.readdirSync(bdir).filter((f) => f.endsWith('.zip')).sort() : [];
      if (!files.length) throw new UserError('还没有服务器备份。先点「备份服务器」创建一个。');
      const { assertSafe, safeExtract } = require('../core/zipsafe');
      const zip = new (require('adm-zip'))(path.join(bdir, files[files.length - 1]));
      assertSafe(zip, { maxTotalBytes: 16 * 1024 * 1024 * 1024 });
      const staging = s.dir + '.restore-' + Date.now();
      fs.mkdirSync(staging, { recursive: true });
      safeExtract(zip, staging);
      // 先备份当前，再覆盖
      const AdmZip2 = require('adm-zip');
      const pre = new AdmZip2();
      try { pre.addLocalFolder(s.dir, path.basename(s.dir)); pre.writeZip(path.join(bdir, '恢复前-' + Date.now() + '.zip')); } catch { /* */ }
      fs.cpSync(staging + '/' + path.basename(s.dir), s.dir, { recursive: true });
      fs.rmSync(staging, { recursive: true, force: true });
      return { message: '已从最近一次备份恢复：' + files[files.length - 1] };
    },
  });
}
module.exports = { registerAll, list, get, createFromModpack, start, stop };
