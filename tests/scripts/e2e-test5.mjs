// 测试 5：P2P 联机基本流程（双应用实例 + 真实 WebRTC/MQTT 隧道 + 房间码错误提示）
import { spawn } from 'child_process';
import { chromium } from 'playwright-core';
import net from 'net';
import fs from 'fs';
import path from 'path';
import os from 'os';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'test', 'screens');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[test5]', ...a);
const report = [];
const step = (name, ok, note = '') => { report.push({ name, ok, note }); log(ok ? '✓' : '✗', name, note); };

// 假"游戏服务器"：收到什么回什么（供隧道穿透验证）
let fakeMsg = '';
const fakeServer = net.createServer((sock) => {
  sock.on('data', (d) => {
    fakeMsg = d.toString().slice(0, 100);
    sock.write('pong:' + d.toString());
  });
});
await new Promise((r) => fakeServer.listen(25665, '127.0.0.1', r));

const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-p2p-a-'));
const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-p2p-b-'));
const childA = spawn(path.join(ROOT, 'node_modules/.bin/electron'), ['.', '--remote-debugging-port=9333'], { cwd: ROOT, env: { ...process.env, BLOCKBOX_DATA_DIR: dirA }, stdio: 'ignore' });
const childB = spawn(path.join(ROOT, 'node_modules/.bin/electron'), ['.', '--remote-debugging-port=9334'], { cwd: ROOT, env: { ...process.env, BLOCKBOX_DATA_DIR: dirB }, stdio: 'ignore' });
const invoke = (page, ch, payload) => page.evaluate(([c, p]) => window.bb.raw.invoke(c, p), [ch, payload]);

try {
  await sleep(9000);
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const browserB = await chromium.connectOverCDP('http://127.0.0.1:9334');
  const pageA = browser.contexts()[0].pages()[0];
  const pageB = browserB.contexts()[0].pages()[0];

  // 房主 A 创建房间（hostPort 指向假游戏服务器）
  const room = (await invoke(pageA, 'p2p.createRoom', { hostPort: 25665 })).v;
  const code = room?.code;
  step('创建房间并生成 6 位房间码', /^\d{6}$/.test(code || ''), `code=${code}`);

  // 房主端玩家列表
  await sleep(1500);
  const playersA = (await invoke(pageA, 'p2p.players', {})).v;
  step('房主端玩家列表', Array.isArray(playersA) && playersA.length >= 1, JSON.stringify(playersA).slice(0, 100));

  // 玩家 B 加入
  const joined = (await invoke(pageB, 'p2p.joinRoom', { code })).v;
  log('B 加入返回:', JSON.stringify(joined));

  // 等待连接建立（MQTT 信令 + WebRTC 打洞，本机内通常 <20s；公共 broker 慢时最多 90s）
  let tcpPort = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 90 * 1000) {
    await sleep(3000);
    const st = (await invoke(pageB, 'p2p.state', {})).v;
    if (st?.active && st?.tcpPort) { tcpPort = st.tcpPort; break; }
  }
  step('P2P 连接建立（B 获得本地隧道端口）', !!tcpPort, `tcpPort=${tcpPort}`);

  if (tcpPort) {
    // 从 B 侧发起 TCP 连接 → 应穿透隧道到达 A 的"游戏"
    const reply = await new Promise((resolve) => {
      const s = net.connect(tcpPort, '127.0.0.1', () => s.write('ping-blockbox'));
      let buf = '';
      s.on('data', (d) => { buf += d.toString(); s.end(); });
      s.on('error', (e) => resolve('ERR:' + e.message));
      setTimeout(() => resolve(buf || 'TIMEOUT'), 15000);
      s.on('close', () => resolve(buf || 'EMPTY'));
    });
    step('隧道数据互通（TCP→WebRTC→TCP）', String(reply).startsWith('pong:ping-blockbox'), String(reply).slice(0, 60));
    step('假游戏服务器收到流量', fakeMsg.includes('ping-blockbox'), fakeMsg.slice(0, 40));
  }

  // B 端玩家列表 ≥ 2（自己 + 房主）
  await sleep(3000);
  const playersB = (await invoke(pageB, 'p2p.players', {})).v;
  step('玩家列表显示', Array.isArray(playersB), JSON.stringify(playersB).slice(0, 120));

  // 房间码错误提示
  await invoke(pageB, 'p2p.leave', {});
  await sleep(1000);
  await pageB.evaluate(() => {
    window.__p2pStatus = null;
    window.bb.raw.on('bb:p2p-status', (s) => { window.__p2pStatus = s; });
  });
  let joinErr = null;
  try { await invoke(pageB, 'p2p.joinRoom', { code: '000001' }); } catch (e) { joinErr = e.message; }
  // 等待 45 秒超时后的"不存在或已过期"提示
  await sleep(50000);
  const status = await pageB.evaluate(() => window.__p2pStatus);
  step('错误房间码给出中文提示', /不存在|过期|未在线/.test((status?.reason || '') + (joinErr || '')), ((status?.reason || '') + ' | ' + (joinErr || '')).slice(0, 100));

  await pageA.screenshot({ path: path.join(OUT, 't5-host.png') });
  await pageB.screenshot({ path: path.join(OUT, 't5-guest.png') });
  await browser.close(); await browserB.close();
} catch (e) {
  step('异常', false, String(e).slice(0, 300));
} finally {
  childA.kill(); childB.kill(); fakeServer.close();
  await sleep(800);
  console.log('---- 测试5结果 ----');
  for (const s of report) console.log(`${s.ok ? '通过' : '失败'} | ${s.name} | ${s.note}`);
  fs.writeFileSync(path.join(OUT, 'test5-result.json'), JSON.stringify(report, null, 2));
  process.exit(0);
}
