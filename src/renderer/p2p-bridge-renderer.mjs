// P2P 桥（在隐藏窗口中运行）：MQTT 公共信令 + WebRTC 数据通道 + 与主进程的字节流转发
import * as mqttNS from './vendor/mqtt.esm.js';
const mqttConnect = (mqttNS.default || mqttNS).connect;

const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://test.mosquitto.org:8081/mqtt'];
const ICE = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] };

const send = (type, payload = {}) => window.bridge.send({ type, ...payload });
console.log('[bridge] module loaded');
window.__bridgeState = 'loaded';
window.addEventListener('error', (e) => { window.__bridgeState = 'error: ' + e.message; });

let client = null;
let role = null, code = null, myId = null, myName = '玩家';
const pcs = new Map();       // peerId -> RTCPeerConnection
const channels = new Map();  // connId -> RTCDataChannel
let hbTimer = null;
const peers = new Map();     // playerId -> {name, role, lastSeen}

function status(state, extra = {}) { send('status', { state, ...extra }); }
function topic(kind) { return `blockbox-p2p/${code}/${kind}`; }
function publish(obj) {
  try { client.publish(topic('signal'), JSON.stringify({ ...obj, from: myId, name: myName, role, room: code })); (window.__bridgeLog = window.__bridgeLog || []).push('pub:' + (obj.t || '?')); } catch (e) { window.__bridgeState = 'pub-fail:' + (e.message || e); }
}

function connectOne(url) {
  return new Promise((resolve, reject) => {
    const c = mqttConnect(url, { clientId: 'bb-' + Math.random().toString(36).slice(2, 10), clean: true, keepalive: 30, connectTimeout: 8000 });
    const timer = setTimeout(() => { try { c.end(true); } catch { /* */ } reject(new Error('超时')); }, 12000);
    c.once('connect', () => { clearTimeout(timer); resolve(c); });
    c.once('error', (e) => { clearTimeout(timer); try { c.end(true); } catch { /* */ } reject(e); });
  });
}
async function connectMqtt() {
  console.log('[bridge] connecting mqtt…');
  window.__bridgeState = 'connecting-mqtt';
  let lastErr = null;
  for (const url of BROKERS) {
    try {
      client = await connectOne(url);
      client.on('error', () => { /* 断线由 mqtt 库自动重连 */ });
      console.log('[bridge] mqtt connected:', url);
      window.__bridgeState = 'mqtt-connected via ' + url;
      return;
    } catch (e) { lastErr = e; window.__bridgeState = 'mqtt-fail: ' + (e.message || e); }
  }
  throw lastErr || new Error('信令服务器连不上');
}

function startHeartbeat() {
  clearInterval(hbTimer);
  hbTimer = setInterval(() => {
    try {
      client.publish(topic('presence'), JSON.stringify({ t: 'hb', id: myId, name: myName, role, room: code }));
      prunePeers();
    } catch { /* */ }
  }, 5000);
}
function prunePeers() {
  const now = Date.now();
  let changed = false;
  for (const [id, p] of [...peers]) if (now - p.lastSeen > 16000) { peers.delete(id); changed = true; }
  if (changed) emitPlayers();
}
function emitPlayers() {
  send('players', { players: [...peers.entries()].map(([id, p]) => ({ id, name: p.name, role: p.role })) });
}

function onDataMsg(buf) {
  let msg;
  try { msg = JSON.parse(buf.toString()); } catch { return; }
  (window.__bridgeLog = window.__bridgeLog || []).push('recv:' + (msg.t || 'hb'));
  if (msg.room !== code || msg.from === myId) return;
  if (msg.t === 'hb') {
    peers.set(msg.from, { name: msg.name || '玩家', role: msg.role, lastSeen: Date.now() });
    emitPlayers();
    return;
  }
  peers.set(msg.from, { name: msg.name || '玩家', role: msg.role, lastSeen: Date.now() });
  emitPlayers();
  if (msg.to && msg.to !== myId) return;
  handleSignal(msg).catch(() => { /* */ });
}

async function handleSignal(msg) {
  if (role === 'host') {
    if (msg.t === 'join') {
      status('connecting', { text: '好友正在接入…' });
      const pc = new RTCPeerConnection(ICE);
      pcs.set(msg.from, pc);
      const dc = pc.createDataChannel('game', { ordered: true });
      wireChannel(dc, msg.from);
      pc.onicecandidate = (e) => { if (e.candidate) publish({ t: 'ice', to: msg.from, candidate: e.candidate }); };
      pc.onconnectionstatechange = () => { if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) pcs.delete(msg.from); };
      window.__bridgeState = 'sending-offer';
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      publish({ t: 'offer', to: msg.from, sdp: pc.localDescription });
    } else if (msg.t === 'answer') {
      const pc = pcs.get(msg.from);
      if (pc) await pc.setRemoteDescription(msg.sdp);
    } else if (msg.t === 'ice') {
      const pc = pcs.get(msg.from);
      if (pc) try { await pc.addIceCandidate(msg.candidate); } catch { /* */ }
    }
  } else {
    if (msg.t === 'offer') {
      status('connecting', { text: '正在建立点对点连接…' });
      const pc = new RTCPeerConnection(ICE);
      pcs.set(msg.from, pc);
      pc.ondatachannel = (e) => wireChannel(e.channel, msg.from);
      pc.onicecandidate = (e) => { if (e.candidate) publish({ t: 'ice', to: msg.from, candidate: e.candidate }); };
      window.__bridgeState = 'got-offer, answering';
      await pc.setRemoteDescription(msg.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      publish({ t: 'answer', to: msg.from, sdp: pc.localDescription });
    } else if (msg.t === 'ice') {
      const pc = pcs.get(msg.from);
      if (pc) try { await pc.addIceCandidate(msg.candidate); } catch { /* */ }
    }
  }
}

