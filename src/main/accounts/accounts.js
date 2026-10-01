// 账户管理：离线 / 微软 / Yggdrasil 统一存取与路由
const crypto = require('crypto');
const config = require('../core/config');
const { dirs } = require('../core/paths');
const { readJson, writeJson } = config;
const { UserError } = require('../core/ipc-gateway');
const { broadcast, toast } = require('../core/emitter');
const ms = require('./microsoft');
const secrets = require('../core/secrets');
const ygg = require('./yggdrasil');
const fs = require('fs');
const path = require('path');

const FILE = () => dirs().accountsFile;
let migrated = false;
function migrateSecrets() {
  if (migrated) return;
  migrated = true;
  const d = readJson(FILE(), { accounts: [], currentId: null });
  let changed = false;
  for (const acc of d.accounts || []) {
    for (const field of ['accessToken', 'refreshToken']) {
      const v = acc[field];
      if (v && v !== '0' && v.length > 8) {
        secrets.set('acc:' + acc.id + ':' + field, v);
        delete acc[field];
        changed = true;
      }
    }
  }
  if (changed) writeJson(FILE(), d);
}
function hydrate(acc) {
  if (!acc) return acc;
  const token = secrets.get('acc:' + acc.id + ':accessToken');
  const refresh = secrets.get('acc:' + acc.id + ':refreshToken');
  return { ...acc, ...(token ? { accessToken: token } : {}), ...(refresh ? { refreshToken: refresh } : {}) };
}
function load() { migrateSecrets(); return readJson(FILE(), { accounts: [], currentId: null }); }
function save(data) { writeJson(FILE(), data); broadcast('bb:accounts-changed', list()); }
function list() {
  const d = load();
  return d.accounts.map((a) => ({
    id: a.id, type: a.type, name: a.name, displayName: a.displayName || a.name,
    uuidHex: a.uuidHex, serverName: a.serverName || (a.type === 'offline' ? '离线' : a.type === 'microsoft' ? '微软正版' : ''),
    skinUrl: a.skinUrl, capeUrl: a.capeUrl, model: a.model || 'classic', skinId: a.skinId || null,
    headUrl: a.headDataUrl || null,
  }));
}
function current() {
  const d = load();
  return d.accounts.find((a) => a.id === d.currentId) || d.accounts[0] || null;
}
function getAccount(id) {
  const d = load();
  return d.accounts.find((a) => a.id === id) || null;
}
function upsert(account) {
  const d = load();
  const { accessToken, refreshToken, ...safe } = account;
  const existing = d.accounts.find((a) => a.type === account.type && a.uuidHex === account.uuidHex);
  let id;
  if (existing) { Object.assign(existing, safe, { displayName: existing.displayName }); id = existing.id; }
  else { id = 'acc-' + crypto.randomBytes(4).toString('hex'); d.accounts.push({ id, displayName: account.name, ...safe }); }
  if (accessToken && accessToken !== '0') secrets.set('acc:' + id + ':accessToken', accessToken);
  if (refreshToken) secrets.set('acc:' + id + ':refreshToken', refreshToken);
  if (!d.currentId) d.currentId = id;
  save(d);
  return id;
}

// 离线 UUID：v3 md5(OfflinePlayer:name)
function offlineUuid(name) {
  const md5 = crypto.createHash('md5').update('OfflinePlayer:' + name, 'utf8').digest();
  md5[6] = (md5[6] & 0x0f) | 0x30;
  md5[8] = (md5[8] & 0x3f) | 0x80;
  const hex = md5.toString('hex');
  return hex;
}
const dash = (hex) => hex.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');

