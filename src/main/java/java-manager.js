// Java 管理：系统检测 + Adoptium 自动下载 + 版本映射
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const config = require('../core/config');
const { dirs } = require('../core/paths');
const manager = require('../core/download/manager');
const sources = require('../core/download/sources');
const { UserError } = require('../core/ipc-gateway');
const { broadcast, toast } = require('../core/emitter');

const SCAN_PATHS = [
  '/Library/Java/JavaVirtualMachines',
  path.join(os.homedir(), 'Library/Java/JavaVirtualMachines'),
  '/opt/homebrew/opt',
  '/usr/local/opt',
];

function parseVersion(output) {
  const m = /version "(\d+)(?:\.(\d+))?(?:\.(\d+))?(_\d+)?/.exec(output);
  if (!m) return null;
  if (m[1] === '1') return parseInt(m[2], 10); // 1.8.0_402 → 8
  return parseInt(m[1], 10);
}
function javaVersionOf(javaExe) {
  return new Promise((resolve) => {
    execFile(javaExe, ['-version'], { timeout: 15000 }, (err, _o, stderr) => {
      if (err && !stderr) return resolve(null);
      resolve(parseVersion(stderr || '') || null);
    });
  });
}
async function detectSystem() {
  const found = [];
  const push = async (javaExe, vendor) => {
    if (!fs.existsSync(javaExe)) return;
    const major = await javaVersionOf(javaExe);
    if (major == null) return;
    found.push({ major, version: major, path: path.dirname(path.dirname(javaExe)), vendor, source: 'system' });
  };
  for (const base of SCAN_PATHS) {
    if (!fs.existsSync(base)) continue;
    for (const name of fs.readdirSync(base)) {
      const p = path.join(base, name);
      const candidates = [
        path.join(p, 'Contents/Home/bin/java'),
        path.join(p, 'bin/java'),
        path.join(p, 'libexec/openjdk.jdk/Contents/Home/bin/java'),
      ];
      for (const c of candidates) await push(c, name.includes('temurin') || name.includes('adoptium') ? 'Temurin' : '系统');
    }
  }
  await push('/usr/bin/java', '系统');
  // /usr/bin/java 是占位符时 -version 会失败，自然被过滤
  return found;
}

let cachedList = null, cachedAt = 0;
async function list() {
  if (cachedList && Date.now() - cachedAt < 30000) return cachedList;
  const sys = await detectSystem();
  const downloaded = [];
  const javaRoot = dirs().java;
  if (fs.existsSync(javaRoot)) {
    for (const name of fs.readdirSync(javaRoot)) {
      const m = /^java-(\d+)-/.exec(name);
      if (!m) continue;
      // 定位 Home
      const home = findHome(path.join(javaRoot, name));
      const exe = home ? path.join(home, 'bin/java') : null;
      if (!exe || !fs.existsSync(exe)) continue;
      const major = await javaVersionOf(exe);
      downloaded.push({ major: major || parseInt(m[1], 10), version: major || parseInt(m[1], 10), path: home, vendor: 'Temurin', source: 'downloaded' });
    }
  }
  // 同 major 去重：优先下载的（可控），否则系统的
  const byMajor = new Map();
  for (const j of [...sys, ...downloaded]) {
    const prev = byMajor.get(j.major);
    if (!prev || (prev.source === 'system' && j.source === 'downloaded')) byMajor.set(j.major, j);
  }
  cachedList = [...byMajor.values()].sort((a, b) => a.major - b.major);
  cachedAt = Date.now();
  return cachedList;
}
function findHome(root) {
  if (fs.existsSync(path.join(root, 'bin/java'))) return root;
  if (fs.existsSync(path.join(root, 'Contents/Home/bin/java'))) return path.join(root, 'Contents/Home');
  // 深度最多 3 层找 Contents/Home
  try {
    for (const a of fs.readdirSync(root)) {
      const aa = path.join(root, a);
      if (fs.existsSync(path.join(aa, 'Contents/Home/bin/java'))) return path.join(aa, 'Contents/Home');
      for (const b of fs.readdirSync(aa)) {
        const bb = path.join(aa, b);
        if (fs.existsSync(path.join(bb, 'Contents/Home/bin/java'))) return path.join(bb, 'Contents/Home');
      }
    }
  } catch { /* */ }
  return null;
}

