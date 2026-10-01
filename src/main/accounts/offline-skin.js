// 离线账户本地皮肤服务：配合 authlib-injector 让离线模式也能用自定义皮肤（尽力而为）
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { dirs } = require('../core/paths');
const manager = require('../core/download/manager');

let server = null, port = 0;
const skins = new Map(); // uuidHex -> {file, model, name}

function b64(buf) { return Buffer.from(buf).toString('base64'); }
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' });

function sign(data) {
  return crypto.sign('sha256', Buffer.from(data), { key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING }).toString('base64');
}

async function start() {
  if (server) return port;
  server = http.createServer((req, res) => {
    const url = req.url || '/';
    res.setHeader('content-type', 'application/json');
    if (url === '/' || url === '') {
      res.end(JSON.stringify({
        meta: { serverName: '方块盒子本地皮肤', implementationName: 'blockbox-local-skin', implementationVersion: '1.0.0' },
        skinDomains: ['127.0.0.1', 'localhost'],
        signaturePublickey: b64(publicKeyDer),
      }));
      return;
    }
    const mProfile = /^\/sessionserver\/session\/minecraft\/profile\/([0-9a-f]{32})(\?|$)/.exec(url);
    if (mProfile) {
      const id = mProfile[1];
      const s = skins.get(id);
      if (!s) { res.statusCode = 404; res.end('{}'); return; }
      const payload = JSON.stringify({
        timestamp: Date.now(),
        profileId: id,
        profileName: s.name,
        textures: { SKIN: { url: `http://127.0.0.1:${port}/skins/${id}.png`, metadata: { model: s.model || 'classic' } } },
      });
      const value = b64(payload);
      res.end(JSON.stringify({ id, name: s.name, properties: [{ name: 'textures', value, signature: sign(value) }] }));
      return;
    }
    const mSkin = /^\/skins\/([0-9a-f]{32})\.png$/.exec(url);
    if (mSkin) {
      const s = skins.get(mSkin[1]);
      if (s && fs.existsSync(s.file)) {
        res.setHeader('content-type', 'image/png');
        res.end(fs.readFileSync(s.file));
      } else { res.statusCode = 404; res.end(); }
      return;
    }
    res.statusCode = 404; res.end('{}');
  });
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).on('error', reject));
  port = server.address().port;
  return port;
}

function setSkin(uuidHex, name, file, model) { skins.set(uuidHex.toLowerCase(), { file, model: model || 'classic', name }); }

async function ensureAgentJar() {
  const dest = path.join(dirs().java, 'authlib-injector.jar');
  if (fs.existsSync(dest) && fs.statSync(dest).size > 100000) return dest;
  let meta = null;
  for (const u of ['https://authlib-injector.yushi.moe/artifact/latest.json', 'https://bmclapi2.bangbang93.com/mirror/authlib-injector/artifact/latest.json']) {
    try { const r = await fetch(u, { signal: AbortSignal.timeout(10000) }); if (r.ok) { meta = await r.json(); break; } } catch { /* 下一个 */ }
  }
  if (!meta?.url) return null;
  try {
    await manager.download({ name: '本地皮肤组件（authlib-injector）', type: '皮肤', url: meta.url, dest, sha1: meta.checksums?.sha1 || null, size: 0 });
    return dest;
  } catch { return null; }
}

module.exports = { start, setSkin, ensureAgentJar };
