import { chromium } from 'playwright-core';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = browser.contexts()[0].pages()[0];
const insts = (await page.evaluate(async () => window.bb.raw.invoke('instances.list'))).v;
const inst = insts.find(i => i.name === '崩溃测试');
// 导入一个真实存档用于 quickPlay
const imp = await page.evaluate(async (p) => window.bb.raw.invoke('worlds.importFiles', p), { instanceId: inst.id, paths: ['/Users/jianweizhu/Desktop/我的世界启动器/test/fixtures/测试存档'] });
console.log('存档导入:', JSON.stringify(imp.v));
await page.evaluate(async (p) => window.bb.raw.invoke('instances.setSettings', p), { id: inst.id, patch: { memory: 192, quickPlayWorld: '测试存档' } });
await page.evaluate(() => { window.__exits = []; window.bb.raw.on('bb:launch-exit', e => window.__exits.push(e)); });
const launch = (await page.evaluate(async (id) => window.bb.raw.invoke('instances.launch', { id }), inst.id)).v;
console.log('launched:', launch.session);
for (let i = 0; i < 60; i++) {
  await new Promise(r => setTimeout(r, 5000));
  const ev = (await page.evaluate(() => window.__exits)).find(x => x.session === launch.session);
  if (ev) {
    console.log('EXIT code=' + ev.code + ' lifetime=' + (ev.lifetimeMs / 1000) + 's OOM=' + (ev.lastLines || []).join('\n').includes('OutOfMemoryError'));
    const a = (await page.evaluate(async (id2) => window.bb.raw.invoke('crash.analyze', { instanceId: id2, since: Date.now() - 20 * 60 * 1000 }), inst.id)).v;
    console.log('分析 what:', a.what);
    console.log('fixes:', JSON.stringify((a.fixes || []).map(f => ({ t: f.text, a: f.action }))));
    const fx = (a.fixes || []).find(f => f.action?.type === 'setMemory');
    if (fx) {
      const r = (await page.evaluate(async (p) => window.bb.raw.invoke('crash.applyFix', p), { instanceId: inst.id, fix: fx.action })).v;
      const mem = (await page.evaluate(async (id2) => window.bb.raw.invoke('instances.getSettings', { id: id2 }), inst.id)).v.memory;
      console.log('一键修复 → memory=' + mem + ' (' + (r.message || '') + ')');
    }
    break;
  }
}
await browser.close(); process.exit(0);
