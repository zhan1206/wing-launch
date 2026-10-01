import { chromium } from 'playwright-core';
import { execSync } from 'child_process';
import fs from 'fs';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = browser.contexts()[0].pages()[0];
const inst = (await page.evaluate(async () => window.bb.raw.invoke('instances.list'))).v[0];
await page.evaluate(async (id) => window.bb.raw.invoke('instances.launch', { id }), inst.id);
for (let i = 0; i < 24; i++) {
  await new Promise(r => setTimeout(r, 5000));
  const out = execSync('ps -eo pid,command | grep "bin/java" | grep -v grep || true').toString().trim();
  if (out) {
    fs.writeFileSync('/tmp/mc-cmd.txt', out.split('\n')[0]);
    console.log('captured java pid+cmd → /tmp/mc-cmd.txt, len=', out.length);
    break;
  }
}
await browser.close(); process.exit(0);
