import { chromium } from 'playwright-core';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
console.log('contexts:', browser.contexts().length, 'pages:', browser.contexts()[0].pages().length);
for (const p of browser.contexts()[0].pages()) console.log('page url:', p.url().slice(0, 60));
await browser.close(); process.exit(0);
