import { spawn } from 'child_process';
import { chromium } from 'playwright-core';
import path from 'path';
const ROOT = process.cwd();
const DATA = '/var/folders/2t/ttl2zpb50173wjdkrjzbwc140000gn/T/方块 盒子(增强测试)';
const child = spawn(path.join(ROOT, 'node_modules/.bin/electron'), ['.', '--remote-debugging-port=9333'], { cwd: ROOT, env: { ...process.env, BLOCKBOX_DATA_DIR: DATA }, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 9000));
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = browser.contexts()[0].pages()[0];
await page.evaluate(async () => window.bb.raw.invoke('accounts.list')).catch(() => {});
console.log('app1 连接正常，现在 SIGKILL');
child.kill('SIGKILL');
await new Promise(r => setTimeout(r, 1500));
for (let i = 0; i < 5; i++) {
  const child2 = spawn(path.join(ROOT, 'node_modules/.bin/electron'), ['.', '--remote-debugging-port=9335'], { cwd: ROOT, env: { ...process.env, BLOCKBOX_DATA_DIR: DATA }, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 9000));
  try {
    const b3 = await Promise.race([
      chromium.connectOverCDP('http://127.0.0.1:9335'),
      new Promise((_r, rej) => setTimeout(() => rej(new Error('connect timeout')), 10000)),
    ]);
    const p2 = b3.contexts()[0].pages()[0];
    const list = await p2.evaluate(async () => window.bb.raw.invoke('instances.list'));
    console.log('第', i + 1, '次重启成功，实例数 =', (list.v || []).length);
    await b3.close();
    child2.kill();
    process.exit(0);
  } catch (e) {
    console.log('第', i + 1, '次失败:', String(e).slice(0, 80));
    try { child2.kill(); } catch { /* */ }
    await new Promise(r => setTimeout(r, 2000));
  }
}
console.log('5 次都失败');
process.exit(1);
