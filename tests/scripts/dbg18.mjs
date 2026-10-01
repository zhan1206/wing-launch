import { chromium } from 'playwright-core';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = browser.contexts()[0].pages()[0];
const inst = (await page.evaluate(async () => window.bb.raw.invoke('instances.list'))).v[0];
const r = await page.evaluate(async (id) => window.bb.raw.invoke('instances.launch', { id }), inst.id);
console.log('launch:', JSON.stringify(r).slice(0, 120));
await new Promise(r2 => setTimeout(r2, 25000));
await browser.close(); process.exit(0);
