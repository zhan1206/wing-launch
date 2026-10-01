// 微软正版登录：设备码流程 → XBL/XSTS → Minecraft 服务
const https = require('https');
const { UserError } = require('../core/ipc-gateway');
const config = require('../core/config');

// 公共应用 ID（PolyMC 开源项目注册，支持设备码登录），可在设置中覆盖
const DEFAULT_CLIENT_ID = '6b329578-bfec-42a3-b503-303ab3f2ac96';
const SCOPE = 'XboxLive.signin offline_access';

function post(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    const isForm = typeof body === 'string';
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'content-type': isForm ? 'application/x-www-form-urlencoded' : 'application/json',
        'accept': 'application/json',
        'content-length': Buffer.byteLength(data),
        ...headers,
      },
      timeout: 20000,
    }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(buf) }); }
        catch { reject(new Error(`响应不是有效 JSON（HTTP ${res.statusCode}）`)); }
      });
    });
    req.on('error', (e) => reject(new Error('网络请求失败：' + e.message)));
    req.on('timeout', () => { req.destroy(new Error('请求超时')); });
    req.write(data);
    req.end();
  });
}
function get(url, token) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, timeout: 20000 }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(buf) }); }
        catch { reject(new Error('配置获取失败')); }
      });
    }).on('error', (e) => reject(new Error('网络请求失败：' + e.message)));
  });
}

const XSTS_ERRORS = {
  2148916233: '这个微软账户是儿童账户，需要家长在微软家庭设置中允许使用 Minecraft。',
  2148916235: '微软账户所在国家/地区不支持 Xbox 服务，无法完成登录。',
  2148916236: '微软账户需要先完成成年人验证，请在 Xbox 官网完成验证后重试。',
  2148916238: '这个账户是未成年人账户，需要先加入一个家庭组才能登录。',
};

async function msStart() {
  const clientId = config.get().msClientId || DEFAULT_CLIENT_ID;
  const r = await post('https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode',
    new URLSearchParams({ client_id: clientId, scope: SCOPE }).toString());
  if (r.status !== 200 || !r.json.device_code) {
    throw new UserError('微软登录服务暂时不可用。如果你在“设置 → 高级”里改过微软应用 ID，请检查是否填错；否则请稍后再试。');
  }
  return { deviceId: r.json.device_code, userCode: r.json.user_code, verifyUrl: r.json.verification_uri, interval: r.json.interval || 5 };
}

async function msPoll(deviceId) {
  const clientId = config.get().msClientId || DEFAULT_CLIENT_ID;
  const tokenRes = await post('https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
    new URLSearchParams({
      client_id: clientId, device_code: deviceId,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }).toString(), { 'content-type': 'application/x-www-form-urlencoded' });
  const j = tokenRes.json;
  if (j.error === 'authorization_pending') return { status: 'pending' };
  if (j.error === 'slow_down') return { status: 'pending', slow: true };
  if (j.error === 'expired_token') throw new UserError('授权码过期了。请重新点击“开始登录”获取新代码。');
  if (j.error) throw new UserError('微软登录失败：' + (j.error_description || j.error).slice(0, 140));

  // XBL
  const xbl = await post('https://user.auth.xboxlive.com/user/authenticate', {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: 'd=' + j.access_token },
    RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT',
  });
  if (!xbl.json.DisplayClaims) throw new UserError('Xbox 登录失败，请稍后重试。');
  const uhs = xbl.json.DisplayClaims.xui[0].uhs;
  const xblToken = xbl.json.Token;
  // XSTS
  const xsts = await post('https://xsts.auth.xboxlive.com/xsts/authorize', {
    Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
    RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT',
  });
  if (xsts.status !== 200 || !xsts.json.DisplayClaims) {
    const code = xsts.json?.XErr;
    throw new UserError(XSTS_ERRORS[code] || `Xbox 权限验证失败（代码 ${code}）。这通常和账户设置有关。`);
  }
  const xstsToken = xsts.json.Token;
  const xstsUhs = xsts.json.DisplayClaims.xui[0].uhs;
  // Minecraft token
  const mc = await post('https://api.minecraftservices.com/authentication/login_with_xbox', {
    identityToken: `XBL3.0 x=${xstsUhs};${xstsToken}`,
  });
  if (!mc.json.access_token) throw new UserError('获取 Minecraft 登录凭证失败，请稍后重试。');
  // Profile（含皮肤披风）
  const prof = await get('https://api.minecraftservices.com/minecraft/profile', mc.json.access_token);
  if (prof.status === 404) throw new UserError('这个微软账户还没有购买 Minecraft Java 版。');
  if (!prof.json.id) throw new UserError('获取游戏档案失败，请稍后重试。');
  const skin = (prof.json.skins || []).find((s) => s.state === 'ACTIVE');
  const cape = (prof.json.capes || []).find((c) => c.state === 'ACTIVE');
  return {
    status: 'done',
    account: {
      type: 'microsoft',
      name: prof.json.name,
      uuidHex: prof.json.id,
      accessToken: mc.json.access_token,
      refreshToken: j.refresh_token,
      expiresAt: Date.now() + (mc.json.expires_in || 86400) * 1000,
      skinUrl: skin?.url || null,
      capeUrl: cape?.url || null,
    },
  };
}

async function refresh(account) {
  if (account.type !== 'microsoft' || !account.refreshToken) return account;
  if (account.expiresAt && Date.now() < account.expiresAt - 60 * 1000) return account;
  const clientId = config.get().msClientId || DEFAULT_CLIENT_ID;
  const r = await post('https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
    new URLSearchParams({ client_id: clientId, grant_type: 'refresh_token', refresh_token: account.refreshToken, scope: SCOPE }).toString());
  if (r.status !== 200 || !r.json.access_token) throw new UserError('正版登录已过期。请在账户管理中重新登录微软账户。');
  const xbl = await post('https://user.auth.xboxlive.com/user/authenticate', {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: 'd=' + r.json.access_token },
    RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT',
  });
  const uhs = xbl.json.DisplayClaims.xui[0].uhs;
  const xsts = await post('https://xsts.auth.xboxlive.com/xsts/authorize', {
    Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.json.Token] },
    RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT',
  });
  const mc = await post('https://api.minecraftservices.com/authentication/login_with_xbox', {
    identityToken: `XBL3.0 x=${uhs};${xsts.json.Token}`,
  });
  if (!mc.json.access_token) throw new UserError('正版登录续期失败，请重新登录。');
  return {
    ...account,
    accessToken: mc.json.access_token,
    refreshToken: r.json.refresh_token || account.refreshToken,
    expiresAt: Date.now() + (mc.json.expires_in || 86400) * 1000,
  };
}

module.exports = { msStart, msPoll, refresh };
