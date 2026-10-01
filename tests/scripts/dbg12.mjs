import { chromium } from 'playwright-core';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = browser.contexts()[0].pages()[0];
const r = await page.evaluate(async () => window.bb.raw.invoke('instances.create', { name: '直测实例', versionId: '1.21.1', loader: 'vanilla' }));
console.log('create:', JSON.stringify(r).slice(0, 160));
const r2 = await page.evaluate(async () => window.bb.raw.invoke('instances.list'));
console.log('list:', JSON.stringify(r2).slice(0, 200));
await browser.close(); process.exit(0);
