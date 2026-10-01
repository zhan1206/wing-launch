import { spawn } from 'child_process';
import { chromium } from 'playwright-core';
import http from 'http';
import path from 'path';
import fs from 'fs';
const ROOT = process.cwd();
const DATA = fs.readdirSync('/var/folders/2t/ttl2zpb50173wjdkrjzbwc140000gn/T').filter(d => d.startsWith('bb-r3-')).map(d => '/var/folders/2t/ttl2zpb50173wjdkrjzbwc140000gn/T/' + d)[0];
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    console.log('[mock] hit:', req.url, 'body len', body.length);
    try {
      const rq = JSON.parse(body);
      const src = JSON.parse(rq.messages[1].content);
      const out = {};
      for (const [k, v] of Object.entries(src)) out[k] = '【译】' + v;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(out) } }] }));
    } catch (e) { console.log('[mock] parse err', e.message); res.end('{}'); }
  });
});
await new Promise((r) => mock.listen(7445, '127.0.0.1', r));
const child = spawn(path.join(ROOT, 'node_modules/.bin/electron'), ['.', '--remote-debugging-port=9333'], { cwd: ROOT, env: { ...process.env, BLOCKBOX_DATA_DIR: DATA }, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 8000));
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = browser.contexts()[0].pages()[0];
await page.evaluate(async () => window.bb.raw.invoke('settings.set', { translate: { apiBase: 'http://127.0.0.1:7445', model: 'test', apiKey: 'test-key-123456' } }));
const test = await page.evaluate(async () => window.bb.raw.invoke('translate.testKey'));
console.log('testKey:', JSON.stringify(test.v || test));
const inst = (await page.evaluate(async () => window.bb.raw.invoke('instances.list'))).v[0];
const tr = await page.evaluate(async (p) => window.bb.raw.invoke('translate.start', p), { jarPath: path.join(ROOT, 'test/fixtures/trans-test.jar'), instanceId: inst.id });
await new Promise(r => setTimeout(r, 12000));
const res = await page.evaluate(async (t) => window.bb.raw.invoke('translate.result', { taskId: t }), tr.v.taskId);
console.log('result:', JSON.stringify(res.v).slice(0, 200));
const tm = await page.evaluate(async () => window.bb.raw.invoke('translate.tmExport'));
console.log('tm 条数:', Object.keys(tm.v || {}).length);
await browser.close(); mock.close(); child.kill(); process.exit(0);
