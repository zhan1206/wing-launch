import { chromium } from 'playwright-core';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9444');
const page = browser.contexts()[0].pages()[0];
await page.evaluate(() => { location.hash = '#/help'; });
await new Promise(r => setTimeout(r, 1800));
await page.screenshot({ path: 'test/screens/final-help.png' });
console.log('帮助页文本长度:', await page.evaluate(() => document.querySelector('#page')?.innerText?.length || 0));
console.log('侧边栏含帮助:', await page.evaluate(() => document.body.innerText.includes('帮助')));
await browser.close(); process.exit(0);
