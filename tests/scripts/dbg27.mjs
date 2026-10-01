import { chromium } from 'playwright-core';
import fs from 'fs';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = browser.contexts()[0].pages()[0];
const dest = '/tmp/校验探测2.json';
fs.rmSync(dest, { force: true });
const url = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
// 不等待 promise 落定，轮询任务最终状态
const p = page.evaluate(([u, d]) => window.bb.raw.invoke('downloads.testDownload', { url: u, dest: d, sha1: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' }).catch((e) => 'REJECTED: ' + e.message), [url, dest]);
let final = '';
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 500));
  const list = await page.evaluate(async () => window.bb.raw.invoke('downloads.list'));
  const t = (list.v || []).find((x) => x.dest === dest) || (list.v || []).find((x) => x.name === '测试下载');
  if (t && (t.state === 'error' || t.state === 'done')) { final = t.state + ' | ' + (t.error || ''); break; }
}
const out = await p;
console.log('FINAL:', final || JSON.stringify(out).slice(0, 150));
await browser.close(); process.exit(0);
