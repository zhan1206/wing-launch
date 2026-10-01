import { chromium } from 'playwright-core';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = browser.contexts()[0].pages()[0];
page.on('console', m => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 250)); });
await page.click('#ob-next'); await page.click('#ob-next'); await new Promise(r=>setTimeout(r,600));
await page.fill('#ob-offline-name', 'BlockBoxTester');
await page.click('#ob-offline-add');
await new Promise(r=>setTimeout(r,4000));
const st = await page.evaluate(() => ({
  text: document.body.innerText.slice(0, 600),
  accounts: null,
}));
const accs = await page.evaluate(async () => (await window.bb.raw.invoke('accounts.list')).v);
console.log('accounts:', JSON.stringify(accs));
console.log('has ✅:', st.text.includes('✅'));
console.log(st.text.split('\n').slice(10, 30).join(' | '));
await browser.close(); process.exit(0);
