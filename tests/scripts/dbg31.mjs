import { chromium } from 'playwright-core';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = browser.contexts()[0].pages()[0];
const j = await page.evaluate(async () => {
  const list = (await window.bb.raw.invoke('java.list')).v || [];
  const ensured = await window.bb.raw.invoke('java.ensure', { major: 21 }).catch((e) => ({ err: e.message }));
  return { list, ensured };
});
console.log('list:', JSON.stringify(j.list));
console.log('ensure:', JSON.stringify(j.ensured).slice(0, 200));
await browser.close(); process.exit(0);
