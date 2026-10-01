// 第三方皮肤站（Yggdrasil 协议）登录
const { UserError } = require('../core/ipc-gateway');

const PRESETS = {
  littleskin: { label: 'LittleSkin', base: 'https://littleskin.cn/api/yggdrasil' },
  elyby: { label: 'Ely.by', base: 'https://authserver.ely.by/api/authserver' },
};

function normalizeBase(url) {
  url = String(url || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(url)) throw new UserError('认证服务器地址要以 http:// 或 https:// 开头。');
  return url;
}
function sessionBaseOf(base) {
  if (base.includes('/authserver')) return base.replace(/\/authserver$/, '/session');
  if (base.includes('/api/yggdrasil')) return base; // littleskin 风格：session 在同一前缀下
  return base + '/session';
}

async function req(url, { method = 'GET', body, headers = {} } = {}) {
  try {
    const res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* */ }
    return { status: res.status, json, text };
  } catch (e) {
    throw new Error('网络请求失败：' + (e.message || e));
  }
}

async function login({ preset, serverUrl, username, password }) {
  let base, sessionBase, serverName = preset === 'custom' ? '自定义服务器' : PRESETS[preset]?.label;
  if (preset === 'custom') {
    base = normalizeBase(serverUrl);
    sessionBase = sessionBaseOf(base);
  } else {
    const p = PRESETS[preset];
    if (!p) throw new UserError('不支持的皮肤站类型。');
    base = p.base; sessionBase = sessionBaseOf(base);
  }
  const r = await req(base.replace(/\/$/, '') + '/authserver/authenticate', {
    method: 'POST',
    body: { agent: { name: 'Minecraft', version: 1 }, username, password, requestUser: true },
  }).catch((e) => { throw new UserError('连不上皮肤站：' + e.message); });

  if (r.status !== 200 || !r.json?.accessToken) {
    const msg = r.json?.errorMessage || '';
    if (r.status === 404 && !r.json) throw new UserError('这个地址不是有效的 Yggdrasil 认证服务器，请检查地址是否完整（一般以 /api/yggdrasil 结尾）。');
    throw new UserError(msg || '皮肤站登录失败：账号或密码不对，或者服务器暂时不可用。');
  }
  const profile = r.json.selectedProfile || r.json.availableProfiles?.[0];
  if (!profile) throw new UserError('这个皮肤站账号还没有创建游戏角色，请先到皮肤站网站创建角色。');
  // 皮肤信息
  let skinUrl = null, model = 'classic', capeUrl = null;
  try {
    const pr = await req(`${sessionBase}/session/minecraft/profile/${profile.id}?unsigned=false`);
    const tex = (pr.json?.properties || []).find((p) => p.name === 'textures');
    if (tex) {
      const data = JSON.parse(Buffer.from(tex.value, 'base64').toString('utf8'));
      skinUrl = data.textures?.SKIN?.url || null;
      capeUrl = data.textures?.CAPE?.url || null;
      if (data.textures?.SKIN?.metadata?.model) model = data.textures.SKIN.metadata.model;
    }
  } catch { /* 皮肤拿不到不阻塞登录 */ }
  return {
    type: 'yggdrasil',
    name: profile.name,
    uuidHex: profile.id,
    accessToken: r.json.accessToken,
    serverUrl: base, sessionBase, serverName,
    skinUrl, capeUrl, model,
  };
}

async function ensureValid(account) {
  if (account.type !== 'yggdrasil') return account;
  const v = await req(account.serverUrl.replace(/\/$/, '') + '/authserver/validate', {
    method: 'POST', body: { accessToken: account.accessToken },
  }).catch(() => null);
  if (v && v.status === 204) return account;
  // 尝试续期
  const r = await req(account.serverUrl.replace(/\/$/, '') + '/authserver/refresh', {
    method: 'POST', body: { accessToken: account.accessToken, requestUser: true },
  }).catch(() => null);
  if (r && r.status === 200 && r.json?.accessToken) return { ...account, accessToken: r.json.accessToken };
  throw new UserError('皮肤站登录已过期。请在账户管理中重新登录一次。');
}

module.exports = { login, ensureValid, PRESETS };
