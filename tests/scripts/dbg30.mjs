import { chromium } from 'playwright-core';
import path from 'path';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = browser.contexts()[0].pages()[0];
const DATA = '/var/folders/2t/ttl2zpb50173wjdkrjzbwc140000gn/T/方块 盒子(增强测试)';
const urls = ['https://piston-meta.mojang.com/mc/game/version_manifest_v2.json', 'https://api.modrinth.com/v2/search?limit=1', 'https://meta.fabricmc.net/v2/versions/loader'];
let ok = 0;
const t0 = Date.now();
for (const [i, u] of urls.entries()) {
  await page.evaluate(([u2, d]) => window.bb.raw.invoke('downloads.testDownload', { url: u2, dest: d }).then(() => 'ok').catch((e) => 'ERR:' + e.message.slice(0, 50)), [u, path.join(DATA, '并发-' + i + '.json')]).then((r) => { if (r === 'ok') ok++; else console.log('任务', i, r); });
}
console.log('并发下载完成:', ok + '/3，耗时', ((Date.now() - t0) / 1000).toFixed(1) + 's');
await browser.close(); process.exit(0);
