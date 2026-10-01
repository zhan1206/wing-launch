import { chromium } from 'playwright-core';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = browser.contexts()[0].pages()[0];
const r = await page.evaluate(async () => window.bb.raw.invoke('translate.start', { jarPath: '/Users/jianweizhu/Desktop/我的世界启动器/test/fixtures/test-mod.jar', instanceId: 'x' }));
console.log('translate.start →', JSON.stringify(r).slice(0, 200));
const cfg = await page.evaluate(async () => window.bb.raw.invoke('settings.get'));
console.log('apiKey =', JSON.stringify(cfg.v?.translate?.apiKey));
await browser.close(); process.exit(0);
