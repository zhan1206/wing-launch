import { chromium } from 'playwright-core';
import path from 'path';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = browser.contexts()[0].pages()[0];
const DATA = '/var/folders/2t/ttl2zpb50173wjdkrjzbwc140000gn/T/方块 盒子(增强测试)';
const t0 = Date.now();
const r = await page.evaluate(([u, d]) => window.bb.raw.invoke('downloads.testDownload', { url: u, dest: d, sha1: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' }), ['https://piston-meta.mojang.com/mc/game/version_manifest_v2.json', path.join(DATA, '校验失败测试.json')]).then(() => 'resolved').catch((e) => 'rejected: ' + e.message);
console.log('校验失败用例 →', r, '(took', Date.now() - t0, 'ms)');
await browser.close(); process.exit(0);
