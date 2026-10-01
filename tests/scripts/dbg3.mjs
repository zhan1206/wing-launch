import { chromium } from 'playwright-core';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = browser.contexts()[0].pages()[0];
const info = await page.evaluate(async () => {
  const out = {};
  out.ver = window.__APP_VERSION__;
  try { out.boot = (await window.bb.raw.invoke('bootstrap')).v; } catch (e) { out.bootErr = String(e).slice(0,200); }
  try { await import('./js/main.mjs'); out.import = 'ok'; } catch (e) { out.importErr = String(e).slice(0, 800); }
  return out;
});
console.log(JSON.stringify(info, null, 1));
await browser.close(); process.exit(0);
