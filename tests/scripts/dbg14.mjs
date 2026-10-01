import { chromium } from 'playwright-core';
import { execSync } from 'child_process';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = browser.contexts()[0].pages()[0];
page.on('console', m => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 200)); });
console.log('hash0:', await page.evaluate(() => location.hash));
if (await page.evaluate(() => !!document.querySelector('#ob-next'))) {
  await page.click('#ob-next'); await page.click('#ob-next'); await new Promise(r=>setTimeout(r,500));
  await page.fill('#ob-offline-name', 'BlockBoxTester');
  await page.click('#ob-offline-add'); await new Promise(r=>setTimeout(r,2500));
  await page.click('#ob-next'); await new Promise(r=>setTimeout(r,3500));
}
await page.evaluate(() => { const c = [...document.querySelectorAll('.card.hoverable')]; (c[0] || document.body).click(); });
for (let i = 0; i < 150; i++) {
  await new Promise(r=>setTimeout(r,4000));
  const st = await page.evaluate(async () => {
    const r = await window.bb.raw.invoke('instances.list').catch(e => ({ err: String(e) }));
    return { hash: location.hash, len: (r.v || []).length, first: JSON.stringify((r.v || [])[0] || null).slice(0, 80), raw: JSON.stringify(r).slice(0, 100) };
  });
  console.log('[' + i + ']', JSON.stringify(st));
  if (st.len >= 1 || st.hash !== '#/onboarding') break;
}
await browser.close(); process.exit(0);
