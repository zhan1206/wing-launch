import { chromium } from 'playwright-core';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = browser.contexts()[0].pages()[0];
await new Promise(r=>setTimeout(r,600));
const raw = await page.evaluate(() => window.bb.raw.invoke('accounts.list'));
console.log('raw:', JSON.stringify(raw).slice(0, 300));
await browser.close(); process.exit(0);
