// 版本清单与版本元数据（含 inherits_from 合并链）
const fs = require('fs');
const path = require('path');
const { dirs } = require('../core/paths');
const sources = require('../core/download/sources');
const { UserError } = require('../core/ipc-gateway');

let manifestCache = null, manifestAt = 0;
const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const MANIFEST_TTL = 10 * 60 * 1000;

async function manifest(force = false) {
  if (!force && manifestCache && Date.now() - manifestAt < MANIFEST_TTL) return manifestCache;
  try {
    const disk = path.join(dirs().meta, 'manifest.json');
    let data;
    try { data = JSON.parse(await sources.fetchText(MANIFEST_URL, { timeout: 12000 })); }
    catch { data = JSON.parse(fs.readFileSync(disk, 'utf8')); } // 断网兜底用缓存
    fs.writeFileSync(disk, JSON.stringify(data));
    manifestCache = data; manifestAt = Date.now();
    return data;
  } catch (e) {
    // 完全无网络且无缓存
    const disk = path.join(dirs().meta, 'manifest.json');
    if (fs.existsSync(disk)) { manifestCache = JSON.parse(fs.readFileSync(disk, 'utf8')); manifestAt = Date.now(); return manifestCache; }
    throw new UserError('获取版本列表失败：暂时连不上版本服务器。请检查网络后重试。');
  }
}

async function listAll() {
  const m = await manifest();
  return m.versions.map((v) => ({ id: v.id, type: v.type, releaseTime: v.releaseTime, url: v.url }));
}

async function recommend() {
  const all = await listAll();
  const latestRelease = all.find((v) => v.type === 'release');
  const ltsForge = all.find((v) => v.id === '1.20.1');
  return [
    { versionId: latestRelease?.id || '1.21', name: '最新正式版 · 原版', desc: '适合想马上体验最新内容的你', loader: 'vanilla', type: 'release' },
    { versionId: ltsForge ? '1.20.1' : '1.20.1', name: '1.20.1 · Forge 热门模组版', desc: '模组生态最成熟的版本', loader: 'forge', type: 'release' },
  ];
}

const metaDisk = (id) => path.join(dirs().meta, 'versions', `${id}.json`);
async function fetchRawMeta(id, url) {
  const disk = metaDisk(id);
  try {
    const j = JSON.parse(await sources.fetchText(url, { timeout: 15000 }));
    fs.mkdirSync(path.dirname(disk), { recursive: true });
    fs.writeFileSync(disk, JSON.stringify(j));
    return j;
  } catch (e) {
    if (fs.existsSync(disk)) return JSON.parse(fs.readFileSync(disk, 'utf8'));
    throw new UserError(`获取版本 ${id} 的信息失败。请检查网络后重试。`);
  }
}

const mergeChainCache = new Map();
async function getMergedMeta(id) {
  if (mergeChainCache.has(id)) return mergeChainCache.get(id);
  const m = await manifest();
  const entry = m.versions.find((v) => v.id === id);
  let raw;
  if (entry) raw = await fetchRawMeta(id, entry.url);
  else {
    // 本地安装的 loader 版本（forge/fabric 等写入 versions 目录）
    const disk = path.join(dirs().versions, id, `${id}.json`);
    if (!fs.existsSync(disk)) throw new UserError(`找不到版本 ${id}。它可能还没有安装。`);
    raw = JSON.parse(fs.readFileSync(disk, 'utf8'));
  }
  let merged;
  if (raw.inheritsFrom) {
    const parent = await getMergedMeta(raw.inheritsFrom);
    merged = {
      id: raw.id,
      mainClass: raw.mainClass || parent.mainClass,
      libraries: [...(parent.libraries || []), ...(raw.libraries || [])],
      arguments: {
        game: raw.arguments?.game || parent.arguments?.game || [],
        jvm: [...(parent.arguments?.jvm || []), ...(raw.arguments?.jvm || [])],
      },
      minecraftArguments: raw.minecraftArguments || parent.minecraftArguments || '',
      assets: raw.assets || parent.assets,
      assetIndex: raw.assetIndex || parent.assetIndex,
      downloads: { ...(parent.downloads || {}), ...(raw.downloads || {}) },
      jar: raw.jar || parent.jar || raw.inheritsFrom,
      javaVersion: raw.javaVersion || parent.javaVersion,
      logging: raw.logging || parent.logging,
      type: raw.type || parent.type,
      releaseTime: raw.releaseTime || parent.releaseTime,
      inheritsFrom: raw.inheritsFrom,
    };
  } else merged = raw;
  mergeChainCache.set(id, merged);
  return merged;
}

// 资产索引 id（如 "21"）
async function assetsIndexId(meta) { return meta.assetIndex?.id || meta.assets || 'legacy'; }

function registerAll(register) {
  register({
    'versions.listAll': async () => {
      const all = await listAll();
      return all.map(({ id, type, releaseTime }) => ({ id, type, releaseTime }));
    },
    'versions.recommend': () => recommend(),
    'versions.getMeta': ({ id }) => getMergedMeta(id),
  });
}

module.exports = { manifest, listAll, recommend, getMergedMeta, assetsIndexId, registerAll };
