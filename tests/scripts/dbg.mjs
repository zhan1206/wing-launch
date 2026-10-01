import { spawn } from 'child_process';
import { chromium } from 'playwright-core';
import path from 'path';
const ROOT = path.resolve(import.meta.dirname, '..');
const child = spawn(path.join(ROOT, 'node_modules/.bin/electron'), ['.', '--remote-debugging-port=9333'], { cwd: ROOT, stdio: ['ignore','pipe','pipe'] });
child.stderr.on('data', d=>console.log('[err]', d.toString().slice(0,300)));
await new Promise(r=>setTimeout(r,6000));
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = browser.contexts()[0].pages()[0];
const info = await page.evaluate(async () => {
  const out = {};
  out.hasBB = !!window.bb;
  try { out.bootstrap = await window.bb.raw.invoke('bootstrap'); } catch (e) { out.bootstrapErr = String(e); }
  try { await import('./js/main.mjs'); out.mainImport = 'ok'; } catch (e) { out.mainImportErr = String(e).slice(0,600); }
  return out;
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
child.kill();
process.exit(0);