// 帧协议：第 1 字节 0x01=控制(JSON)、0x02=数据
function wireChannel(dc) {
  const connId = 'c' + Math.random().toString(36).slice(2, 10);
  channels.set(connId, dc);
  dc.binaryType = 'arraybuffer';
  dc.onopen = () => {
    window.__bridgeState = 'channel-open!';
    send('channel-open', { connId });
    status('connected', { text: '点对点连接已建立！' });
    send('peer-activity', {});
  };
  dc.onmessage = (e) => {
    send('peer-activity', {});
    const u8 = new Uint8Array(e.data instanceof ArrayBuffer ? e.data : e.data.buffer || e.data);
    if (!u8.length) return;
    if (u8[0] === 0x01) {
      try { const ctrl = JSON.parse(new TextDecoder().decode(u8.slice(1))); send('channel-control', { connId, t: ctrl.t }); } catch { /* */ }
    } else if (u8[0] === 0x02) {
      send('channel-data', { connId, data: u8.slice(1) });
    }
  };
  dc.onclose = () => { channels.delete(connId); send('channel-control', { connId, t: 'close' }); };
  dc.onerror = () => { /* onclose 会跟 */ };
}

// 访客侧：主进程的本地 TCP 连接 id 需映射到本机唯一的数据通道
function resolveChannel(connId) {
  if (channels.has(connId)) return channels.get(connId);
  for (const dc of channels.values()) { if (dc.readyState === 'open') return dc; }
  return null;
}
window.bridge.on('bridge:channel-data', ({ connId, data }) => {
  const dc = resolveChannel(connId);
  if (!dc) return;
  const body = data instanceof Uint8Array ? data : new Uint8Array(data);
  const frame = new Uint8Array(body.length + 1);
  frame[0] = 0x02;
  frame.set(body, 1);
  try { dc.send(frame); send('peer-activity', {}); } catch { /* */ }
});
window.bridge.on('bridge:channel-control', ({ connId, t }) => {
  const dc = resolveChannel(connId);
  if (!dc) return;
  const body = new TextEncoder().encode(JSON.stringify({ t }));
  const frame = new Uint8Array(body.length + 1);
  frame[0] = 0x01;
  frame.set(body, 1);
  try { dc.send(frame); } catch { /* */ }
});

async function createRoom({ code: roomCode, name }) {
  role = 'host'; code = String(roomCode); myId = 'h' + Math.random().toString(36).slice(2, 8);
  myName = (name || '房主') + '（房主）';
  await connectMqtt();
  await new Promise((res, rej) => client.subscribe(topic('signal'), (e) => e ? rej(e) : res()));
  await new Promise((res, rej) => client.subscribe(topic('presence'), (e) => e ? rej(e) : res()));
  window.__bridgeState = (window.__bridgeState || '') + '|subscribed';
  client.on('message', (_t, payload) => onDataMsg(payload));
  startHeartbeat();
  status('signaling', { text: '房间就绪，等待好友加入…' });
}

async function joinRoom({ code: roomCode, name }) {
  role = 'guest'; code = String(roomCode); myId = 'g' + Math.random().toString(36).slice(2, 8);
  myName = name || '玩家';
  await connectMqtt();
  await new Promise((res, rej) => client.subscribe(topic('signal'), (e) => e ? rej(e) : res()));
  await new Promise((res, rej) => client.subscribe(topic('presence'), (e) => e ? rej(e) : res()));
  client.on('message', (_t, payload) => onDataMsg(payload));
  startHeartbeat();
  publish({ t: 'join' });
  status('connecting', { text: '正在呼叫房主…' });
  setTimeout(() => {
    if (!pcs.size) {
      status('error', { reason: '对方未在线：这个房间码不存在或已过期。确认一下好友发给你的号码是不是完整的 6 位数字，并让对方保持启动器打开。' });
    }
  }, 45000);
}

window.bridge.on('bridge:create-room', (p) => createRoom(p).catch((e) => status('error', { reason: '创建房间失败：' + e.message + '。可能是公共信令服务器暂时不可用，稍后再试。' })));
window.bridge.on('bridge:join-room', (p) => joinRoom(p).catch((e) => status('error', { reason: '加入房间失败：' + e.message + '。可能是公共信令服务器暂时不可用，稍后再试。' })));
window.bridge.on('bridge:close-room', () => {
  try { clearInterval(hbTimer); client?.end?.(true); } catch { /* */ }
  pcs.forEach((pc) => { try { pc.close(); } catch { /* */ } });
  pcs.clear(); channels.clear(); peers.clear();
});
