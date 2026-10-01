import { chromium } from 'playwright-core';
import { execSync } from 'child_process';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = browser.contexts()[0].pages()[0];
page.on('console', m => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 220)); });
await page.click('#ob-next'); await page.click('#ob-next'); await new Promise(r=>setTimeout(r,500));
await page.fill('#ob-offline-name', 'BlockBoxTester');
await page.click('#ob-offline-add'); await new Promise(r=>setTimeout(r,2500));
console.log('account added:', await page.evaluate(() => document.body.innerText.includes('✅')));
await page.click('#ob-next'); await new Promise(r=>setTimeout(r,3500));
console.log('cards:', await page.evaluate(() => document.querySelectorAll('.card.hoverable').length));
const watch = setInterval(() => {
  try {
    const out = execSync('cat "$HOME/Library/Application Support/BlockBox/instances.json" 2>/dev/null | head -c 60').toString();
    if (out) { console.log('FILE APPEARED:', out.trim()); clearInterval(watch); }
  } catch {}
}, 1500);
await page.evaluate(() => { const c = [...document.querySelectorAll('.card.hoverable')]; (c[0] || c[1] || document.body).click(); });
for (let i = 0; i < 60; i++) {
  await new Promise(r=>setTimeout(r,3000));
  const hash = await page.evaluate(() => location.hash);
  const list = await page.evaluate(async () => window.bb.raw.invoke('instances.list'));
  const n = (list.v || []).length;
  console.log('[t+' + i * 3 + 's] hash=' + hash + ' instances=' + n);
  if (hash !== '#/onboarding' || n > 0) break;
}
await new Promise(r=>setTimeout(r,2000));
clearInterval(watch);
const body = await page.evaluate(() => document.body.innerText);
const m = body.match(/(失败|错误|Error|Java)[^\n]{0,90}/);
console.log('提示:', m ? m[0] : '(无)');
await browser.close(); process.exit(0);
