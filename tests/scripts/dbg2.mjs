import { chromium } from 'playwright-core';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = browser.contexts()[0].pages()[0];
const info = await page.evaluate(async () => {
  const out = { ver: window.__APP_VERSION__, hash: location.hash, sidebar: document.querySelectorAll('#sidebar .nav-item').length, pageText: document.querySelector('#page')?.innerText?.slice(0, 80) };
  try { out.boot = await window.bb.raw.invoke('bootstrap'); } catch (e) { out.bootErr = String(e).slice(0, 200); }
  try { out.set = await window.bb.raw.invoke('settings.get'); } catch (e) { out.setErr = String(e).slice(0, 200); }
  return out;
});
console.log(JSON.stringify(info, null, 1));
// 手动触发一次 route
await page.evaluate(() => { window.dispatchEvent(new Event('hashchange')); });
await new Promise(r => setTimeout(r, 2000));
console.log('after hashchange:', await page.evaluate(() => document.querySelector('#page')?.innerText?.slice(0, 100)));
await browser.close(); process.exit(0);
