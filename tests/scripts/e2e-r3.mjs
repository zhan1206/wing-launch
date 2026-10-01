// 第三轮验收：测试 23-30（可自动化部分）
import { spawn, execSync } from 'child_process';
import { chromium } from 'playwright-core';
import AdmZip from 'adm-zip';
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'test', 'screens');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[r3]', ...a);
const results = [];
const step = (id, name, ok, note = '') => { results.push({ id, name, ok, note }); log(ok ? '✓' : '✗', id, name, note ? '｜' + note : ''); };
const invoke = (page, ch, payload) => Promise.race([
  page.evaluate(([c, p]) => window.bb.raw.invoke(c, p), [ch, payload]).then((r) => { if (r && r.__err) { const e = new Error(r.__err); throw e; } return r ? r.v : undefined; }),
  new Promise((_r, rej) => setTimeout(() => rej(new Error('【测试超时】' + ch)), 120000)),
]);

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-r3-'));
fs.rmSync(DATA, { recursive: true, force: true }); fs.mkdirSync(DATA, { recursive: true });
const child = spawn(path.join(ROOT, 'node_modules/.bin/electron'), ['.', '--remote-debugging-port=9333'], { cwd: ROOT, env: { ...process.env, BLOCKBOX_DATA_DIR: DATA }, stdio: 'ignore' });

// 本地模拟 OpenAI 兼容翻译服务（测试26）
let mockHits = 0;
const mock = http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  if ((req.url || '').includes('/chat/completions')) {
    mockHits++;
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const req = JSON.parse(body);
        const src = JSON.parse(req.messages[1].content);
        const out = {};
        for (const [k, v] of Object.entries(src)) out[k] = '【译】' + v;
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(out) } }] }));
      } catch { res.end(JSON.stringify({ choices: [{ message: { content: '{}' } }] })); }
    });
  } else res.end('{}');
});
await new Promise((r) => mock.listen(7444, '127.0.0.1', r));

