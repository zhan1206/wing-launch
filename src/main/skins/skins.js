// 皮肤库：导入（含校验/裁剪）/ 在线搜索 / 应用到账户 / 导出
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { dirs } = require('../core/paths');
const accounts = require('../accounts/accounts');
const { UserError } = require('../core/ipc-gateway');
const { toast } = require('../core/emitter');
const trash = require('../core/trash');

const INDEX = () => path.join(dirs().skins, 'skins.json');
function loadIndex() {
  try { return JSON.parse(fs.readFileSync(INDEX(), 'utf8')); } catch { return []; }
}
function saveIndex(arr) { fs.writeFileSync(INDEX(), JSON.stringify(arr, null, 2)); }

function list() {
  const arr = loadIndex();
  return arr.map((s) => {
    const file = path.join(dirs().skins, s.id + '.png');
    let thumb = null;
    try {
      if (fs.existsSync(file)) thumb = 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
    } catch { /* */ }
    return { ...s, thumbDataUrl: thumb, exists: fs.existsSync(file) };
  });
}

// 校验 PNG 尺寸
async function inspectImage(p) {
  const Jimp = (await import('jimp')).Jimp;
  const img = await Jimp.read(p);
  return { img, w: img.bitmap.width, h: img.bitmap.height };
}

async function importFile(p) {
  if (!/\.(png|jpg|jpeg|webp)$/i.test(p)) throw new UserError('请选择一张 PNG / JPG / WebP 图片。');
  let info;
  try { info = await inspectImage(p); }
  catch { throw new UserError('这张图片无法读取，可能已损坏。换一张试试吧。'); }
  const { w, h } = info;
  if ((w === 64 && h === 64) || (w === 64 && h === 32)) {
    return saveSkin(p, path.basename(p, path.extname(p)), null);
  }
  return {
    needCrop: true, width: w, height: h,
    previewDataUrl: 'bbimg://' + encodeURIComponent(p),
    message: `这张图片尺寸是 ${w}×${h}，MC 皮肤需要 64×64 或 64×32。要尝试自动裁剪吗？`,
  };
}

async function importCropped({ path: p, mode = 'center', name = null }) {
  const Jimp = (await import('jimp')).Jimp;
  let img;
  try { img = await Jimp.read(p); } catch { throw new UserError('这张图片无法读取，可能已损坏。'); }
  const { width: w, height: h } = img.bitmap;
  let out;
  if (mode === 'stretch') {
    out = img.clone().resize({ w: 64, h: 64 });
  } else {
    // 居中裁剪 1:1
    const side = Math.min(w, h);
    const x = Math.floor((w - side) / 2), y = Math.floor((h - side) / 2);
    out = img.clone().crop({ x, y, w: side, h: side }).resize({ w: 64, h: 64 });
  }
  const tmp = path.join(dirs().skins, `.tmp-${Date.now()}.png`);
  await out.write(tmp);
  const r = saveSkin(tmp, name || path.basename(p, path.extname(p)) + '（裁剪）', null, true);
  fs.rmSync(tmp, { force: true });
  return r;
}

async function saveSkin(srcPng, name, source, isTemp = false) {
  const id = 'skin-' + crypto.randomBytes(4).toString('hex');
  const dest = path.join(dirs().skins, id + '.png');
  // 统一转为 64x64 PNG（jimp 重编码，去除非 png 问题）
  const Jimp = (await import('jimp')).Jimp;
  const img = await Jimp.read(srcPng);
  if (img.bitmap.width !== 64) img.resize({ w: 64 });
  if (img.bitmap.height === 32) {
    // 旧版 64x32 → 镜像补全为 64x64
    const conv = oldSkinToSlim(img);
    await conv.write(dest);
  } else {
    await img.write(dest);
  }
  const arr = loadIndex();
  // 检测模型（64x64 右臂区域是否有像素）
  const model = await detectModel(dest);
  arr.push({ id, name: (name || '导入的皮肤').slice(0, 40), source: source || 'local', model, addedAt: Date.now() });
  saveIndex(arr);
  toast('皮肤已加入皮肤库！', 'ok');
  return { id };
}

async function detectModel(file) {
  try {
    const Jimp = (await import('jimp')).Jimp;
    const img = await Jimp.read(file);
    // 右臂区域 (40,16)-(55,32)：slim 皮肤此处透明
    let opaque = 0;
    for (let x = 46; x < 50; x++) for (let y = 20; y < 28; y++) {
      const c = Jimp.intToRGBA(img.getPixelColor(x, y));
      if (c.a > 0) opaque++;
    }
    return opaque > 30 ? 'classic' : 'slim';
  } catch { return 'classic'; }
}

