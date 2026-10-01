// 游戏文件安装：客户端 jar / 依赖库 / 资源文件 / natives 解压
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const { dirs, ensure } = require('../core/paths');
const manager = require('../core/download/manager');
const sources = require('../core/download/sources');
const { getMergedMeta, assetsIndexId } = require('../meta/versions');
const { broadcast } = require('../core/emitter');
const { UserError } = require('../core/ipc-gateway');

const OS_NAME = process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux';
const ARCH = process.arch; // arm64 | x64

function ruleAllows(lib) {
  if (!lib.rules) return true;
  let allow = false;
  for (const r of lib.rules) {
    let applies = true;
    if (r.os) {
      // Mojang 历史上用 'osx'，新版本用 'macos'
      if (r.os.name && r.os.name !== OS_NAME && !(OS_NAME === 'macos' && r.os.name === 'osx')) applies = false;
      if (applies && r.os.arch && r.os.arch !== ARCH) applies = false;
    }
    if (applies && r.features) {
      applies = Object.entries(r.features).every(([k, v]) => v === false ? false : false) && false; // 无特性启动，忽略带 features 的规则
    }
    if (applies) allow = r.action === 'allow';
  }
  return allow;
}

function libArtifactPath(lib) {
  const d = lib.downloads?.artifact;
  return d ? d.path : null;
}

// 旧版 ARM64 Mac：替换 LWJGL 3.x 为带 arm64 原生库的 3.3.2
const LWJGL_ARM = [
  'org.lwjgl:lwjgl:3.3.2', 'org.lwjgl:lwjgl-glfw:3.3.2', 'org.lwjgl:lwjgl-openal:3.3.2',
  'org.lwjgl:lwjgl-opengl:3.3.2', 'org.lwjgl:lwjgl-stb:3.3.2', 'org.lwjgl:lwjgl-tinyfd:3.3.2',
];
function lwjglArmLibs() {
  const base = 'https://repo1.maven.org/maven2';
  return LWJGL_ARM.map((gav) => {
    const [group, name, version] = gav.split(':');
    const gp = group.replace(/\./g, '/');
    return {
      name: gav,
      downloads: {
        artifact: { path: `${gp}/${name}/${version}/${name}-${version}.jar`, url: `${base}/${gp}/${name}/${version}/${name}-${version}.jar`, size: 0 },
      },
      downloadsArm: {
        path: `${gp}/${name}/${version}/${name}-${version}-natives-macos-arm64.jar`,
        url: `${base}/${gp}/${name}/${version}/${name}-${version}-natives-macos-arm64.jar`,
      },
    };
  });
}
function mcVersionOf(meta) {
  const v = String(meta.id || '');
  if (meta.inheritsFrom) return mcVersionOf({ id: meta.inheritsFrom });
  const m = /^(\d+)\.(\d+)/.exec(v);
  return m ? { major: +m[1], minor: +m[2] } : { major: 999, minor: 0 };
}

// 处理后的库列表（含 arm64 替换与 natives 选择）
function resolveLibraries(meta) {
  let libs = (meta.libraries || []).filter(ruleAllows);
  const isArm = ARCH === 'arm64';
  if (isArm && mcVersionOf(meta).major === 1 && mcVersionOf(meta).minor <= 18 && mcVersionOf(meta).minor >= 13) {
    libs = libs.filter((l) => !/^org\.lwjgl(\.\w+)*:lwjgl/.test(l.name || '') || /^org\.lwjgl:lwjgl:3\.3\./.test(l.name || ''));
    libs = libs.concat(lwjglArmLibs());
  }
  return libs;
}

function progress(taskId, stage, text, received, total) {
  broadcast('bb:install-progress', { taskId, stage, text, received, total });
}

