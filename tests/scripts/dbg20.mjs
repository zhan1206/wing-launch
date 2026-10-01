import { chromium } from 'playwright-core';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = browser.contexts()[0].pages()[0];
const insts = (await page.evaluate(async () => window.bb.raw.invoke('instances.list'))).v;
const inst = insts.find(i => i.name === '崩溃测试');
if (!inst) { console.log('无崩溃测试实例'); process.exit(1); }
await page.evaluate(async (id) => window.bb.raw.invoke('instances.setSettings', { id, patch: { memory: 256 } }), inst.id);
const launch = (await page.evaluate(async (id) => window.bb.raw.invoke('instances.launch', { id }), inst.id)).v;
console.log('launched:', launch.session);
for (let i = 0; i < 144; i++) {
  await new Promise(r => setTimeout(r, 5000));
  const exits = await page.evaluate(() => window.__exits || []);
  const ev = exits.find(x => x.session === launch.session);
  if (ev) {
    console.log('EXIT code=' + ev.code + ' crashed=' + ev.crashed + ' lifetime=' + (ev.lifetimeMs / 1000) + 's');
    const oom = (ev.lastLines || []).join('\n').includes('OutOfMemoryError');
    console.log('OutOfMemoryError in output:', oom);
    console.log((ev.lastLines || []).slice(-6).join('\n'));
    const a = (await page.evaluate(async (id2) => window.bb.raw.invoke('crash.analyze', { instanceId: id2 }), inst.id)).v;
    console.log('分析:', JSON.stringify({ what: a.what, fixes: a.fixes?.map(f => f.text) }));
    if (a.fixes?.some(f => f.action?.type === 'setMemory')) {
      const fx = a.fixes.find(f => f.action?.type === 'setMemory');
      const r = (await page.evaluate(async (p) => window.bb.raw.invoke('crash.applyFix', p), { instanceId: inst.id, fix: fx.action })).v;
      const mem = (await page.evaluate(async (id2) => window.bb.raw.invoke('instances.getSettings', { id: id2 }), inst.id)).v.memory;
      console.log('一键修复后 memory =', mem, '→', r.message);
    }
    break;
  }
}
await browser.close(); process.exit(0);
