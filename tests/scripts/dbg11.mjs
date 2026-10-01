import { chromium } from 'playwright-core';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = browser.contexts()[0].pages()[0];
const r = await page.evaluate(async () => window.bb.raw.invoke('instances.list'));
console.log(JSON.stringify(r).slice(0, 500));
await browser.close(); process.exit(0);