function mapMajor(mcVersionOrMeta) {
  if (mcVersionOrMeta && typeof mcVersionOrMeta === 'object' && mcVersionOrMeta.javaVersion?.majorVersion) {
    return { major: mcVersionOrMeta.javaVersion.majorVersion, reason: '根据版本信息自动匹配' };
  }
  const v = String(mcVersionOrMeta || '');
  const parse = () => {
    const m = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(v);
    return m ? [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3] || '0', 10)] : null;
  };
  const p = parse();
  if (!p) return { major: 21, reason: '未知版本，默认使用 Java 21' };
  const [a, b, c] = p;
  const n = a * 10000 + b * 100 + c;
  if (n >= 12005 || v.startsWith('1.21')) return { major: 21, reason: '1.20.5 及以上需要 Java 21' };
  if (n >= 11800) return { major: 17, reason: '1.18 – 1.20.4 需要 Java 17' };
  if (n >= 11700) return { major: 17, reason: '1.17 需要 Java 16/17' };
  if (n >= 11300) return { major: 8, reason: '1.13 – 1.16.5 使用 Java 8' };
  return { major: 8, reason: '1.12 及更早版本使用 Java 8' };
}

async function ensure(major, { silent = false } = {}) {
  const all = await list();
  const hit = all.find((j) => j.major === major);
  if (hit) return hit;
  return download(major, { silent });
}

async function download(major, { silent = false } = {}) {
  // 磁盘空间检查
  try {
    const st = fs.statfsSync(dirs().root);
    const freeGB = (st.bsize * st.bavail) / 1e9;
    if (freeGB < 0.35) throw new UserError('需要大约 200MB 空间，当前磁盘剩余不足。请清理一些空间后再试。');
  } catch (e) { if (e.userMessage) throw e; }

  const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
  const api = `https://api.adoptium.net/v3/assets/latest/${major}/hotspot?architecture=${arch}&image_type=jdk&os=mac&vendor=eclipse`;
  let assets;
  try { assets = await sources.fetchJson(api, { timeout: 20000 }); }
  catch { throw new UserError(`暂时连不上 Java 下载服务器（Adoptium）。请检查网络后重试。`); }
  const bin = Array.isArray(assets) && assets[0]?.binary;
  const link = bin?.package?.link;
  if (!link) throw new UserError(`没找到适配这台电脑的 Java ${major} 安装包。`);
  const file = bin.package.name || `temurin${major}.tar.gz`;

  if (!silent) toast(`开始下载 Java ${major}，大约 200MB，请稍候…`, 'info', 4000);
  const destTar = path.join(dirs().java, file);
  await manager.download({
    name: `Java ${major}（${bin.package.name || file}）`,
    type: 'Java',
    url: link,
    dest: destTar,
    sha256: bin.package.checksum || null, // Adoptium 提供 SHA256
    size: bin.package.size || 0,
  });
  // 解压
  const extractDir = path.join(dirs().java, `java-${major}-tmp-${Date.now()}`);
  fs.mkdirSync(extractDir, { recursive: true });
  await new Promise((resolve, reject) => {
    execFile('tar', ['-xzf', destTar, '-C', extractDir], { timeout: 300000 }, (err) => err ? reject(new UserError('Java 安装包解压失败。可以删除后重新下载。')) : resolve());
  });
  const home = findHome(extractDir);
  if (!home) throw new UserError('Java 安装包内容不符合预期。请删除后重新下载。');
  // bin 可执行权限
  try {
    const binDir = path.join(home, 'bin');
    for (const f of fs.readdirSync(binDir)) fs.chmodSync(path.join(binDir, f), 0o755);
  } catch { /* */ }
  fs.renameSync(extractDir, path.join(dirs().java, `java-${major}-${path.basename(home)}`));
  fs.rmSync(destTar, { force: true });
  cachedList = null;
  if (!silent) toast(`Java ${major} 安装完成！`, 'ok');
  broadcast('bb:java-changed', {});
  return { major, version: major, path: home, vendor: 'Temurin', source: 'downloaded' };
}

async function remove(major) {
  const javaRoot = dirs().java;
  for (const name of fs.readdirSync(javaRoot)) {
    if (name.startsWith(`java-${major}-`)) fs.rmSync(path.join(javaRoot, name), { recursive: true, force: true });
  }
  cachedList = null;
  return true;
}

function registerAll(register) {
  register({
    'java.list': () => list(),
    'java.ensure': ({ major }) => ensure(major),
    'java.download': ({ major }) => download(major),
    'java.remove': ({ major }) => remove(major),
    'java.map': ({ mcVersion }) => mapMajor(mcVersion),
  });
}

module.exports = { list, ensure, download, remove, mapMajor, registerAll };
