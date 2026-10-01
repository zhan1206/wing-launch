import { chromium } from 'playwright-core';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = browser.contexts()[0].pages()[0];
const boot = await page.evaluate(() => window.bb.raw.invoke('bootstrap'));
console.log('bootstrap:', JSON.stringify(boot.v || boot).slice(0, 200));
const acc = await page.evaluate(() => window.bb.raw.invoke('accounts.list'));
console.log('accounts:', JSON.stringify(acc).slice(0, 200));
await browser.close(); process.exit(0);