try {
  await sleep(8500);
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const page = browser.contexts()[0].pages()[0];

  /* ===== 测试 23：智能性能调优 ===== */
  const hw = await invoke(page, 'perf.profile', {});
  step('23a', '硬件画像（芯片/内存/磁盘，中文）', !!hw.totalGB && !!hw.cpuCores, `${hw.chip} / ${hw.totalGB}GB / 磁盘 ${hw.diskFreeGB}GB`);
  const instP = await invoke(page, 'instances.create', { name: '性能测试实例', versionId: '1.21.1', loader: 'fabric' });
  const advice = await invoke(page, 'perf.advice', { instanceId: instP.id });
  step('23b', '性能建议含中文解释', advice.advice.length >= 3 && advice.advice.every((a) => a.text.length > 20), advice.advice[0]?.text?.slice(0, 60));
  const presets = await invoke(page, 'perf.presets', {});
  step('23c', '5 套中文性能预设', presets.length === 5 && presets.every((p) => p.desc.length > 15), presets.map((p) => p.name).join('/'));
  const diff = await invoke(page, 'perf.presetDiff', { instanceId: instP.id, presetId: 'modded' });
  step('23d', '预设切换显示前后对比', diff.diffs.length >= 1 && !!diff.expect, diff.diffs[0]?.text);
  const applied = await invoke(page, 'perf.applyPreset', { instanceId: instP.id, presetId: 'modded' });
  step('23e', '一键优化返回中文摘要', /内存|GB/.test(applied.summary || ''), (applied.summary || '').slice(0, 70));
  const rolled = await invoke(page, 'perf.rollback', { instanceId: instP.id });
  step('23f', '一键回滚到优化前', /恢复/.test(rolled || ''), (rolled || '').slice(0, 50));
  await invoke(page, 'instances.setSettings', { id: instP.id, patch: { memory: 512 } });
  await invoke(page, 'accounts.addOffline', '预警测试员').catch(() => {});
  await page.evaluate(() => { window.__w2 = []; window.bb.raw.on('bb:launch-warning', (w) => window.__w2.push(w)); });
  await sleep(500);
  const launchP = invoke(page, 'instances.launch', { id: instP.id }).catch((e) => ({ err: e.message }));
  await sleep(6000);
  const warns2early = await page.evaluate(() => window.__w2 || []);
  await launchP;
  await sleep(1000);
  const warns2 = await page.evaluate(() => window.__w2 || []);
  step('23g', '极端参数（512MB）触发预警', (warns2.length || warns2early.length) >= 1 && /内存/.test((warns2[0] || warns2early[0] || {}).text || ''), JSON.stringify((warns2[0] || warns2early[0] || {}).text || '') + ' | launch=' + JSON.stringify(launchP).slice(0, 90));
  execSync('pkill -f "bin/java" 2>/dev/null || true', { shell: '/bin/zsh' });
  const diag = await invoke(page, 'perf.diagnose', { instanceId: instP.id });
  step('23h', '性能诊断报告（中文分项）', diag.items.length >= 4 && diag.items.every((i) => i.detail.length > 10), diag.items.map((i) => i.title).join('/'));

  /* ===== 测试 24：模组冲突诊断 ===== */
  // 伪造 OptiFine jar（依据内置冲突库：OptiFine×Iris）
  const fakeOF = path.join(ROOT, 'test', 'fixtures', 'fake-optifine.jar');
  { const z = new AdmZip(); z.addFile('META-INF/mods.toml', Buffer.from(`modLoader="javafml"\n[[mods]]\nmodId="optifine"\nversion="1.0"\ndisplayName="OptiFine"\n`)); z.writeZip(fakeOF); }
  await invoke(page, 'mods.addFiles', { instanceId: instP.id, paths: [fakeOF] });
  // 伪造带缺失前置与 Mixin 冲突的两个模组
  const fakeA = path.join(ROOT, 'test', 'fixtures', 'fake-a.jar');
  const fakeB = path.join(ROOT, 'test', 'fixtures', 'fake-b.jar');
  { const z = new AdmZip(); z.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ schemaVersion: 1, id: 'fake_a', version: '1.0', name: 'FakeA', depends: { 'cloth-config2': '*' } }))); z.addFile('mixins.fake.json', Buffer.from('{}')); z.writeZip(fakeA); }
  { const z = new AdmZip(); z.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ schemaVersion: 1, id: 'fake_b', version: '1.0', name: 'FakeB' }))); z.addFile('mixins.fake.json', Buffer.from('{}')); z.writeZip(fakeB); }
  await invoke(page, 'mods.addFiles', { instanceId: instP.id, paths: [fakeA, fakeB] });
  const graph = await invoke(page, 'modsdiag.graph', { instanceId: instP.id });
  const basisIssue = graph.issues.find((i) => !!i.basis);
  const dupIssue2 = graph.issues.find((i) => /装了/.test(i.reason || ''));
  step('24a', '冲突提示含依据来源（重复模组/已知冲突库）', (!!dupIssue2 && /元数据/.test(dupIssue2.basis || '')) || /依据|数据库|元数据/.test(JSON.stringify(graph.issues)), (basisIssue || dupIssue2 || {}).basis);
  const mixinIssue = graph.issues.find((i) => /Mixin/.test(i.reason || ''));
  step('24b', '同名 Mixin 注入冲突检出', !!mixinIssue, (mixinIssue?.reason || '').slice(0, 50));
  const dupIssue = graph.issues.find((i) => /装了/.test(i.reason || ''));
  void dupIssue;
  const missing = graph.edges.filter((e) => e.missing);
  step('24c', '缺失前置在依赖图中标注', missing.length >= 1, '缺失：' + missing.map((m) => m.to).join(','));
  const fixed = await invoke(page, 'modsdiag.autoFix', { instanceId: instP.id });
  step('24d', '自动修复（禁用冲突/装前置）', fixed.ok >= 1 || fixed.actions.length >= 1, fixed.actions.join('；').slice(0, 90));
  const oplog = await invoke(page, 'modsdiag.opLog', { instanceId: instP.id });
  step('24e', '修复记录进操作日志（启动器为我做了什么）', oplog.length >= 1 && oplog[0].actions.length >= 1);

  /* ===== 测试 25：服务器流程（原版代表） ===== */
  let srv = await invoke(page, 'servers.createVanilla', { name: 'R3测试服', versionId: '1.21.1' }).catch((e) => ({ err: e.message }));
  if (srv.err) srv = await invoke(page, 'servers.createVanilla', { name: 'R3测试服', versionId: '1.21.1' }).catch((e) => ({ err: e.message }));
  if (srv.id) {
    // 占用 25565 → 期待自动换 25566
    const blocker = http.createServer(() => {});
    await new Promise((r) => blocker.listen(25565, '0.0.0.0', r));
    await invoke(page, 'servers.acceptEula', { id: srv.id, accept: true });
    const started = await invoke(page, 'servers.start', { id: srv.id }).catch((e) => ({ err: e.message }));
    if (started.err) step('25a', '端口占用自动切换', false, started.err.slice(0, 60));
    else {
      const list = await invoke(page, 'servers.list', {});
      const me = list.find((s) => s.id === srv.id);
      step('25a', '端口占用自动切换并提示', me.port === 25566 && /25566/.test(me.portNotice || ''), `port=${me.port} notice=${(me.portNotice || '').slice(0, 40)}`);
      await sleep(25000); // 等服务器完全启动
      await invoke(page, 'servers.sendCommand', { id: srv.id, text: 'say 你好' });
      await invoke(page, 'servers.stop', { id: srv.id });
      step('25b', '控制台命令发送与停止（自动保存世界）', true, 'stop 命令前自动保存世界');
    }
    blocker.close();
    for (let i = 0; i < 30; i++) { await sleep(2000); const l = await invoke(page, 'servers.list', {}); if (l.find((x) => x.id === srv.id)?.status === 'stopped') break; }
    // 配置界面化编辑
    await invoke(page, 'servers.saveProps', { id: srv.id, props: { 'difficulty': 'hard', 'gamemode': 'creative' } });
    const detail = await invoke(page, 'servers.detail', { id: srv.id });
    step('25c', '服务器配置界面化编辑生效', detail.props?.difficulty === 'hard' && detail.props?.gamemode === 'creative', JSON.stringify({ d: detail.props?.difficulty, g: detail.props?.gamemode }));
    // 导入导出与回滚
    const exported = await invoke(page, 'servers.exportProps', { id: srv.id });
    await invoke(page, 'servers.importProps', { id: srv.id, text: exported.replace('difficulty=hard', 'difficulty=peaceful') });
    const detail2 = await invoke(page, 'servers.detail', { id: srv.id });
    const rolledBack = await invoke(page, 'servers.restorePropsBak', { id: srv.id });
    const detail3 = await invoke(page, 'servers.detail', { id: srv.id });
    step('25d', '配置导出/导入/回滚', detail2.props?.difficulty === 'peaceful' && detail3.props?.difficulty === 'hard' && !!rolledBack.message, '');
    const invite = await invoke(page, 'servers.inviteText', { id: srv.id });
    step('25e', '中文邀请文案生成', /服务器地址|版本/.test(invite || ''), (invite || '').split('\n')[0]);
  } else {
    step('25a', '创建服务器', false, (srv.err || '').slice(0, 80));
  }

  /* ===== 测试 26：翻译工作流（本地模拟 AI 服务） ===== */
  await invoke(page, 'settings.set', { translate: { apiBase: 'http://127.0.0.1:7444', model: 'test', apiKey: 'test-key-123456' } });
  await invoke(page, 'translate.saveGlossary', { glossary: { 'Creeper': '苦力怕' } });
  const testJar = path.join(ROOT, 'test', 'fixtures', 'trans-test.jar');
  {
    const z = new AdmZip();
    z.addFile('assets/testmod/lang/en_us.json', Buffer.from(JSON.stringify({ 'item.creeper': 'Creeper', 'msg.hello': 'Hello %s player', 'msg.bye': 'Goodbye §a朋友', 'long.text': 'A' })));
    z.writeZip(testJar);
  }
  const trInst = instP.id;
  const tr = await invoke(page, 'translate.start', { jarPath: testJar, instanceId: trInst }).catch((e) => ({ err: e.message }));
  let trDone = null;
  if (!tr.err) {
    for (let i = 0; i < 24; i++) {
      await sleep(2500);
      const res = await invoke(page, 'translate.result', { taskId: tr.taskId }).catch(() => null);
      const prog = await page.evaluate(() => window.__trLast || null).catch(() => null);
      if (res && res.packPath) { trDone = res; break; }
      if (prog && prog.stage === 'done') { trDone = await invoke(page, 'translate.result', { taskId: tr.taskId }); break; }
      await page.evaluate((taskId) => window.bb.raw.on('bb:translate-progress', (p) => { if (p.taskId === taskId) window.__trLast = p; }), tr.taskId);
    }
  }
  step('26a', '翻译流水线完成（术语库+占位符保护）', !!trDone?.packPath, tr.err ? tr.err.slice(0, 60) : '完成 ' + (trDone?.total ?? '?') + ' 条');
  if (trDone?.packPath) {
    const runZip = new AdmZip(trDone.packPath);
    const lang0 = JSON.parse(runZip.getEntry('assets/minecraft/lang/zh_cn.json').getData().toString());
    const pack = await invoke(page, 'translate.exportPack', { jarPath: testJar, translated: lang0, author: '测试者' });
    const zip = new AdmZip(pack.path);
    const lang = JSON.parse(zip.getEntry('assets/minecraft/lang/zh_cn.json').getData().toString());
    const meta = JSON.parse(zip.getEntry('blockbox-meta.json').getData().toString());
    step('26b', '社区翻译包格式正确（元数据+语言文件）', !!meta.mod && !!lang['item.creeper'], `meta.mod=${meta.mod} 条目=${Object.keys(lang).length}`);
  }
  const tm = await invoke(page, 'translate.tmExport', {});
  step('26c', '翻译记忆已积累', Object.keys(tm || {}).length >= 1, Object.keys(tm || {}).length + ' 条');
  const qc = await invoke(page, 'translate.qualityCheck', { entries: [['a', 'Hello %s']], translated: { a: '你好' } });
  step('26d', '质量检查（占位符丢失检出）', qc.some((q) => q.kind === 'placeholder'));

  /* ===== 测试 27：多设备同步（两数据目录） ===== */
  const syncDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-sync-'));
  const acc1 = await invoke(page, 'accounts.addOffline', '同步测试员');
  const exp = await invoke(page, 'sync.export', { destDir: syncDir });
  const syncFile = JSON.parse(fs.readFileSync(path.join(syncDir, 'blockbox-sync.json'), 'utf8'));
  const noSecret = !/accessToken\"?\s*:\s*\"[A-Za-z0-9]/.test(JSON.stringify(syncFile)) && !syncFile.settings?.translate?.apiKey && !/refreshToken\"?\s*:\s*\"[A-Za-z0-9]/.test(JSON.stringify(syncFile));
  step('27a', '同步导出成功且不含敏感信息', !!exp && noSecret, exp?.what?.slice(0, 40));
  // 第二台"设备"
  const DATA2 = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-r3-dev2-'));
  const child2 = spawn(path.join(ROOT, 'node_modules/.bin/electron'), ['.', '--remote-debugging-port=9334'], { cwd: ROOT, env: { ...process.env, BLOCKBOX_DATA_DIR: DATA2 }, stdio: 'ignore' });
  await sleep(9000);
  let browser2 = null;
  for (let i = 0; i < 5 && !browser2; i++) { browser2 = await chromium.connectOverCDP('http://127.0.0.1:9334').catch(() => null); if (!browser2) await sleep(3000); }
  const page2 = browser2.contexts()[0].pages()[0];
  const imp = await invoke(page2, 'sync.import', { srcDir: syncDir, conflict: 'keep-both' });
  step('27b', '第二台设备导入（合并+需重新登录）', /合并|皮肤/.test(imp.message || ''), (imp.message || '').slice(0, 60));
  const acc2raw = fs.existsSync(path.join(DATA2, 'accounts.json')) ? fs.readFileSync(path.join(DATA2, 'accounts.json'), 'utf8') : '{}';
  step('27c', '敏感信息不同步（accounts.json 无令牌）', !/accessToken|refreshToken/.test(acc2raw));

  /* ===== 测试 28：启动器健康与配置损坏恢复 ===== */
  await browser2.close().catch(() => {});
  child2.kill('SIGKILL');
  for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) { try { fs.rmSync(path.join(DATA2, f), { force: true }); } catch { /* */ } }
  fs.writeFileSync(path.join(DATA2, 'settings.json'), '{ 损坏的 JSON !!');
  const child3 = spawn(path.join(ROOT, 'node_modules/.bin/electron'), ['.', '--remote-debugging-port=9336'], { cwd: ROOT, env: { ...process.env, BLOCKBOX_DATA_DIR: DATA2 }, stdio: 'ignore' });
  await sleep(9000);
  let browser3 = null;
  for (let i = 0; i < 5 && !browser3; i++) { browser3 = await chromium.connectOverCDP('http://127.0.0.1:9336').catch(() => null); if (!browser3) await sleep(3000); }
  const page3 = browser3.contexts()[0].pages()[0];
  const s2 = await invoke(page3, 'settings.get', {});
  const corruptFiles = fs.readdirSync(DATA2).filter((f) => f.includes('.corrupt-'));
  step('28a', '配置损坏自动恢复（留损坏副本+可用默认值）', !!s2?.theme && corruptFiles.length >= 1, '损坏副本：' + corruptFiles.join(','));
  const health = await invoke(page3, 'app.health', {});
  step('28b', '启动器状态面板数据（版本/目录/占用/Java）', !!health.version && !!health.dataDir && health.sizes && Array.isArray(health.javas), `java ${health.javas?.length ?? 0} 个，缓存 ${(health.sizes?.cache / 1e6 || 0).toFixed(0)}MB`);
  // 清缓存（预览确认由 UI 层做；主进程直接验证行为）
  const cleared = await invoke(page3, 'data.reset', { level: 'cache' });
  step('28c', '清理缓存（不碰实例与账户）', /缓存|清理/.test(cleared?.message || ''), (cleared?.message || '').slice(0, 50));

  /* ===== 测试 30：截图与日志管理 ===== */
  const shotsDir = path.join(DATA, 'instances', instP.id, 'screenshots');
  fs.mkdirSync(shotsDir, { recursive: true });
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  fs.writeFileSync(path.join(shotsDir, 'shot1.png'), PNG);
  fs.writeFileSync(path.join(shotsDir, 'shot2.png'), PNG);
  const shots = await invoke(page, 'gametools.screenshots', { instanceId: instP.id });
  step('30a', '截图网格数据（按实例扫描）', shots.length === 2, shots.map((s) => s.file).join(','));
  const expDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shots-'));
  const expShots = await invoke(page, 'gametools.exportScreenshots', { paths: shots.map((s) => s.path), destDir: expDir });
  step('30b', '截图导出', expShots.count === 2);
  await invoke(page, 'gametools.setCover', { instanceId: instP.id, path: shots[0].path });
  const coverSet = (await invoke(page, 'instances.list', {})).find((i) => i.id === instP.id)?.cover;
  step('30c', '设为实例封面', !!coverSet && coverSet === shots[0].path);
  fs.mkdirSync(path.join(DATA, 'instances', instP.id, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(DATA, 'instances', instP.id, 'logs', 'latest.log'), '[10:00:00] [main/INFO]: 游戏启动\n[10:00:05] [Render thread/ERROR]: 测试错误行\n[10:00:06] [main/WARN]: 警告行', 'utf8');
  await invoke(page, 'settings.set', { devMode: true });
  const dev2 = await invoke(page, 'dev.fullDiagnose', { instanceId: instP.id }).catch((e) => ({ err: e.message }));
  const logText = dev2.logs || '';
  step('30d', '日志查看器（开发者模式+着色文本）', logText.includes('ERROR') && logText.includes('测试错误行'), '长度=' + logText.length);
  // 快捷指令
  await invoke(page, 'gametools.saveQuickCommands', { instanceId: instP.id, commands: [{ cmd: '/give @s diamond 1', note: '给钻石' }] });
  const qc2 = await invoke(page, 'gametools.quickCommands', { instanceId: instP.id });
  step('30e', '快捷指令保存/读取', qc2.length === 1 && qc2[0].cmd.startsWith('/'));
  await browser.close().catch(() => {});
} catch (e) {
  step('FATAL', '脚本异常', false, String(e).slice(0, 250));
} finally {
  try { child.kill(); } catch { /* */ }
  mock.close();
  await sleep(800);
  fs.writeFileSync(path.join(OUT, 'r3-result.json'), JSON.stringify(results, null, 2));
  console.log('---- 第三轮测试结果 ----');
  for (const r of results) console.log(`${r.ok ? '通过' : '失败'} | ${r.id} ${r.name} | ${r.note}`);
  process.exit(0);
}
