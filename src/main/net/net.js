// 联机：局域网世界发现（UDP 组播）+ P2P 房间（隐藏窗口 WebRTC + 本地 TCP 隧道）
const dgram = require('dgram');
const net = require('net');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { BrowserWindow, ipcMain } = require('electron');
const { broadcast } = require('../core/emitter');
const { UserError } = require('../core/ipc-gateway');
const accounts = require('../accounts/accounts');

/* ============ 局域网世界发现 ============ */
let udpSock = null;
const lanWorlds = new Map(); // key "host:port" -> {host, port, motd, seen}
function startLanListener() {
  if (udpSock) return;
  udpSock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  udpSock.on('error', () => { udpSock = null; });
  udpSock.on('message', (buf, rinfo) => {
    const text = buf.toString('utf8');
    const m = /\[MOTD\]([\s\S]*?)\[\/MOTD\]\[MOTD\](\d+)\[\/MOTD\]/.exec(text);
    if (!m) return;
    const key = `${rinfo.address}:${m[2]}`;
    lanWorlds.set(key, { host: rinfo.address, port: Number(m[2]), motd: m[1].replace(/\[\/MOTD\][\s\S]*$/, ''), seen: Date.now() });
    broadcastLan();
  });
  try { udpSock.bind(4445, () => { try { udpSock.addMembership('224.0.2.60'); } catch { /* */ } }); }
  catch { udpSock = null; }
}
function broadcastLan() {
  const now = Date.now();
  const arr = [...lanWorlds.values()].filter((w) => now - w.seen < 10000).map(({ host, port, motd }) => ({ host, port, motd, name: motd || '局域网世界' }));
  broadcast('bb:lan-worlds', arr);
}
function latestLanPort() {
  const arr = [...lanWorlds.values()].filter((w) => Date.now() - w.seen < 120000).sort((a, b) => b.seen - a.seen);
  return arr[0]?.port || null;
}

function lanCheck() {
  const nics = os.networkInterfaces();
  let ip = null, subnet = null;
  for (const list of Object.values(nics)) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) { ip = n.address; subnet = n.netmask; break; }
    }
    if (ip) break;
  }
  return { ip: ip || '127.0.0.1', subnet: subnet || '-', tip: ip && ip.startsWith('127.') ? '没有检测到局域网连接，请确认已连接 WiFi 或网线。' : '和好友的 IP 前三段一致（如都是 192.168.1.x）就说明在同一个局域网内。' };
}

/* ============ P2P 房间（经隐藏窗口的 WebRTC 桥） ============ */
let bridgeWin = null;
let bridgeReady = false;
const pendingBridge = [];

