// 测试 2：拖拽导入测试（分类识别 + 安装位置 + 防呆文案 + 重名处理）
import { spawn } from 'child_process';
import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const OUT = path.join(ROOT, 'test', 'screens');
const FIX = path.join(ROOT, 'test', 'fixtures');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[test2]', ...a);
const report = [];
const step = (name, ok, note = '') => { report.push({ name, ok, note }); log(ok ? '✓' : '✗', name, note); };

const child = spawn(path.join(ROOT, 'node_modules/.bin/electron'), ['.', '--remote-debugging-port=9333'], { cwd: ROOT, stdio: 'ignore' });
const invoke = (page, ch, payload) => page.evaluate(([c, p]) => window.bb.raw.invoke(c, p ), [ch, payload]);

try {
  await sleep(7000);
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const page = browser.contexts()[0].pages()[0];

  // 1) 分类识别
  const classify = await invoke(page, 'drop.classify', { paths: [
    path.join(FIX, 'test-modpack.mrpack'), path.join(FIX, 'test-mod.jar'),
    path.join(FIX, 'test-resourcepack.zip'), path.join(FIX, 'test-shaderpack.zip'),
    path.join(FIX, '测试存档'), path.join(FIX, 'not-mc-file.txt'),
  ] });
  const kinds = classify.v.map((x) => x.kind);
  step('分类：整合包/模组/资源包/光影包/存档/未知', JSON.stringify(kinds) === JSON.stringify(['modpack', 'mod', 'resourcepack', 'shaderpack', 'world', 'unknown']), kinds.join(','));

  // 2) 拖入整合包 → 自动建实例
  const r0 = await invoke(page, 'drop.install', { paths: [path.join(FIX, 'test-modpack.mrpack')] });
  await sleep(1000);
  const insts = (await invoke(page, 'instances.list', {})).v;
  const packInst = insts.find((i) => i.name.includes('测试整合包'));
  step('拖入 .mrpack 自动创建实例', !!r0.v?.instanceId && !!packInst && packInst.loader === 'fabric', `name=${packInst?.name} loader=${packInst?.loader} msg=${r0.v?.message}`);
  const mods = (await invoke(page, 'mods.list', { instanceId: packInst.id })).v;
  step('整合包模组下载到位', mods.some((m) => /cloth/i.test(m.file)), mods.map((m) => m.file).join(',') || '(空)');
  const optTxt = fs.existsSync(path.join(packInst.dir, 'options.txt')) ? fs.readFileSync(path.join(packInst.dir, 'options.txt'), 'utf8') : '';
  step('整合包 overrides 解压到位', optTxt.includes('version:4153') && fs.existsSync(path.join(packInst.dir, 'config/test.toml')));

  // 3) 模组 / 资源包 / 光影 / 存档 装入该实例
  const r1 = await invoke(page, 'mods.addFiles', { instanceId: packInst.id, paths: [path.join(FIX, 'test-mod.jar')] });
  const modFile = path.join(packInst.dir, 'mods', 'cloth-config-15.0.140-fabric.jar');
  step('.jar 模组装入 mods/', r1.v.installed.length === 1 && fs.existsSync(modFile));
  const r2 = await invoke(page, 'packs.addFiles', { instanceId: packInst.id, kind: 'resourcepacks', paths: [path.join(FIX, 'test-resourcepack.zip')] });
  step('.zip 资源包装入 resourcepacks/', r2.v.installed.length === 1 && fs.existsSync(path.join(packInst.dir, 'resourcepacks', 'test-resourcepack.zip')));
  const r3 = await invoke(page, 'packs.addFiles', { instanceId: packInst.id, kind: 'shaderpacks', paths: [path.join(FIX, 'test-shaderpack.zip')] });
  step('.zip 光影包装入 shaderpacks/', r3.v.installed.length === 1 && fs.existsSync(path.join(packInst.dir, 'shaderpacks', 'test-shaderpack.zip')));
  await invoke(page, 'packs.toggle', { instanceId: packInst.id, kind: 'shaderpacks', file: 'test-shaderpack.zip', enabled: true });
  const shList = (await invoke(page, 'packs.list', { instanceId: packInst.id, kind: 'shaderpacks' })).v;
  step('光影启用状态持久化', shList[0]?.enabled === true);
  const r4 = await invoke(page, 'worlds.importFiles', { instanceId: packInst.id, paths: [path.join(FIX, '测试存档')] });
  step('存档文件夹导入 saves/', r4.v.imported.length === 1 && fs.existsSync(path.join(packInst.dir, 'saves', '测试存档', 'level.dat')));

  // 4) 错误文件防呆
  const r5 = await invoke(page, 'drop.install', { paths: [path.join(FIX, 'not-mc-file.txt')] });
  step('无法识别文件给出中文提示', /看起来不是/.test(r5.v?.message || ''), (r5.v?.message || '').slice(0, 60));

  // 5) 重名实例自动加后缀
  const rn = await invoke(page, 'instances.create', { name: packInst.name.replace(/ \(\d+\)$/, ''), versionId: '1.21.1', loader: 'vanilla' });
  step('重名实例自动加 (2) 后缀', / \(2\)$/.test(rn.v?.renamedTo || ''), `renamedTo=${rn.v?.renamedTo}`);

  // 截图实例页
  await page.evaluate(() => { location.hash = '#/instances'; });
  await sleep(2000);
  await page.screenshot({ path: path.join(OUT, 't2-instances.png') });
  await browser.close();
} catch (e) {
  step('异常', false, String(e).slice(0, 300));
} finally {
  child.kill();
  await sleep(800);
  console.log('---- 测试2结果 ----');
  for (const s of report) console.log(`${s.ok ? '通过' : '失败'} | ${s.name} | ${s.note}`);
  fs.writeFileSync(path.join(OUT, 'test2-result.json'), JSON.stringify(report, null, 2));
  process.exit(0);
}
