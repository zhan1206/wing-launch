// 测试 4：崩溃分析触发测试（256MB 内存启动原版 → OOM → 中文分析报告 → 一键修复）
import { spawn, execSync } from 'child_process';
import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const OUT = path.join(ROOT, 'test', 'screens');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[test4]', ...a);
const report = [];
const step = (name, ok, note = '') => { report.push({ name, ok, note }); log(ok ? '✓' : '✗', name, note); };

const child = spawn(path.join(ROOT, 'node_modules/.bin/electron'), ['.', '--remote-debugging-port=9333'], { cwd: ROOT, stdio: 'ignore' });
const invoke = (page, ch, payload) => page.evaluate(([c, p]) => window.bb.raw.invoke(c, p ), [ch, payload]);

try {
  await sleep(7000);
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const page = browser.contexts()[0].pages()[0];

  // 创建崩溃测试实例（复用已下载的原版版本，创建很快）
  const insts = (await invoke(page, 'instances.list', {})).v;
  const base = insts.find((i) => i.loader === 'vanilla');
  if (!base) throw new Error('需要测试1创建的原版实例');
  const cInst = (await invoke(page, 'instances.create', { name: '崩溃测试', versionId: base.versionId, loader: 'vanilla' })).v;
  const instId = cInst.id;
  log('崩溃测试实例:', instId);

  // 故意设置极低内存
  await invoke(page, 'instances.setSettings', { id: instId, patch: { memory: 256 } });
  step('故意设置 256MB 内存', (await invoke(page, 'instances.getSettings', { id: instId })).v.memory === 256);

  // 启动并等待崩溃（监听 bb:launch-exit）
  await page.evaluate(() => {
    window.__exitEvents = [];
    window.bb.raw.on('bb:launch-exit', (e) => window.__exitEvents.push(e));
  });
  const launch = (await invoke(page, 'instances.launch', { id: instId })).v;
  log('启动 session:', launch.session);

  let exitEv = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 8 * 60 * 1000) {
    await sleep(5000);
    const evs = await page.evaluate(() => window.__exitEvents || []);
    exitEv = evs.find((e) => e.session === launch.session);
    if (exitEv) break;
    const alive = execSync('ps -eo command | grep -i java | grep -v grep || true').toString();
    if (!alive && !exitEv) { /* 进程没了但事件未到，再等一轮 */ }
  }
  step('游戏异常退出被捕获', !!exitEv, exitEv ? `code=${exitEv.code} crashed=${exitEv.crashed} lifetime=${(exitEv.lifetimeMs / 1000).toFixed(0)}s` : '超时未捕获');

  // 崩溃分析
  const analysis = (await invoke(page, 'crash.analyze', { instanceId: instId, since: Date.now() - 10 * 60 * 1000 })).v;
  log('分析结果:', JSON.stringify(analysis).slice(0, 300));
  if (analysis?.empty) {
    step('生成中文分析报告', false, analysis.message?.slice(0, 120));
  } else {
    const isOom = /内存不足|内存/.test(analysis.what || '');
    step('生成中文分析报告', !!analysis.what && isOom, analysis.what?.slice(0, 80));
    step('报告含"怎么解决"步骤', (analysis.fixes || []).length > 0);
    const memFix = (analysis.fixes || []).find((f) => f.action?.type === 'setMemory');
    if (memFix) {
      const fixed = (await invoke(page, 'crash.applyFix', { instanceId: instId, fix: memFix.action })).v;
      const memNow = (await invoke(page, 'instances.getSettings', { id: instId })).v.memory;
      step('一键调高内存到 4GB', memNow === 4096, `memory=${memNow} message=${fixed.message?.slice(0, 40)}`);
    } else {
      step('一键调高内存到 4GB', false, '报告中没有内存修复动作');
    }
  }
  await page.screenshot({ path: path.join(OUT, 't4-crash.png') });
  await browser.close();
} catch (e) {
  step('异常', false, String(e).slice(0, 300));
} finally {
  child.kill();
  await sleep(800);
  console.log('---- 测试4结果 ----');
  for (const s of report) console.log(`${s.ok ? '通过' : '失败'} | ${s.name} | ${s.note}`);
  fs.writeFileSync(path.join(OUT, 'test4-result.json'), JSON.stringify(report, null, 2));
  process.exit(0);
}