function oldSkinToSlim(img) {
  const Jimp = img.constructor;
  const out = new Jimp({ width: 64, height: 64 });
  out.composite(img.clone(), 0, 0);
  // 复制腿部区域到 64x64 布局（旧→新：腿在 (0,16,16,16)→(16,48)；身体 (16,16)→(16,32)；手臂 (40,16)→(40,32)）
  const mirror = (sx, sy, w, h, dx, dy) => out.composite(img.clone().crop({ x: sx, y: sy, w, h }).flip({ horizontal: true }), dx + w, dy);
  try { out.composite(img.clone().crop({ x: 0, y: 16, w: 16, h: 16 }), 16, 48); } catch { /* */ }
  try { out.composite(img.clone().crop({ x: 0, y: 32, w: 56, h: 16 }), 0, 48); } catch { /* */ }
  return out;
}

async function search({ site, query }) {
  query = String(query || '').trim();
  if (!query) throw new UserError('输入想找的玩家昵称再搜索。');
  if (site === 'littleskin') {
    // LittleSkin：玩家搜索
    try {
      const res = await fetch(`https://littleskin.cn/api/search?keyword=${encodeURIComponent(query)}&skin=true`, { signal: AbortSignal.timeout(10000), headers: { 'user-agent': 'BlockBox/1.0' } });
      if (res.ok) {
        const j = await res.json();
        const items = (j.data?.data || j.data || []);
        const hits = (Array.isArray(items) ? items : []).filter((x) => x?.name).map((x) => ({ id: JSON.stringify({ site, name: x.name }), name: x.name, thumbUrl: x.avatar || `https://littleskin.cn/avatar/${x.name}` }));
        if (hits.length) return hits;
      }
    } catch { /* 降级精确查询 */ }
    // 精确玩家查询
    const res2 = await fetch(`https://littleskin.cn/api/player/${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(10000), headers: { 'user-agent': 'BlockBox/1.0' } }).catch(() => null);
    if (res2?.ok) {
      const j2 = await res2.json().catch(() => null);
      if (j2?.name) return [{ id: JSON.stringify({ site, name: j2.name }), name: j2.name, thumbUrl: j2.avatar || `https://littleskin.cn/avatar/${j2.name}` }];
    }
    throw new UserError('没有找到叫“' + query + '”的皮肤。试试完整昵称。');
  }
  if (site === 'elyby') {
    try {
      const res = await fetch(`http://skinsystem.ely.by/skins?q=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(10000), headers: { 'user-agent': 'BlockBox/1.0' } });
      const j = await res.json();
      const hits = (j || []).map((x) => ({ id: JSON.stringify({ site, name: x.nickname || x.name }), name: x.nickname || x.name, thumbUrl: `https://skinmanager.ely.by/api/skins/head/${x.nickname || x.name}` }));
      if (!hits.length) throw new Error('空');
      return hits;
    } catch {
      throw new UserError('没有找到叫“' + query + '”的皮肤。试试完整昵称。');
    }
  }
  throw new UserError('暂不支持这个皮肤站。');
}

async function fetchTextureFromProfile(site, name) {
  if (site === 'littleskin') {
    const res = await fetch(`https://littleskin.cn/api/player/${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(10000), headers: { 'user-agent': 'BlockBox/1.0' } });
    if (!res.ok) throw new UserError('没能从 LittleSkin 获取这个玩家的皮肤。');
    const j = await res.json();
    if (!j?.profile?.id) throw new UserError('没能从 LittleSkin 获取这个玩家的皮肤。');
    const pr = await fetch(`https://littleskin.cn/api/yggdrasil/sessionserver/session/minecraft/profile/${j.profile.id}`, { signal: AbortSignal.timeout(10000), headers: { 'user-agent': 'BlockBox/1.0' } });
    const pj = await pr.json();
    const tex = (pj.properties || []).find((x) => x.name === 'textures');
    if (!tex) throw new UserError('这个玩家没有设置皮肤。');
    const data = JSON.parse(Buffer.from(tex.value, 'base64').toString('utf8'));
    return data.textures?.SKIN?.url || null;
  }
  // ely.by
  const res = await fetch(`https://authserver.ely.by/api/session/session/minecraft/profile/${encodeURIComponent(name)}?unsigned=false`, { signal: AbortSignal.timeout(10000) }).catch(() => null);
  if (res?.ok) {
    const pj = await res.json().catch(() => null);
    const tex = (pj?.properties || []).find((x) => x.name === 'textures');
    if (tex) {
      const data = JSON.parse(Buffer.from(tex.value, 'base64').toString('utf8'));
      return data.textures?.SKIN?.url || null;
    }
  }
  return `https://skinserver.ely.by/skins/${encodeURIComponent(name)}.png`;
}

async function downloadOnline({ id, name }) {
  let info;
  try { info = JSON.parse(id); } catch { throw new UserError('皮肤信息无效。'); }
  const url = await fetchTextureFromProfile(info.site, info.name);
  if (!url) throw new UserError('这个玩家没有设置皮肤。');
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new UserError('皮肤图片下载失败，稍后再试。');
  const buf = Buffer.from(await res.arrayBuffer());
  const tmp = path.join(dirs().skins, `.tmp-${Date.now()}.png`);
  fs.writeFileSync(tmp, buf);
  try {
    const r = await saveSkin(tmp, name || info.name, info.site === 'littleskin' ? 'littleskin' : 'elyby');
    fs.rmSync(tmp, { force: true });
    return r;
  } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
}

async function applyToAccount({ skinId, accountId, model = null }) {
  const acc = accounts.getAccount(accountId);
  if (!acc) throw new UserError('账户不存在，可能已被删除。');
  const skinFile = path.join(dirs().skins, skinId + '.png');
  if (!fs.existsSync(skinFile)) throw new UserError('皮肤文件不存在，可能已被删除。');
  // 记录绑定
  const arr = loadIndex();
  const skinMeta = arr.find((s) => s.id === skinId);
  const modelFinal = model || skinMeta?.model || 'classic';

  if (acc.type === 'offline') {
    // 离线账户：本地皮肤（启动时经本地服务注入）
    acc.skinId = skinId; acc.model = modelFinal;
    accounts.upsert(acc);
    toast('已为离线账户应用皮肤。启动游戏时会自动带上（需要几秒加载）。', 'ok', 5000);
    return { ok: true, where: 'local' };
  }
  if (acc.type === 'yggdrasil') {
    // Yggdrasil：上传到皮肤站（authlib-injector 规范）
    const base = acc.serverUrl.replace(/\/$/, '');
    const buf = fs.readFileSync(skinFile);
    const res = await fetch(`${base}/api/user/profile/${acc.uuidHex}/skin?model=${modelFinal === 'slim' ? 'slim' : ''}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${acc.accessToken}`, 'content-type': 'image/png' },
      body: buf,
      signal: AbortSignal.timeout(15000),
    }).catch(() => null);
    if (res?.ok || res?.status === 204) {
      acc.skinId = skinId; acc.model = modelFinal;
      accounts.upsert(acc);
      toast('皮肤已上传到皮肤站，游戏里很快生效！', 'ok');
      return { ok: true, where: 'yggdrasil' };
    }
    throw new UserError('皮肤上传被皮肤站拒绝了（可能是登录过期，请重新登录账户）。');
  }
  // 微软正版：Minecraft 服务 API
  const res = await fetch('https://api.minecraftservices.com/minecraft/profile/skins', {
    method: 'POST',
    headers: { authorization: `Bearer ${acc.accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ variant: modelFinal === 'slim' ? 'slim' : 'classic', file: 'data:image/png;base64,' + buf64(skinFile) }),
    signal: AbortSignal.timeout(20000),
  }).catch(() => null);
  if (res?.status === 200) {
    acc.skinId = skinId; acc.model = modelFinal;
    accounts.upsert(acc);
    toast('皮肤已上传到微软官方服务，重新进入游戏生效！', 'ok');
    return { ok: true, where: 'microsoft' };
  }
  throw new UserError('官方皮肤上传失败（可能登录过期或接口暂时不可用），请重新登录后再试。');
}
function buf64(f) { return fs.readFileSync(f).toString('base64'); }

async function exportSkin({ skinId, destPath }) {
  const file = path.join(dirs().skins, skinId + '.png');
  if (!fs.existsSync(file)) throw new UserError('皮肤文件不存在。');
  const out = destPath.endsWith('.png') ? destPath : destPath + '.png';
  fs.copyFileSync(file, out);
  return { path: out };
}
function removeSkin({ skinId }) {
  const arr = loadIndex().filter((s) => s.id !== skinId);
  saveIndex(arr);
  const file = path.join(dirs().skins, skinId + '.png');
  if (fs.existsSync(file)) trash.deleteToTrash(file, '皮肤');
  return true;
}

function registerAll(register) {
  register({
    'skins.list': () => list(),
    'skins.importFile': (pp) => importFile(typeof pp === 'string' ? { p: pp } : pp),
    'skins.importCropped': (p) => importCropped(p),
    'skins.search': (p) => search(p),
    'skins.downloadOnline': (p) => downloadOnline(p),
    'skins.applyToAccount': (p) => applyToAccount(p),
    'skins.export': (p) => exportSkin(p),
    'skins.remove': (pp) => removeSkin(typeof pp === 'string' ? { skinId: pp } : pp),
    'skins.get': ({ skinId }) => {
      const file = path.join(dirs().skins, skinId + '.png');
      if (!fs.existsSync(file)) throw new UserError('皮肤文件不存在。');
      return { dataUrl: 'data:image/png;base64,' + buf64(file) };
    },
  });
}
module.exports = { registerAll };