// 头像：从皮肤裁 8x8 → dataURL
async function headDataUrl(skinUrlOrPath) {
  try {
    const Jimp = (await import('jimp')).Jimp;
    let img;
    if (/^https?:/.test(skinUrlOrPath)) {
      const res = await fetch(skinUrlOrPath, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return null;
      img = await Jimp.read(Buffer.from(await res.arrayBuffer()));
    } else if (fs.existsSync(skinUrlOrPath)) {
      img = await Jimp.read(skinUrlOrPath);
    } else return null;
    const head = img.clone().crop({ x: 8, y: 8, w: 8, h: 8 });
    head.resize({ w: 32, h: 32, mode: 'nearestNeighbour' });
    return await head.getBase64('image/png');
  } catch { return null; }
}
async function attachHead(account) {
  const src = account.skinUrl || (account.skinId ? path.join(dirs().skins, account.skinId + '.png') : null);
  if (src) account.headDataUrl = await headDataUrl(src);
  return account;
}

async function validateForLaunch(accountId) {
  let acc = hydrate(getAccount(accountId) || current());
  if (!acc) throw new UserError('还没有可用的账户。请先添加一个账户。');
  if (acc.type === 'microsoft') acc = await ms.refresh(acc);
  else if (acc.type === 'yggdrasil') acc = await ygg.ensureValid(acc);
  if (acc.expiresAt) { upsert(acc); }
  return acc;
}

function registerAll(register) {
  register({
    'accounts.list': () => list(),
    'accounts.currentId': () => load().currentId,
    'accounts.setCurrent': (p) => { const id = typeof p === 'string' ? p : p?.id;
      const d = load();
      if (!d.accounts.find((a) => a.id === id)) throw new UserError('账户不存在，可能已被删除。');
      d.currentId = id; save(d); return true;
    },
    'accounts.addOffline': async (p) => { let name = typeof p === 'string' ? p : p?.name;
      name = String(name || '').trim();
      if (!/^[\w\u4e00-\u9fa5]{2,16}$/.test(name)) throw new UserError('游戏昵称需要 2-16 个字符，可以是中文、字母、数字和下划线。');
      const account = await attachHead({
        type: 'offline', name, uuidHex: offlineUuid(name), accessToken: '0',
        skinUrl: null, capeUrl: null,
      });
      const id = upsert(account);
      toast(`离线账户“${name}”添加成功！`, 'ok');
      return { id, ...list().find((a) => a.id === id) };
    },
    'accounts.msStart': () => ms.msStart(),
    'accounts.msPoll': async (p) => { const deviceId = typeof p === 'string' ? p : p?.deviceId;
      const r = await ms.msPoll(deviceId);
      if (r.status === 'done') {
        await attachHead(r.account);
        const id = upsert(r.account);
        toast(`正版账户“${r.account.name}”添加成功！`, 'ok');
        return { status: 'done', account: { id, ...list().find((a) => a.id === id) } };
      }
      return r;
    },
    'accounts.addYggdrasil': async (payload) => {
      const account = await ygg.login(payload);
      await attachHead(account);
      const id = upsert(account);
      toast(`账户“${account.name}”添加成功！`, 'ok');
      return { id, ...list().find((a) => a.id === id) };
    },
    'accounts.remove': (p) => { const id = typeof p === 'string' ? p : p?.id;
      const d = load();
      const idx = d.accounts.findIndex((a) => a.id === id);
      if (idx < 0) throw new UserError('账户不存在，可能已被删除。');
      const name = d.accounts[idx].displayName || d.accounts[idx].name;
      d.accounts.splice(idx, 1);
      if (d.currentId === id) d.currentId = d.accounts[0]?.id || null;
      save(d);
      toast(`已删除账户“${name}”。重新添加需要再次登录。`, 'info');
      return true;
    },
    'accounts.setDisplayName': (p) => { const [id, name] = Array.isArray(p?.__pos) ? p.__pos : [p?.id, p?.name];
      const d = load();
      const a = d.accounts.find((x) => x.id === id);
      if (!a) throw new UserError('账户不存在。');
      a.displayName = String(name || '').trim().slice(0, 24) || a.name;
      save(d);
      return true;
    },
  });
}

module.exports = { registerAll, list, current, getAccount, validateForLaunch, upsert, offlineUuid, dash, load, save, hydrate };
