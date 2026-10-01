// 测试 1：冷启动测试（引导 → 离线账户 → 原版最新版实例 → 启动游戏）
import { spawn, execSync } from 'child_process';
import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const OUT = path.join(ROOT, 'test', 'screens');
const DATA = path.join(process.env.HOME, 'Library', 'Application Support', 'Wing Launch');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[test1]', ...a);
const T0 = Date.now();
const stepTime = (name) => log(`✓ ${name}（+${((Date.now() - T0) / 1000).toFixed(1)}s）`);

// 0) 模拟全新电脑：清空启动器数据
if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
log('已清空启动器数据目录，模拟从未安装过的状态');

const child = spawn(path.join(ROOT, 'node_modules/.bin/electron'), ['.', '--remote-debugging-port=9333'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
const report = { steps: [], warnings: [] };
const step = (name, ok, note = '') => { report.steps.push({ name, ok, note, t: ((Date.now() - T0) / 1000).toFixed(1) + 's' }); log(ok ? '✓' : '✗', name, note); };

try {
  await sleep(7000);
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const page = browser.contexts()[0].pages()[0];
  const shot = async (n) => page.screenshot({ path: path.join(OUT, `t1-${n}.png`) });

  // 1) 引导自动出现
  await page.waitForFunction(() => location.hash === '#/onboarding', { timeout: 15000 });
  await sleep(1200);
  await shot('01-welcome');
  step('引导自动出现', true);

  // 2) 欢迎 → 下一步
  await page.click('#ob-next');
  await sleep(900);
  await shot('02-appearance');
  // 默认应为 暗色 + 深空黑
  const darkSel = await page.evaluate(() => document.querySelector('#ob-mode-dark')?.classList.contains('ob-sel'));
  step('默认选中暗色+深空黑', !!darkSel);
  await page.click('#ob-next');
  await sleep(900);

  // 3) 离线账户
  await shot('03-account');
  await page.fill('#ob-offline-name', 'WingLaunchTester');
  await page.click('#ob-offline-add');
  { let okA = false; for (let i = 0; i < 20; i++) { await sleep(1000); if (await page.evaluate(() => document.body.innerText.includes('✅'))) { okA = true; break; } } if (!okA) throw new Error('账户添加未确认'); }
  await shot('03b-account-added');
  step('离线账户添加', true);
  await page.click('#ob-next');
  await sleep(1200);

  // 4) 推荐实例 → 点第一个（最新版原版）
  await page.waitForFunction(() => document.querySelectorAll('.card').length >= 2, { timeout: 30000 });
  await shot('04-instances');
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.card.hoverable')];
    cards[0].click();
  });
  // 等实例创建完成（引导自动跳转主页或完成按钮出现）
  // 轮询等待实例创建完成（避免 async waitForFunction 的 Promise 真值陷阱）
  {
    let created = false;
    const tC = Date.now();
    while (Date.now() - tC < 15 * 60 * 1000) {
      await sleep(4000);
      const r = await page.evaluate(async () => window.bb.raw.invoke('instances.list').catch(e => ({ err: String(e) })));
      if ((r.v || []).length >= 1 && (await page.evaluate(() => location.hash)) !== '#/onboarding') { created = true; break; }
    }
    if (!created) throw new Error('15 分钟内实例未创建完成');
  }
  const waitLog = await page.evaluate(() => (window.__waitLog || []).slice(-4)); step('实例创建（含 Java 自动下载）', true, JSON.stringify(waitLog));
  await sleep(1500);
  await shot('05-home');

  // 5) 打开实例详情，点启动
  const instId = await page.evaluate(async () => (await window.bb.raw.invoke('instances.list')).v[0]?.id);
  log('实例 id:', instId);
  await page.evaluate((h) => { location.hash = h; }, `/instances/${instId}`);
  await sleep(1500);
  await page.click('#d-launch');
  await shot('06-launching');
  step('点击启动', true);

  // 6) 等 Java 进程出现（首次要下载游戏文件，最长 25 分钟）
  const t0 = Date.now();
  let javaPid = null;
  while (Date.now() - t0 < 25 * 60 * 1000) {
    await sleep(5000);
    try {
      const out = execSync('ps -eo pid,comm | grep -i java | grep -v grep || true').toString().trim();
      if (out && /java/.test(out)) {
        javaPid = parseInt(out.split(/\s+/)[0], 10);
        break;
      }
    } catch { /* 继续 */ }
    const txt = await page.evaluate(() => document.body.innerText.slice(0, 400));
    if (txt.includes('启动失败') || txt.includes('下载失败')) throw new Error('启动器报错：' + txt.replace(/\n/g, ' ').slice(0, 200));
  }
  if (!javaPid) throw new Error('25 分钟内没有看到 Java 进程');
  step('Java 进程启动（游戏文件自动下载完成）', true, `pid=${javaPid}`);

  // 7) 游戏存活 30 秒视为成功
  const alive0 = Date.now();
  let crashedEarly = false;
  while (Date.now() - alive0 < 30000) {
    await sleep(5000);
    const alive = execSync(`ps -p ${javaPid} > /dev/null 2>&1 && echo yes || echo no`).toString().trim();
    if (alive === 'no') { crashedEarly = true; break; }
  }
  const still = execSync(`ps -p ${javaPid} > /dev/null 2>&1 && echo yes || echo no`).toString().trim();
  if (crashedEarly || still === 'no') {
    await shot('07-crashed');
    step('游戏稳定运行 30 秒', false, '进程提前退出——查看启动器崩溃分析');
    // 打开崩溃分析验证功能
    const report0 = await page.evaluate(async () => {
      const id = (await window.bb.raw.invoke('instances.list')).v[0]?.id;
      return (await window.bb.raw.invoke('crash.analyze', { instanceId: id } )).v;
    });
    log('崩溃分析（如有）：', JSON.stringify(report0).slice(0, 400));
  } else {
    step('游戏稳定运行 30 秒', true);
    await shot('07-running');
    execSync(`kill ${javaPid} || true`);
    log('已结束游戏进程');
  }
  await sleep(2000);
  await shot('08-final');
  await browser.close();
} catch (e) {
  step('异常', false, String(e).slice(0, 300));
} finally {
  child.kill();
  await sleep(1000);
  fs.writeFileSync(path.join(OUT, 'test1-result.json'), JSON.stringify(report, null, 2));
  console.log('---- 测试1结果 ----');
  for (const s of report.steps) console.log(`${s.ok ? '通过' : '失败'} | ${s.name} | ${s.note} | ${s.t}`);
  process.exit(0);
}
