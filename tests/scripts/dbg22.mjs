import { spawn } from 'child_process';
import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';
import os from 'os';
const ROOT = process.cwd();
const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-a-'));
const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-b-'));
const childA = spawn(path.join(ROOT, 'node_modules/.bin/electron'), ['.', '--remote-debugging-port=9333'], { cwd: ROOT, env: { ...process.env, BLOCKBOX_DATA_DIR: dirA }, stdio: 'ignore' });
const childB = spawn(path.join(ROOT, 'node_modules/.bin/electron'), ['.', '--remote-debugging-port=9334'], { cwd: ROOT, env: { ...process.env, BLOCKBOX_DATA_DIR: dirB }, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 9000));
const browserA = await chromium.connectOverCDP('http://127.0.0.1:9333');
for (const pg of browserA.contexts()[0].pages()) pg.on('console', m => { if (m.text().match(/error|fail|mqtt/i)) console.log('[A-console]', m.text().slice(0, 180)); });
const browserB = await chromium.connectOverCDP('http://127.0.0.1:9334');
for (const pg of browserB.contexts()[0].pages()) pg.on('console', m => { if (m.text().match(/error|fail|mqtt/i)) console.log('[B-console]', m.text().slice(0, 180)); });
const pageA = browserA.contexts()[0].pages()[0];
const pageB = browserB.contexts()[0].pages()[0];
await new Promise(r => setTimeout(r, 1000));
const room = (await pageA.evaluate(async () => window.bb.raw.invoke('p2p.createRoom', { hostPort: 25665 }))).v;
console.log('room:', room?.code);
const jb = await pageB.evaluate(async (c) => window.bb.raw.invoke('p2p.joinRoom', { code: c }), room.code);
console.log('join:', JSON.stringify(jb).slice(0, 80));
await new Promise(r => setTimeout(r, 12000));
// 找到 A/B 的桥接窗口
for (const [label, browser] of [['A', browserA], ['B', browserB]]) {
  for (const pg of browser.contexts()[0].pages()) {
    const u = pg.url();
    if (u.includes('p2p-bridge')) {
      const info = await pg.evaluate(async () => {
        return { state: window.__bridgeState || 'none', log: (window.__bridgeLog || []).slice(-12) };
      }).catch(e => 'eval-fail: ' + String(e).slice(0, 100));
      console.log(`bridge[${label}] url=${u.slice(-24)} info=`, JSON.stringify(info));
    }
  }
}
// 桥接窗口 console 无法直接拿，改从主窗口收集最近的状态事件
const st = await pageB.evaluate(() => window.__p2pStatusLog || null).catch(() => null);
console.log('B status log:', JSON.stringify(st));
await browserA.close(); await browserB.close();
childA.kill(); childB.kill();
process.exit(0);
