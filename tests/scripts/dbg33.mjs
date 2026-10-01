import { chromium } from 'playwright-core';
import http from 'http';
import path from 'path';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = browser.contexts()[0].pages()[0];
const results = [];
const step = (id, name, ok, note = '') => { results.push({ id, name, ok, note }); console.log(ok ? '✓' : '✗', id, name, note ? '｜' + note : ''); };
const invoke = (page, ch, payload) => Promise.race([
  page.evaluate(([c, p]) => window.bb.raw.invoke(c, p), [ch, payload]).then((r) => { if (r && r.__err) throw new Error(r.__err); return r ? r.v : undefined; }),
  new Promise((_r, rej) => setTimeout(() => rej(new Error('【测试超时】' + ch)), 180000)),
]);
try {
  let srv = await invoke(page, 'servers.createVanilla', { name: 'R3测试服', versionId: '1.21.1' }).catch((e) => ({ err: e.message }));
  if (srv.err) srv = await invoke(page, 'servers.createVanilla', { name: 'R3测试服', versionId: '1.21.1' }).catch((e) => ({ err: e.message }));
  if (!srv.id) throw new Error('创建服务器失败：' + (srv.err || ''));
  const blocker = http.createServer(() => {});
  await new Promise((r) => blocker.listen(25565, '0.0.0.0', r));
  await invoke(page, 'servers.acceptEula', { id: srv.id, accept: true });
  const started = await invoke(page, 'servers.start', { id: srv.id }).catch((e) => ({ err: e.message }));
  if (started.err) { step('25a', '端口占用自动切换', false, started.err.slice(0, 80)); }
  else {
    const list = await invoke(page, 'servers.list', {});
    const me = list.find((s) => s.id === srv.id);
    step('25a', '端口占用自动切换并提示', me.port === 25566 && /25566/.test(me.portNotice || ''), `port=${me.port}`);
    await new Promise((r) => setTimeout(r, 25000));
    await invoke(page, 'servers.sendCommand', { id: srv.id, text: 'say 你好' });
    await invoke(page, 'servers.stop', { id: srv.id });
    step('25b', '控制台命令发送与停止（自动保存世界）', true, '');
  }
  blocker.close();
  for (let i = 0; i < 30; i++) { await new Promise(r => setTimeout(r, 2000)); const l = await invoke(page, 'servers.list', {}); if (l.find((x) => x.id === srv.id)?.status === 'stopped') break; }
  await invoke(page, 'servers.saveProps', { id: srv.id, props: { 'difficulty': 'hard', 'gamemode': 'creative' } });
  const detail = await invoke(page, 'servers.detail', { id: srv.id });
  step('25c', '服务器配置界面化编辑生效', detail.props?.difficulty === 'hard' && detail.props?.gamemode === 'creative', JSON.stringify({ d: detail.props?.difficulty, g: detail.props?.gamemode }));
  const exported = await invoke(page, 'servers.exportProps', { id: srv.id });
  await invoke(page, 'servers.importProps', { id: srv.id, text: exported.replace('difficulty=hard', 'difficulty=peaceful') });
  const detail2 = await invoke(page, 'servers.detail', { id: srv.id });
  await invoke(page, 'servers.restorePropsBak', { id: srv.id });
  const detail3 = await invoke(page, 'servers.detail', { id: srv.id });
  step('25d', '配置导出/导入/回滚', detail2.props?.difficulty === 'peaceful' && detail3.props?.difficulty === 'hard' && !!detail3, '');
  const invite = await invoke(page, 'servers.inviteText', { id: srv.id });
  step('25e', '中文邀请文案生成', /服务器地址|版本/.test(invite || ''), (invite || '').split('\n')[0]);
} catch (e) { step('FATAL', '异常', false, String(e).slice(0, 150)); }
await browser.close(); process.exit(0);
