// 测试 6：工具集功能可用性（渐变文字 / 种子地图 / 配方生成器 / 投影 / 翻译防呆）
import { spawn } from 'child_process';
import { chromium } from 'playwright-core';
import AdmZip from 'adm-zip';
import nbt from 'prismarine-nbt';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'test', 'screens');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[test6]', ...a);
const report = [];
const step = (name, ok, note = '') => { report.push({ name, ok, note }); log(ok ? '✓' : '✗', name, note); };
const invoke = (page, ch, payload) => page.evaluate(([c, p]) => window.bb.raw.invoke(c, p), [ch, payload]);

const child = spawn(path.join(ROOT, 'node_modules/.bin/electron'), ['.', '--remote-debugging-port=9333'], { cwd: ROOT, stdio: 'ignore' });

try {
  await sleep(7000);
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const page = browser.contexts()[0].pages()[0];

  /* ---------- 渐变文字生成器（UI 驱动） ---------- */
  await page.evaluate(() => { location.hash = '#/tools/gradient'; });
  await sleep(1200);
  await page.screenshot({ path: path.join(OUT, 't6-gradient.png') });
  // 找文本输入并填入
  const gradInput = page.locator('input[type="text"], textarea').first();
  await gradInput.fill('你好MC');
  await sleep(600);
  // 点击第一个复制按钮
  const copyBtn = page.locator('button', { hasText: '复制' }).first();
  await copyBtn.click();
  await sleep(800);
  const clip = (await invoke(page, 'clip.read', {})).v || '';
  step('渐变文字导出 § 格式化代码', /§x§?[0-9A-F]/i.test(clip) || /§#[0-9A-F]{6}/i.test(clip), clip.slice(0, 60));
  log('剪贴板内容:', clip.slice(0, 100));

  /* ---------- 种子地图（引擎 + UI） ---------- */
  const map = (await invoke(page, 'seedmap.map', { seed: '12345', mcVersion: '1.21', cx: 0, cz: 0, scale: 16, size: 256 })).v;
  step('种子地图：生物群系数据加载', !!map?.biomes?.length && !!map?.palette?.length, `biomes=${map?.biomes?.length} 图例=${(map?.palette || []).slice(0, 3).map((p) => p.name).join('/')}`);
  const structs = (await invoke(page, 'seedmap.structures', { seed: '12345', mcVersion: '1.21', x0: -2048, z0: -2048, x1: 2048, z1: 2048 })).v;
  const hasVillage = (structs || []).some((s) => s.type === 'village');
  step('种子地图：结构可搜索/标注', Array.isArray(structs) && structs.length > 0 && hasVillage, `结构数=${structs?.length}`);
  const nearest = (await invoke(page, 'seedmap.nearest', { seed: '12345', mcVersion: '1.21', type: 'village', x: 0, z: 0, count: 3 })).v;
  step('种子地图：nearest 查询', (nearest || []).length >= 1, JSON.stringify((nearest || [])[0]));
  await page.evaluate(() => { location.hash = '#/tools/seedmap'; });
  await sleep(1500);
  try { const inp = page.locator('input').first(); await inp.fill('12345', { timeout: 4000 }); await sleep(1200); } catch { /* 页面表单选择器差异，忽略 */ }
  await page.screenshot({ path: path.join(OUT, 't6-seedmap.png') });

  /* ---------- 配方生成器（导出数据包并验证结构） ---------- */
  const destDir = fs.mkdtempSync(path.join(OUT, 'dp-'));
  const exp = (await invoke(page, 'recipe.exportDatapack', {
    name: 'test_pack', packFormat: 48,
    recipes: [{ type: 'crafting_shaped', name: 'diamond_sword_op', packFormat: 48, pattern: [' D ', ' D ', ' S '], key: { D: 'diamond', S: 'stick' }, result: { id: 'minecraft:diamond_sword', count: 1 } }],
    destDir,
  })).v;
  const zipPath = exp?.path;
  let packOk = false, recipeOk = false;
  if (zipPath && fs.existsSync(zipPath)) {
    const zip = new AdmZip(zipPath);
    const mcmeta = zip.getEntry('pack.mcmeta');
    const recipeFile = zip.getEntry('data/blockbox/recipe/diamond_sword_op.json');
    if (mcmeta) {
      const j = JSON.parse(mcmeta.getData().toString());
      packOk = j.pack?.pack_format === 48;
    }
    if (recipeFile) {
      const r = JSON.parse(recipeFile.getData().toString());
      recipeOk = r.type === 'minecraft:crafting_shaped' && JSON.stringify(r.pattern) === JSON.stringify([' D ', ' D ', ' S ']) && r.key?.D === 'minecraft:diamond';
    }
  }
  step('配方生成器：数据包导出且结构正确', packOk && recipeOk, `pack.mcmeta=${packOk} recipe=${recipeOk} → ${zipPath}`);
  const imp = (await invoke(page, 'recipe.importDatapack', { path: zipPath })).v;
  step('配方生成器：数据包再导入', Array.isArray(imp) && imp.length === 1 && imp[0].type === 'crafting_shaped', JSON.stringify((imp || [])[0])?.slice(0, 100));

  /* ---------- 投影工坊（生成 .schem → 打开/替换/导出） ---------- */
  const schemPath = path.join(OUT, 'test-struct.schem');
  {
    // 5x5x5 石头 + 少量玻璃
    const W = 5, H = 5, L = 5;
    const palette = { 'minecraft:air': 0, 'minecraft:stone': 1, 'minecraft:glass': 2 };
    const bd = [];
    const push = (v) => { let x = v >>> 0; for (;;) { if ((x & ~0x7f) === 0) { bd.push(x); return; } bd.push((x & 0x7f) | 0x80); x >>>= 7; } };
    for (let y = 0; y < H; y++) for (let z = 0; z < L; z++) for (let x = 0; x < W; x++) {
      push((x === 2 && y === 2 && z === 2) ? 2 : (x === 0 && y === 0 && z === 0) ? 0 : 1);
    }
    const parsed = {
      type: 'compound', name: 'Schematic',
      value: {
        Version: { type: 'int', value: 2 }, DataVersion: { type: 'int', value: 3337 },
        Width: { type: 'short', value: W }, Height: { type: 'short', value: H }, Length: { type: 'short', value: L },
        Palette: { type: 'compound', value: Object.fromEntries(Object.entries(palette).map(([k, v]) => [k, { type: 'int', value: v }])) },
        PaletteMax: { type: 'int', value: 3 },
        BlockData: { type: 'byteArray', value: Buffer.from(bd) },
      },
    };
    const out = nbt.writeUncompressed ? nbt.writeUncompressed(parsed) : nbt.writeNBT(parsed);
    fs.writeFileSync(schemPath, zlib.gzipSync(Buffer.isBuffer(out) ? out : Buffer.from(out)));
  }
  const opened = (await invoke(page, 'schematic.open', { path: schemPath })).v;
  step('投影工坊：打开 .schem', opened?.width === 5 && opened?.format === 'sponge', JSON.stringify(opened)?.slice(0, 90));
  const loaded = (await invoke(page, 'schematic.load', { path: schemPath })).v;
  const replaced = (await invoke(page, 'schematic.replace', { path: schemPath, from: 'minecraft:stone', to: 'minecraft:quartz_block' })).v;
  const reloaded = replaced?.path ? (await invoke(page, 'schematic.load', { path: replaced.path })).v : null;
  step('投影工坊：方块全部替换', !!reloaded?.palette?.includes('minecraft:quartz_block') && !reloaded?.palette?.includes('minecraft:stone'), `palette=${JSON.stringify(reloaded?.palette)}`);
  const exported = (await invoke(page, 'schematic.exportSchematic', { path: schemPath, dest: path.join(OUT, 'exported.schem') })).v;
  step('投影工坊：导出投影文件', !!exported?.path && fs.existsSync(exported.path));

  /* ---------- 模组翻译（防呆：未填 Key） ---------- */
  const trRes = await invoke(page, 'translate.start', { jarPath: path.join(ROOT, 'test/fixtures/test-mod.jar'), instanceId: 'no-instance' }).catch((e) => ({ __err: e.message }));
  const trMsg = trRes?.__err || trRes?.message || '';
  step('模组翻译：未填 Key 时给出中文引导', /API Key/.test(trMsg), trMsg.slice(0, 80));

  await browser.close();
} catch (e) {
  step('异常', false, String(e).slice(0, 300));
} finally {
  child.kill();
  await sleep(800);
  console.log('---- 测试6结果 ----');
  for (const s of report) console.log(`${s.ok ? '通过' : '失败'} | ${s.name} | ${s.note}`);
  fs.writeFileSync(path.join(OUT, 'test6-result.json'), JSON.stringify(report, null, 2));
  process.exit(0);
}
