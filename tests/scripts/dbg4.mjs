import { chromium } from 'playwright-core';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = browser.contexts()[0].pages()[0];
const info = await page.evaluate(() => ({ hash: location.hash, ver: window.__APP_VERSION__, text: document.querySelector('#page')?.innerText?.slice(0, 150), onboarding: !!document.querySelector('#ob-skip') }));
console.log(JSON.stringify(info, null, 1));
await browser.close(); process.exit(0);
