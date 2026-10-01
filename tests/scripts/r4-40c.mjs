// 测试 40c：启动后自动退出且游戏进程存活（独立数据副本）
import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
const ROOT = process.cwd();
const SRC = fs.readdirSync('/var/folders/2t/ttl2zpb50173wjdkrjzbwc140000gn/T').filter(d => d.startsWith('bb-r4-')).map(d => '/var/folders/2t/ttl2zpb50173wjdkrjzbwc140000gn/T/' + d)[0];
const DATAQ = SRC + '-autoexit';
fs.rmSync(DATAQ, { recursive: true, force: true });
fs.cpSync(SRC, DATAQ, { recursive: true });
const stq = JSON.parse(fs.readFileSync(path.join(DATAQ, 'settings.json'), 'utf8'));
stq.afterLaunch = 'quit';
stq.wizardDone = true;
fs.writeFileSync(path.join(DATAQ, 'settings.json'), JSON.stringify(stq, null, 2));
const accounts = JSON.parse(fs.readFileSync(path.join(DATAQ, 'accounts.json'), 'utf8'));
if (!accounts.accounts.length) { accounts.accounts = [{ id: 'acc-x', type: 'offline', name: '自退测试员', displayName: '自退测试员', uuidHex: '0123456789abcdef0123456789abcdef' }]; accounts.currentId = 'acc-x'; fs.writeFileSync(path.join(DATAQ, 'accounts.json'), JSON.stringify(accounts)); }
// 需要一个可启动实例：把主实例目录也拷进来
const instId = process.argv[2];
const inst = JSON.parse(fs.readFileSync(path.join(SRC, 'instances.json'), 'utf8')).instances.find(i => i.id === instId);
inst.dir = path.join(DATAQ, 'instances', instId);
fs.mkdirSync(inst.dir, { recursive: true });
fs.cpSync(path.join(SRC, 'instances', instId), inst.dir, { recursive: true });
fs.writeFileSync(path.join(DATAQ, 'instances.json'), JSON.stringify({ instances: [inst] }, null, 2));
// 拷贝全局 java/versions/libraries/assets 引用不变（DATAQ 内没有 → 软链）
for (const d of ['java', 'versions', 'libraries', 'assets', 'meta']) { try { fs.symlinkSync(path.join(SRC, d), path.join(DATAQ, d), 'dir'); } catch { /* */ } }
const child = spawn(path.join(ROOT, 'node_modules/.bin/electron'), ['.', '--remote-debugging-port=9339'], { cwd: ROOT, env: { ...process.env, BLOCKBOX_DATA_DIR: DATAQ }, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 9000));
import('playwright-core').then(async ({ chromium }) => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9339');
  const page = b.contexts()[0].pages()[0];
  await page.evaluate(async (id) => window.bb.raw.invoke('instances.launch', { id }), inst.id).catch(e => console.log('launch err:', e.message.slice(0, 80)));
  let exited = false, gameAlive = false;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 5000));
    if (execSync('ps -eo command | grep "bin/java" | grep -v grep || true').toString().trim()) gameAlive = true;
    const alive = (() => { try { child.kill(0); return true; } catch { return false; } })();
    if (gameAlive && !alive) { exited = true; break; }
  }
  console.log(`40c 启动后自动退出且游戏进程存活 → 启动器退出=${exited}，游戏存活=${gameAlive}`);
  execSync('pkill -f "bin/java" 2>/dev/null || true');
  process.exit(exited && gameAlive ? 0 : 1);
});
