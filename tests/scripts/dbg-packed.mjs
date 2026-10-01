import { chromium } from 'playwright-core';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9444');
const page = browser.contexts()[0].pages()[0];
await page.screenshot({ path: 'test/screens/t7-packed-app.png' });
const boot = await page.evaluate(async () => window.bb.raw.invoke('bootstrap'));
console.log('打包应用 bootstrap:', JSON.stringify(boot.v).slice(0, 160));
console.log('侧边栏导航项:', await page.evaluate(() => document.querySelectorAll('#sidebar .nav-item').length));
console.log('页面文本长度:', await page.evaluate(() => document.querySelector('#page')?.innerText?.length || 0));
await browser.close(); process.exit(0);
