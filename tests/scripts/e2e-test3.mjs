// 测试 3：账户切换与绑定测试（离线A/离线B/第三方C[本地模拟Yggdrasil] + 实例绑定 + 临时切换）
import { spawn, execSync } from 'child_process';
import { chromium } from 'playwright-core';
import http from 'http';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'test', 'screens');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[test3]', ...a);
const report = [];
const step = (name, ok, note = '') => { report.push({ name, ok, note }); log(ok ? '✓' : '✗', name, note); };

// 本地模拟 Yggdrasil 服务器（第三方账户 C）
const mock = http.createServer((req, res) => {
  const url = req.url || '';
  res.setHeader('content-type', 'application/json');
  if (url.endsWith('/authserver/authenticate')) {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.end(JSON.stringify({
        accessToken: 'mock-token-' + Date.now(),
        availableProfiles: [{ id: 'c9d3f4a1b2c3d4e5f6a7b8c9d0e1f2a3', name: '第三方玩家C' }],
        selectedProfile: { id: 'c9d3f4a1b2c3d4e5f6a7b8c9d0e1f2a3', name: '第三方玩家C' },
        user: { id: 'u1' },
      }));
    });
  } else if (url.endsWith('/authserver/validate')) { res.statusCode = 204; res.end(); }
  else if (url.endsWith('/authserver/refresh')) { res.end(JSON.stringify({ accessToken: 'mock-refreshed', selectedProfile: { id: 'c9d3f4a1b2c3d4e5f6a7b8c9d0e1f2a3', name: '第三方玩家C' } })); }
  else { res.end('{}'); }
});
await new Promise((r) => mock.listen(7442, '127.0.0.1', r));

const child = spawn(path.join(ROOT, 'node_modules/.bin/electron'), ['.', '--remote-debugging-port=9333'], { cwd: ROOT, stdio: 'ignore' });
const invoke = (page, ch, payload) => page.evaluate(([c, p]) => window.bb.raw.invoke(c, p ), [ch, payload]);
const killJava = () => { try { execSync(`pkill -f "net.minecraft.client.main.Main" || pkill -f "cp:\\\\$LIBRARIES" || true`); } catch { /* */ } };

try {
  await sleep(7000);
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const page = browser.contexts()[0].pages()[0];
  await page.screenshot({ path: path.join(OUT, 't3-start.png') });

  // 已有离线账户（测试1创建的 BlockBoxTester）作为账户 A
  const accs0 = (await invoke(page, 'accounts.list', {})).v;
  let A = accs0.find((a) => a.type === 'offline');
  if (!A) A = (await invoke(page, 'accounts.addOffline', 'BlockBoxTester')).v ? (await invoke(page, 'accounts.list', {})).v.find((a) => a.type === 'offline') : null;
  step('离线账户 A 存在', !!A, A?.name);

  // 离线账户 B
  await invoke(page, 'accounts.addOffline', 'SecondB');
  let B = (await invoke(page, 'accounts.list', {})).v.find((a) => a.name === 'SecondB');
  step('离线账户 B 创建', !!B, B?.name);

  // 第三方账户 C（自定义 Yggdrasil → 本地模拟服务器）
  try {
    const c = (await invoke(page, 'accounts.addYggdrasil', { preset: 'custom', serverUrl: 'http://127.0.0.1:7442/api/yggdrasil', username: 'c@c.c', password: 'x' })).v;
    step('第三方账户 C 登录（本地 Yggdrasil 模拟）', !!c?.id, c?.name);
  } catch (e) { step('第三方账户 C 登录（本地 Yggdrasil 模拟）', false, String(e.message).slice(0, 120)); }

  // 实例 X 绑定 A
  const insts = (await invoke(page, 'instances.list', {})).v;
  const X = insts.find((i) => i.loader === 'vanilla') || insts[0];
  if (!X) throw new Error('没有可用实例（测试1应已创建）');
  await invoke(page, 'instances.setBoundAccount', { id: X.id, accountId: A.id });
  const bound = (await invoke(page, 'instances.get', { id: X.id })).v.boundAccountId;
  step('实例 X 绑定账户 A', bound === A.id);

  // 以绑定账户启动 → 进程参数应含 --username BlockBoxTester
  const launch1 = (await invoke(page, 'instances.launch', { id: X.id })).v;
  let pid1 = null, cmd1 = '';
  const t0 = Date.now();
  while (Date.now() - t0 < 90 * 1000) {
    await sleep(4000);
    const out = execSync('ps -eo pid,command | grep -i "java" | grep -v grep || true').toString();
    if (out.includes('--username')) { pid1 = parseInt(out.trim().split(/\s+/)[0], 10); cmd1 = out; break; }
  }
  step('绑定账户 A 生效（--username 正确）', !!cmd1 && cmd1.includes(A.name), cmd1.match(/--username (\S+)/)?.[1]);
  execSync(`kill -9 ${pid1} 2>/dev/null || true`);
  await sleep(3000);

  // 临时切换为 B 启动
  const launch2 = (await invoke(page, 'instances.launch', { id: X.id, accountId: B.id })).v;
  let pid2 = null, cmd2 = '';
  const t1 = Date.now();
  while (Date.now() - t1 < 90 * 1000) {
    await sleep(4000);
    const out = execSync('ps -eo pid,command | grep -i "java" | grep -v grep || true').toString();
    if (out.includes('--username')) { pid2 = parseInt(out.trim().split(/\s+/)[0], 10); cmd2 = out; break; }
  }
  step('临时切换 B 生效（游戏内昵称 = B）', !!cmd2 && cmd2.includes(B.name), cmd2.match(/--username (\S+)/)?.[1]);
  execSync(`kill -9 ${pid2} 2>/dev/null || true`);
  await sleep(2000);
  const boundAfter = (await invoke(page, 'instances.get', { id: X.id })).v.boundAccountId;
  step('临时切换后默认绑定仍为 A', boundAfter === A.id);

  await page.evaluate(() => { location.hash = '#/accounts'; });
  await sleep(1500);
  await page.screenshot({ path: path.join(OUT, 't3-accounts.png') });
  await browser.close();
} catch (e) {
  step('异常', false, String(e).slice(0, 300));
} finally {
  child.kill();
  mock.close();
  await sleep(800);
  console.log('---- 测试3结果 ----');
  for (const s of report) console.log(`${s.ok ? '通过' : '失败'} | ${s.name} | ${s.note}`);
  fs.writeFileSync(path.join(OUT, 'test3-result.json'), JSON.stringify(report, null, 2));
  process.exit(0);
}
