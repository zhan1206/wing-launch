// CDP 冒烟测试：打开每个页面 → 截图 → 收集控制台错误
// 用法: node scripts/smoke.mjs [--setup  "引导完成后数据"] [--only hash1,hash2]
import { spawn } from 'child_process';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'fs';
import path from 'path';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'test', 'screens');
mkdirSync(OUT, { recursive: true });

const only = process.argv.includes('--only') ? process.argv.find((a) => process.argv[process.argv.indexOf(a) + 1]) : null;
const onlyList = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null;

const electron = path.join(ROOT, 'node_modules', '.bin', 'electron');
const child = spawn(electron, ['.', '--remote-debugging-port=9333'], {
  cwd: ROOT,
  env: { ...process.env, BLOCKBOX_SMOKE: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const bootLog = [];
child.stdout.on('data', (d) => bootLog.push(d.toString()));
child.stderr.on('data', (d) => bootLog.push(d.toString()));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ROUTES = [
  ['/', '主页'],
  ['/instances', '实例'],
  ['/instances/create', '实例-创建入口'],
  ['/downloads', '下载中心'],
  ['/accounts', '账户'],
  ['/skins', '皮肤库'],
  ['/multiplayer', '联机'],
  ['/resources', '资源管理器'],
  ['/tools', '工具集'],
  ['/tools/gradient', '渐变文字'],
  ['/tools/seedmap', '种子地图'],
  ['/tools/schematic', '投影工坊'],
  ['/tools/translate', '模组翻译'],
  ['/tools/recipe', '配方生成器'],
  ['/server', '服务器'],
  ['/settings', '设置-外观'],
  ['/settings/theme', '设置-主题包'],
  ['/settings/game', '设置-游戏'],
  ['/settings/java', '设置-Java'],
  ['/help', '帮助中心'],
  ['/help/network', '帮助-网络主题'],
  ['/onboarding', '首次引导'],
];

const results = [];
try {
  await sleep(6000);
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0];
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text().slice(0, 300)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e).slice(0, 300)));

  for (const [hash, name] of ROUTES) {
    if (onlyList && !onlyList.includes(hash)) continue;
    errors.length = 0;
    await page.evaluate((h) => { location.hash = h; }, hash);
    await sleep(1600);
    const file = path.join(OUT, hash.replace(/[/:]/g, '_') || 'root') + '.png';
    await page.screenshot({ path: file });
    const textLen = await page.evaluate(() => document.querySelector('#page')?.innerText?.length || 0);
    results.push({ hash, name, screenshot: file, textLen, consoleErrors: [...errors] });
    console.log(`[${results.length}/${ROUTES.length}] ${hash} 文本长度=${textLen} 错误=${errors.length}`);
  }
  await browser.close();
} catch (e) {
  console.error('SMOKE FAILED:', e);
  results.push({ fatal: String(e) });
} finally {
  child.kill();
  await sleep(800);
  if (bootLog.length) writeFileSync(path.join(OUT, 'boot.log'), bootLog.join('\n'));
  writeFileSync(path.join(OUT, 'smoke-result.json'), JSON.stringify(results, null, 2));
  const fatal = results.filter((r) => r.fatal || (r.textLen === 0));
  console.log('---- 页面空白或异常:', fatal.length ? JSON.stringify(fatal.map((f) => f.hash || 'FATAL')) : '无');
  process.exit(0);
}
