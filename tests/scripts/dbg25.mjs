import { chromium } from 'playwright-core';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = browser.contexts()[0].pages()[0];
const dls = await page.evaluate(async () => window.bb.raw.invoke('downloads.list'));
for (const t of dls.v) console.log(t.state, '|', t.name, '|', t.received + '/' + t.total, '|', (t.error || '').slice(0, 60));
await browser.close(); process.exit(0);