// 确保版本所需全部文件就绪；返回 {clientJar, nativesDir, classpath[]}
async function ensureVersionFiles(meta, { taskId = 'install', needClient = true, needAssets = true, needLibs = true, onProgress = progress } = {}) {
  const versionsDir = dirs().versions;
  ensure(versionsDir);
  const clientJarId = meta.jar || meta.id;
  const nativesDir = path.join(versionsDir, clientJarId, `natives-${ARCH}`);
  const onp = onProgress;

  // 1) Java 由调用方保证
  // 2) 依赖库
  const classpath = [];
  const nativesJars = [];
  if (needLibs) {
    const libs = resolveLibraries(meta);
    let done = 0;
    const dl = [];
    for (const lib of libs) {
      const art = lib.downloads?.artifact;
      if (art) {
        const dest = path.join(dirs().libraries, art.path);
        classpath.push(dest);
        if (!fs.existsSync(dest) || (art.size && fs.statSync(dest).size !== art.size)) {
          dl.push({ name: path.basename(art.path), type: '游戏', url: art.url, dest, sha1: art.sha1 || null, size: art.size || 0 });
        }
      } else if (lib.url && lib.name) {
        // 无 downloads 元数据的库（部分 loader）：按 maven 坐标拼路径
        const [groupPath, rest] = mavenPathOf(lib.name);
        const dest = path.join(dirs().libraries, groupPath, rest);
        classpath.push(dest);
        if (!fs.existsSync(dest)) {
          dl.push({ name: rest, type: '游戏', url: lib.url, dest });
        }
      }
      // natives
      const cls = lib.downloads?.classifiers;
      if (cls) {
        const key = ARCH === 'arm64' && cls['natives-macos-arm64'] ? 'natives-macos-arm64' : cls['natives-macos'] ? 'natives-macos' : null;
        if (key) {
          const c = cls[key];
          const dest = path.join(dirs().libraries, c.path);
          nativesJars.push(dest);
          if (!fs.existsSync(dest) || (c.size && fs.statSync(dest).size !== c.size)) {
            dl.push({ name: path.basename(c.path), type: '游戏', url: c.url, dest, sha1: c.sha1 || null, size: c.size || 0 });
          }
        }
      }
    }
    // arm64 替换库的 natives
    for (const lib of libs) {
      if (lib.downloadsArm) {
        const dest = path.join(dirs().libraries, lib.downloadsArm.path);
        nativesJars.push(dest);
        if (!fs.existsSync(dest)) dl.push({ name: path.basename(lib.downloadsArm.path), type: '游戏', url: lib.downloadsArm.url, dest });
      }
    }
    onp(taskId, 'libs', `下载游戏依赖库 0/${dl.length}`, 0, dl.length);
    if (dl.length) await manager.addBulk(dl);
    onp(taskId, 'libs', `游戏依赖库就绪`, dl.length, dl.length);
  }

  // 3) 客户端 jar
  const clientJar = path.join(versionsDir, clientJarId, `${clientJarId}.jar`);
  if (needClient) {
    const cd = meta.downloads?.client;
    if (cd && cd.url) {
      onp(taskId, 'jar', '下载游戏本体…', 0, cd.size);
      if (!fs.existsSync(clientJar) || (cd.size && fs.statSync(clientJar).size !== cd.size)) {
        await manager.download({ name: `游戏本体 ${meta.id}`, type: '游戏', url: cd.url, dest: clientJar, sha1: cd.sha1 || null, size: cd.size || 0 });
      }
      onp(taskId, 'jar', '游戏本体就绪', 1, 1);
    } else if (!fs.existsSync(clientJar) && needClient) {
      // 某些 loader 版本没有 downloads 元数据：回退到父版本
      if (meta.inheritsFrom) {
        const parent = await getMergedMeta(meta.inheritsFrom);
        const pd = parent.downloads?.client;
        if (pd && pd.url) {
          await manager.download({ name: `游戏本体 ${parent.id}`, type: '游戏', url: pd.url, dest: clientJar, sha1: pd.sha1 || null, size: pd.size || 0 });
        }
      }
    }
  }
  classpath.push(clientJar);

  // 4) 资源文件
  let assetIndexName = null;
  if (needAssets && meta.assetIndex) {
    assetIndexName = await assetsIndexId(meta);
    const idxPath = path.join(dirs().assetsIndexes, `${assetIndexName}.json`);
    if (!fs.existsSync(idxPath)) {
      onp(taskId, 'assets', '下载资源索引…', 0, meta.assetIndex.size);
      await manager.download({ name: `资源索引 ${assetIndexName}`, type: '游戏', url: meta.assetIndex.url, dest: idxPath, sha1: meta.assetIndex.sha1 });
    }
    const index = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
    const objects = Object.values(index.objects || {});
    const missing = [];
    for (const o of objects) {
      const dest = path.join(dirs().objects, o.hash.slice(0, 2), o.hash);
      if (!fs.existsSync(dest) || fs.statSync(dest).size !== o.size) {
        missing.push({ name: o.hash.slice(0, 8) + '…', type: '资源文件', url: `https://resources.download.minecraft.net/${o.hash.slice(0, 2)}/${o.hash}`, dest, sha1: o.hash, size: o.size });
      }
    }
    if (missing.length) {
      onp(taskId, 'assets', `下载资源文件 ${missing.length} 个（首次较慢）…`, 0, missing.length);
      const before = Date.now();
      await manager.addBulk(missing);
      onp(taskId, 'assets', '资源文件就绪', objects.length, objects.length);
    } else {
      onp(taskId, 'assets', '资源文件就绪', objects.length, objects.length);
    }
  }

  // 5) 解压 natives
  if (nativesJars.length) {
    const marker = path.join(nativesDir, '.ok');
    const sig = crypto.createHash('sha1').update(nativesJars.join('|')).digest('hex').slice(0, 12);
    if (!fs.existsSync(marker) || fs.readFileSync(marker, 'utf8') !== sig) {
      fs.rmSync(nativesDir, { recursive: true, force: true });
      fs.mkdirSync(nativesDir, { recursive: true });
      for (const jar of nativesJars) {
        if (!fs.existsSync(jar)) continue;
        try {
          const zip = new AdmZip(jar);
          for (const e of zip.getEntries()) {
            if (e.isDirectory) continue;
            if (/\.(dylib|jnilib|so)$/.test(e.entryName) || /^META-INF\/\.dylib/.test(e.entryName)) {
              zip.extractEntryTo(e, nativesDir, false, true);
            }
          }
        } catch (e) { throw new UserError('解压游戏原生库失败：' + e.message); }
      }
      fs.writeFileSync(marker, sig);
    }
  }

  // 6) 日志配置（log4j 安全 + 着色文件）
  let logConfigPath = null;
  if (meta.logging?.client?.file) {
    const lf = meta.logging.client.file;
    const dest = path.join(dirs().assets, 'log_configs', lf.id);
    if (!fs.existsSync(dest)) {
      try { await manager.download({ name: lf.id, type: '游戏', url: lf.url, dest, sha1: lf.sha1, quiet: true }); } catch { /* 非必需 */ }
    }
    if (fs.existsSync(dest)) logConfigPath = dest;
  }

  return { clientJar, nativesDir, classpath, assetIndexName, logConfigPath };
}

function mavenPathOf(name) {
  const [gav, cls] = name.split('@');
  const parts = gav.split(':');
  const gp = parts[0].replace(/\./g, '/');
  const file = `${parts[1]}-${parts[2]}${cls ? '-' + cls : ''}.jar`;
  return [`${gp}/${parts[1]}/${parts[2]}`, file];
}

module.exports = { ensureVersionFiles, resolveLibraries, ruleAllows, OS_NAME, ARCH, mcVersionOf };