function ensureBridge() {
  if (bridgeWin && !bridgeWin.isDestroyed()) return;
  bridgeReady = false;
  bridgeWin = new BrowserWindow({
    show: false, width: 10, height: 10,
    webPreferences: {
      preload: path.join(__dirname, 'bridge-preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });
  bridgeWin.loadFile(path.join(__dirname, '..', '..', 'renderer', 'p2p-bridge.html'));
  bridgeWin.webContents.on('did-finish-load', () => {
    bridgeReady = true;
    for (const m of pendingBridge.splice(0)) bridgeSend(m.ch, m.payload);
  });
  bridgeWin.on('closed', () => { bridgeWin = null; bridgeReady = false; });
}
function bridgeSend(ch, payload) {
  if (bridgeReady && bridgeWin && !bridgeWin.isDestroyed()) bridgeWin.webContents.send(ch, payload);
  else pendingBridge.push({ ch, payload });
}

let room = null; // {code, role, hostPort, tcpServer, tcpPort, conns, closeTimer, created}
let players = new Map(); // id -> {name, lastSeen}

function myName() {
  try { const a = accounts.current(); return a?.displayName || a?.name || '玩家'; } catch { return '玩家'; }
}

async function createRoom({ hostPort = null } = {}) {
  ensureBridge();
  const code = String(Math.floor(100000 + Math.random() * 900000));
  room = { code, role: 'host', hostPort, tcpServer: null, tcpPort: null, conns: new Map(), closeTimer: null, created: Date.now(), lastActivity: Date.now() };
  players = new Map();
  players.set('self', { name: myName() + '（你）', lastSeen: Date.now(), role: 'host' });
  bridgeSend('bridge:create-room', { code, role: 'host' });
  armRoomTimeout();
  broadcast('bb:p2p-status', { state: 'signaling', text: '房间已创建，等待好友加入…' });
  broadcastPlayers();
  return { code };
}

async function joinRoom(code) {
  code = String(code || '').trim();
  if (!/^\d{6}$/.test(code)) throw new UserError('请输入好友发给你的 6 位数字房间码。');
  ensureBridge();
  if (room) teardownRoom();
  room = { code, role: 'guest', tcpServer: null, tcpPort: null, conns: new Map(), closeTimer: null, created: Date.now(), lastActivity: Date.now() };
  bridgeSend('bridge:join-room', { code, name: myName() });
  broadcast('bb:p2p-status', { state: 'signaling', text: '正在连接好友的房间…（最多需要 60 秒）' });
  return { code };
}

// 游客本地 TCP 服务器：游戏连 127.0.0.1:port → 隧道到房主
function startGuestTcpServer() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer((socket) => {
      if (!room) { socket.destroy(); return; }
      const connId = 'c' + crypto.randomBytes(4).toString('hex');
      room.conns.set(connId, socket);
      room.lastActivity = Date.now();
      bridgeSend('bridge:channel-control', { connId, t: 'open' });
      socket.on('data', (d) => bridgeSend('bridge:channel-data', { connId, data: new Uint8Array(d) }));
      socket.on('close', () => { room?.conns.delete(connId); bridgeSend('bridge:channel-control', { connId, t: 'close' }); });
      socket.on('error', () => { /* */ });
    });
    srv.on('error', reject);
    // 必须把 server 对象一并返回：否则房间销毁时无法 close，端口会被永久占用
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

function setupGuestTcp() {
  return startGuestTcpServer().then(({ srv, port }) => {
    if (!room) { try { srv.close(); } catch { /* */ } return null; } // 房间已销毁，立即回收监听
    room.tcpServer = srv;
    room.tcpPort = port;
    broadcast('bb:p2p-status', { state: 'connected', text: `连接已建立！`, localPort: port });
    broadcastPlayers();
    return port;
  });
}

function armRoomTimeout() {
  if (!room) return;
  clearTimeout(room.closeTimer);
  room.closeTimer = setTimeout(() => {
    if (room && Date.now() - room.lastActivity > 30 * 60 * 1000) {
      teardownRoom();
      broadcast('bb:p2p-status', { state: 'idle', text: '房间已经 30 分钟没人加入，自动关闭了。' });
    } else armRoomTimeout();
  }, 60 * 1000);
}

function teardownRoom() {
  if (!room) return;
  bridgeSend('bridge:close-room', {});
  try { room.tcpServer?.close?.(); } catch { /* */ }
  for (const s of room.conns?.values() || []) { try { s.destroy(); } catch { /* */ } }
  clearTimeout(room.closeTimer);
  room = null;
  players = new Map();
}

function broadcastPlayers() {
  broadcast('bb:p2p-players', [...players.values()]);
}

// 房主：隧道到本机游戏端口
function hostDial(connId) {
  if (!room) return;
  const port = room.hostPort || latestLanPort();
  if (!port) {
    bridgeSend('bridge:channel-control', { connId, t: 'close' });
    broadcast('bb:p2p-status', { state: 'error', reason: '没有检测到你开放的世界。请先在游戏里「对局域网开放」，再让好友加入。' });
    return;
  }
  const sock = net.connect(port, '127.0.0.1', () => { /* ok */ });
  room.conns.set(connId, sock);
  sock.on('data', (d) => bridgeSend('bridge:channel-data', { connId, data: new Uint8Array(d) }));
  sock.on('close', () => { room?.conns.delete(connId); bridgeSend('bridge:channel-control', { connId, t: 'close' }); });
  sock.on('error', () => { /* */ });
}

function initBridgeIpc() {
  ipcMain.on('bridge:event', (_e, ev) => {
    switch (ev.type) {
      case 'status':
        broadcast('bb:p2p-status', { state: ev.state, reason: ev.reason, text: ev.text, localPort: ev.localPort });
        if (ev.state === 'connected' && room?.role === 'guest') {
          setupGuestTcp().catch(() => broadcast('bb:p2p-status', { state: 'error', reason: '本地端口监听失败，请退出房间后重试。' }));
        }
        if (ev.state === 'connected' && room?.role === 'host') { /* 房主等待隧道 */ }
        if (ev.state === 'error') { room && (room.lastActivity = Date.now()); }
        break;
      case 'players':
        players = new Map((ev.players || []).map((p) => [p.id, { name: p.name, role: p.role, lastSeen: Date.now() }]));
        broadcastPlayers();
        break;
      case 'channel-open':
        if (room?.role === 'host') {
          room.pendingDial = room.pendingDial || new Set();
          room.pendingDial.add(ev.connId);
        }
        break;
      case 'channel-control':
        if (room?.role === 'host' && ev.t === 'open') hostDial(ev.connId);
        if (room?.role === 'host' && ev.t === 'close') { const s = room.conns.get(ev.connId); try { s?.destroy(); } catch { /* */ } room.conns.delete(ev.connId); }
        break;
      case 'channel-data': {
        let s = room?.conns.get(ev.connId);
        if (!s && room?.role === 'guest') {
          // 访客侧：回程数据按本机唯一的本地连接兜底匹配
          for (const sock of room.conns.values()) { s = sock; break; }
        }
        if (s && !s.destroyed) s.write(Buffer.from(ev.data));
        break;
      }
      case 'peer-activity':
        if (room) room.lastActivity = Date.now();
        break;
    }
  });
}

function state() {
  if (!room) return { active: false };
  return { active: true, code: room.code, role: room.role, tcpPort: room.tcpPort || null, hostPort: room.hostPort };
}

function leave() { teardownRoom(); broadcast('bb:p2p-status', { state: 'idle', text: '已退出联机。' }); return true; }

function registerAll(register) {
  startLanListener();
  initBridgeIpc();
  register({
    'net.lanCheck': () => lanCheck(),
    'net.lanWorlds': () => [...lanWorlds.values()].filter((w) => Date.now() - w.seen < 10000).map(({ host, port, motd }) => ({ host, port, motd, name: motd || '局域网世界' })),
    'p2p.createRoom': (p) => createRoom(p),
    'p2p.joinRoom': ({ code }) => joinRoom(code),
    'p2p.players': () => [...players.values()],
    'p2p.state': () => state(),
    'p2p.leave': () => leave(),
    'p2p.closeRoom': () => leave(),
  });
}
module.exports = { registerAll };
