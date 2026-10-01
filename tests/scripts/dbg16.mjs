import { chromium } from 'playwright-core';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = browser.contexts()[0].pages()[0];
await page.evaluate(() => { window.__exits = []; window.bb.raw.on('bb:launch-exit', e => window.__exits.push(e)); });
const inst = (await page.evaluate(async () => window.bb.raw.invoke('instances.list'))).v[0];
console.log('instance:', inst?.id, inst?.versionId);
const launch = (await page.evaluate(async (id) => window.bb.raw.invoke('instances.launch', { id }), inst.id)).v;
console.log('session:', launch?.session);
for (let i = 0; i < 90; i++) {
  await new Promise(r => setTimeout(r, 5000));
  const exits = await page.evaluate(() => window.__exits || []);
  const ev = exits.find(x => x.session === launch?.session);
  if (ev) {
    console.log('exit:', JSON.stringify({ code: ev.code, crashed: ev.crashed, lifetime: ev.lifetimeMs }));
    console.log('lastLines:\n' + (ev.lastLines || []).slice(-25).join('\n'));
    break;
  }
  if (i % 6 === 5) {
    const alive = await page.evaluate(() => !!window.__exits);
    console.log('[waiting', i * 5, 's]');
  }
}
await browser.close(); process.exit(0);
