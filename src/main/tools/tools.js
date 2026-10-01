// 工具集后端：种子地图 / 投影工坊(NBT) / 模组翻译(AI) / 配方数据包
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { app } = require('electron');
const AdmZip = require('adm-zip');
const { dirs, instanceDir } = require('../core/paths');
const config = require('../core/config');
const instances = require('../instances/instances');
const { UserError } = require('../core/ipc-gateway');
const { broadcast, toast } = require('../core/emitter');
const secrets = require('../core/secrets');

/* ==================== 种子地图 ==================== */
function seedtoolPath() {
  const name = process.arch === 'arm64' ? 'seedtool-arm64' : 'seedtool-x64';
  const candidates = [
    path.join(process.resourcesPath || '', name),
    path.join(app.getAppPath(), 'resources', name),
    path.join(app.getAppPath(), name),
  ];
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  return null;
}
function runSeedtool(args) {
  const bin = seedtoolPath();
  if (!bin) throw new UserError('地图引擎还没有就绪。启动器会在首次使用时自动准备，或者稍后再试。');
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: 120000, maxBuffer: 128e6 }, (err, stdout, stderr) => {
      if (err) return reject(new UserError('地图引擎运行失败：' + String(stderr || err.message).slice(0, 120)));
      try { resolve(JSON.parse(stdout)); } catch { reject(new UserError('地图引擎输出异常，请重试。')); }
    });
  });
}
const seedOf = (s) => String(s ?? '').trim() || '0';

const BIOME_PALETTE = {
  0: ['海洋', '#14418f'], 1: ['平原', '#91bd59'], 2: ['沙漠', '#f5ecbd'], 3: ['风袭丘陵', '#8ab889'],
  4: ['森林', '#79c05a'], 5: ['针叶林', '#86b783'], 6: ['沼泽', '#6a7039'], 7: ['河流', '#3f76e4'],
  8: ['下界荒地', '#bf3b3b'], 9: ['末地', '#8080a0'], 10: ['冻洋', '#7070d6'], 11: ['冻河', '#a0a0ff'],
  12: ['雪原', '#f0f5f5'], 13: ['冰刺之地', '#dfe7e7'], 14: ['蘑菇岛', '#ff00ff'], 16: ['沙滩', '#e8e0a0'],
  17: ['沙漠丘陵', '#e5d8a0'], 18: ['繁茂的丘陵', '#79c05a'], 19: ['针叶林丘陵', '#86b783'], 21: ['丛林', '#53a03e'],
  22: ['丛林丘陵', '#4a8f38'], 23: ['丛林边缘', '#628c45'], 24: ['深海', '#0f3377'], 25: ['石岸', '#a2a28b'],
  26: ['积雪沙滩', '#e8e8e0'], 27: ['白桦林', '#b0c98f'], 28: ['白桦林丘陵', '#a5bd85'], 29: ['黑森林', '#4a6f38'],
  30: ['黑森林丘陵', '#42672f'], 32: ['原始松木针叶林', '#6a8352'], 33: ['原始云杉针叶林', '#5d7448'],
  34: ['沙砾山地', '#889a75'], 35: ['热带草原', '#bfb755'], 36: ['热带高原', '#ada54c'], 37: ['恶地', '#d9a05b'],
  38: ['繁茂的恶地', '#c99a4f'], 39: ['恶地高原', '#cf9a4f'], 44: ['温暖海洋', '#3f8fe0'], 45: ['温和海洋', '#2f6fd0'],
  46: ['冷水海洋', '#2a55a0'], 47: ['深海暖水', '#2f6fc0'], 48: ['深海温和', '#2455a8'], 49: ['深海冷水', '#1f4080'],
  50: ['深海冻洋', '#5a6fd0'], 129: ['向日葵平原', '#b5ce75'], 130: ['沙漠湖泊', '#e8dfa8'], 131: ['风袭砂砾丘陵', '#7d9a70'],
  132: ['繁花森林', '#8fc968'], 140: ['向日葵平原2', '#b5ce75'], 149: ['风蚀恶地', '#d98f4a'], 151: ['高白桦林', '#a8c285'],
  155: ['沼泽丘陵', '#5f6733'], 162: ['丛林变种', '#4f9c3a'], 166: ['竹林', '#67b556'], 167: ['竹林丘陵', '#5da54c'],
  168: ['灵魂沙峡谷', '#5c4033'], 169: ['绯红森林', '#8f2f3f'], 170: ['诡异森林', '#2f8f7f'], 171: ['玄武岩三角洲', '#3f3f45'],
  172: ['溶洞', '#8a7a6a'], 173: ['繁茂洞穴', '#5f8f5f'], 174: ['草甸', '#9fd484'], 175: ['雪林', '#7aa08a'],
  176: ['积雪山坡', '#eef5f5'], 177: ['冰封山峰', '#b0c6d1'], 178: ['尖峭山峰', '#9a9aa8'], 179: ['裸岩山峰', '#7a7a72'],
  180: ['繁茂森林? 旧松林', '#6a8352'], 183: ['红树林沼泽', '#6c6f3c'], 184: ['深暗之域', '#1f2f2f'], 185: ['樱花树林', '#e8a7c4'],
  163: ['丛林边缘变种', '#628c45'],
};

function registerSeedmap(register) {
  register({
    'seedmap.map': async ({ seed, mcVersion, cx, cz, scale, size }) => {
      const s = size || 256;
      const half = Math.floor(s * (scale || 4) / 2);
      const r = await runSeedtool(['map', '--seed', seedOf(seed), '--version', mcVersion || '1.21', '--x0', String(Math.round(cx - half)), '--z0', String(Math.round(cz - half)), '--sx', String(s), '--sz', String(s), '--scale', String(scale || 4)]);
      const uniq = [...new Set(r.biomes)].map((id) => ({ id, name: BIOME_PALETTE[id]?.[0] || '群系 ' + id, color: BIOME_PALETTE[id]?.[1] || '#808080' }));
      return { x0: r.x0, z0: r.z0, scale: r.scale, size: { x: r.sx, z: r.sz }, biomes: r.biomes, palette: uniq, seedIsText: !!r.seedText };
    },
    'seedmap.structures': async ({ seed, mcVersion, x0, z0, x1, z1 }) => {
      const sh = await runSeedtool(['strongholds', '--seed', seedOf(seed), '--version', mcVersion || '1.21', '--count', '8']).catch(() => []);
      const st = await runSeedtool(['struct', '--seed', seedOf(seed), '--version', mcVersion || '1.21', '--x0', String(Math.round(x0)), '--z0', String(Math.round(z0)), '--x1', String(Math.round(x1)), '--z1', String(Math.round(z1))]);
      return [...(Array.isArray(st) ? st : []), ...(Array.isArray(sh) ? sh.filter((p) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1).map((p) => ({ type: 'stronghold', x: p.x, z: p.z })) : [])];
    },
    'seedmap.nearest': async ({ seed, mcVersion, type, x, z, count }) => {
      const r = await runSeedtool(['nearest', '--seed', seedOf(seed), '--version', mcVersion || '1.21', '--type', type || 'village', '--x', String(Math.round(x || 0)), '--z', String(Math.round(z || 0)), '--count', String(count || 5)]);
      return Array.isArray(r) ? r : [];
    },
  });
}

/* ==================== 投影工坊（NBT） ==================== */
async function nbtLib() {
  const nbt = await import('prismarine-nbt');
  return nbt.default || nbt;
}

// 常见旧版方块 id → 名称（节选）
const LEGACY_IDS = {
  0: 'minecraft:air', 1: 'minecraft:stone', 2: 'minecraft:grass_block', 3: 'minecraft:dirt', 4: 'minecraft:cobblestone',
  5: 'minecraft:oak_planks', 7: 'minecraft:bedrock', 8: 'minecraft:water', 9: 'minecraft:water', 10: 'minecraft:lava', 11: 'minecraft:lava',
  12: 'minecraft:sand', 13: 'minecraft:gravel', 14: 'minecraft:gold_ore', 15: 'minecraft:iron_ore', 16: 'minecraft:coal_ore',
  17: 'minecraft:oak_log', 18: 'minecraft:oak_leaves', 20: 'minecraft:glass', 21: 'minecraft:lapis_ore', 22: 'minecraft:lapis_block',
  23: 'minecraft:dispenser', 24: 'minecraft:sandstone', 25: 'minecraft:note_block', 35: 'minecraft:white_wool',
  41: 'minecraft:gold_block', 42: 'minecraft:iron_block', 43: 'minecraft:smooth_stone', 45: 'minecraft:bricks',
  46: 'minecraft:tnt', 47: 'minecraft:bookshelf', 48: 'minecraft:mossy_cobblestone', 49: 'minecraft:obsidian',
  57: 'minecraft:diamond_block', 58: 'minecraft:crafting_table', 61: 'minecraft:furnace', 62: 'minecraft:furnace',
  65: 'minecraft:ladder', 79: 'minecraft:ice', 80: 'minecraft:snow_block', 82: 'minecraft:clay', 84: 'minecraft:jukebox',
  86: 'minecraft:carved_pumpkin', 89: 'minecraft:glowstone', 98: 'minecraft:stone_bricks', 101: 'minecraft:iron_bars',
  102: 'minecraft:glass_pane', 112: 'minecraft:nether_bricks', 121: 'minecraft:end_stone', 123: 'minecraft:redstone_lamp',
  133: 'minecraft:emerald_block', 155: 'minecraft:quartz_block', 159: 'minecraft:white_terracotta',
  168: 'minecraft:spruce_planks', 169: 'minecraft:birch_planks', 170: 'minecraft:spruce_log', 201: 'minecraft:purpur_block',
  206: 'minecraft:end_bricks', 251: 'minecraft:white_concrete',
};

async function parseSchematic(p) {
  const nbt = await nbtLib();
  const buf = fs.readFileSync(p);
  const { parsed } = await new Promise((resolve, reject) => nbt.parse(buf, (e, r) => (e ? reject(e) : resolve({ parsed: r }))));
  const simple = nbt.simplify(parsed);
  const root = simple.Schematic || simple.schematic || simple;
  const format = p.toLowerCase().endsWith('.litematic') ? 'litematic'
    : root.Version != null && root.Palette ? 'sponge'
    : root.Blocks ? 'mcedit' : 'unknown';
  return { root, format, nbt };
}

async function schematicOpen({ path: p }) {
  if (!/\.(litematic|schematic|schem)$/i.test(p)) throw new UserError('请选择 .litematic / .schematic / .schem 格式的投影文件。');
  const { root, format } = await parseSchematic(p);
  let w = 0, h = 0, l = 0, count = 0;
  if (format === 'litematic') {
    const reg = Object.values(root.Regions || {})[0] || {};
    w = reg.Width; h = reg.Height; l = reg.Length;
    count = reg.TileEntities ? 0 : w * h * l;
  } else if (format === 'sponge') {
    w = root.Width; h = root.Height; l = root.Length;
  } else if (format === 'mcedit') {
    w = root.Width; h = root.Height; l = root.Length;
  }
  const meta = root.Metadata || root.Metadata_ || {};
  return {
    name: meta.Name || path.basename(p), format, width: Number(w), height: Number(h), length: Number(l),
    blockCount: Number(root.BlockCount ?? count) || Number(w) * Number(h) * Number(l),
  };
}

async function schematicLoad({ path: p }) {
  const { root, format } = await parseSchematic(p);
  let W, H, L, paletteNames = [], blocks = null;
  if (format === 'litematic') {
    const reg = Object.values(root.Regions || {})[0] || {};
    W = Number(reg.Width); H = Number(reg.Height); L = Number(reg.Length);
    paletteNames = (reg.BlockStatePalette || []).map((e) => e.Name || 'minecraft:air');
    const longs = reg.BlockStates;
    if (!longs) throw new UserError('这个 .litematic 缺少方块数据。');
    const bits = Math.max(1, Math.ceil(Math.log2(Math.max(2, paletteNames.length))));
    blocks = new Uint16Array(W * H * L);
    // litematic：long 数组大端，条目可跨 long，MSB 在前
    const bytes = new Uint8Array(longs.length * 8);
    for (let i = 0; i < longs.length; i++) {
      let v = BigInt(longs[i]) & 0xFFFFFFFFFFFFFFFFn;
      for (let b = 7; b >= 0; b--) { bytes[i * 8 + b] = Number(v & 0xFFn); v >>= 8n; }
    }
    let bitPos = 0;
    for (let i = 0; i < blocks.length; i++) {
      let val = 0;
      for (let b = 0; b < bits; b++) {
        const byteIdx = (bitPos + b) >> 3;
        const bitIdx = 7 - ((bitPos + b) & 7);
        val = (val << 1) | ((bytes[byteIdx] >> bitIdx) & 1);
      }
      bitPos += bits;
      blocks[i] = val < paletteNames.length ? val : 0;
    }
  } else if (format === 'sponge') {
    W = Number(root.Width); H = Number(root.Height); L = Number(root.Length);
    const pal = root.Palette || {};
    const names = new Array(Object.keys(pal).length);
    for (const [name, idx] of Object.entries(pal)) names[Number(idx)] = name;
    paletteNames = names;
    const data = root.BlockData;
    blocks = new Uint16Array(W * H * L);
    // varint 解码，顺序 y,z,x（x 最快）
    let idx = 0, bi = 0;
    const raw = data;
    while (bi < raw.length && idx < blocks.length) {
      let val = 0, shift = 0, byte;
      do {
        byte = raw[bi++];
        val |= (byte & 0x7F) << shift;
        shift += 7;
      } while (byte & 0x80 && shift < 35);
      blocks[idx++] = val;
    }
  } else if (format === 'mcedit') {
    W = Number(root.Width); H = Number(root.Height); L = Number(root.Length);
    const rawBlocks = root.Blocks;
    const add = root.AddBlocks;
    blocks = new Uint16Array(W * H * L);
    for (let i = 0; i < blocks.length && i < rawBlocks.length; i++) {
      let id = rawBlocks[i] & 0xFF;
      if (add && add.length) {
        const extra = (add[i >> 1] >> ((i & 1) ? 4 : 0)) & 0xF;
        id |= extra << 8;
      }
      const dataNib = root.Data ? (root.Data[i >> 1] >> ((i & 1) ? 4 : 0)) & 0xF : 0;
      const key = (id << 4) | dataNib;
      blocks[i] = key;
      if (!paletteNames[key]) paletteNames[key] = LEGACY_IDS[id] || `minecraft:block_${id}${dataNib ? '_' + dataNib : ''}`;
    }
    // 稀疏 palette 补齐
    for (let i = 0; i < paletteNames.length; i++) if (!paletteNames[i]) paletteNames[i] = `minecraft:air`;
  } else {
    throw new UserError('无法识别这个投影文件的格式。');
  }
  return {
    blocks: Array.from(blocks), palette: paletteNames.filter(Boolean),
    size: { x: W, y: H, z: L }, format,
    metadata: { name: (root.Metadata || {}).Name || path.basename(p) },
  };
}

// 导出为 Sponge v2 .schem
async function writeSponge(pathOut, { size, palette, blocks }) {
  const nbt = await nbtLib();
  const pal = {};
  palette.forEach((name, i) => { pal[name] = i; });
  const bd = [];
  const pushVarint = (v) => {
    let x = v >>> 0;
    for (;;) {
      if ((x & ~0x7F) === 0) { bd.push(x); return; }
      bd.push((x & 0x7F) | 0x80);
      x >>>= 7;
    }
  };
  const { x: W, y: H, z: L } = size;
  for (let y = 0; y < H; y++) for (let z = 0; z < L; z++) for (let x = 0; x < W; x++) {
    pushVarint(blocks[(y * L + z) * W + x] || 0);
  }
  const parsed = {
    type: 'compound', name: 'Schematic',
    value: {
      Version: { type: 'int', value: 2 },
      DataVersion: { type: 'int', value: 3337 },
      Width: { type: 'short', value: W },
      Height: { type: 'short', value: H },
      Length: { type: 'short', value: L },
      Offset: { type: 'intArray', value: [0, 0, 0] },
      Palette: { type: 'compound', value: Object.fromEntries(Object.entries(pal).map(([k, v]) => [k, { type: 'int', value: v }])) },
      PaletteMax: { type: 'int', value: palette.length },
      BlockData: { type: 'byteArray', value: Buffer.from(bd) },
      Metadata: { type: 'compound', value: { Name: { type: 'string', value: 'BlockBox Export' } } },
    },
  };
  const out = nbt.writeUncompressed ? nbt.writeUncompressed(parsed) : nbt.writeNBT(parsed);
  fs.writeFileSync(pathOut, zlib.gzipSync(Buffer.isBuffer(out) ? out : Buffer.from(out)));
}

async function schematicReplace({ path: p, from, to }) {
  const data = await schematicLoad({ path: p });
  const oldNames = data.palette;
  const nameToIdx = new Map(oldNames.map((n, i) => [n, i]));
  const newPalette = ['minecraft:air'];
  const remap = new Map();
  for (let i = 0; i < oldNames.length; i++) {
    const name = oldNames[i] || 'minecraft:air';
    if (name === 'minecraft:air') { remap.set(i, 0); continue; }
    if (from && name !== from && !name.endsWith(':' + from)) {
      // 保持不变
      let idx = newPalette.indexOf(name);
      if (idx < 0) { newPalette.push(name); idx = newPalette.length - 1; }
      remap.set(i, idx);
    } else {
      const target = to.startsWith('minecraft:') ? to : 'minecraft:' + to;
      let idx = newPalette.indexOf(target);
      if (idx < 0) { newPalette.push(target); idx = newPalette.length - 1; }
      remap.set(i, idx);
    }
  }
  const nb = new Uint16Array(data.blocks.length);
  for (let i = 0; i < data.blocks.length; i++) nb[i] = remap.get(data.blocks[i]) || 0;
  const dest = path.join(dirs().meta, `替换-${Date.now()}.schem`);
  await writeSponge(dest, { size: data.size, palette: newPalette, blocks: nb });
  return { path: dest };
}

async function schematicExport({ path: p, dest }) {
  const data = await schematicLoad({ path: p });
  const out = dest.endsWith('.schem') ? dest : dest + '.schem';
  await writeSponge(out, { size: data.size, palette: data.palette, blocks: Uint16Array.from(data.blocks) });
  return { path: out };
}

/* ==================== 模组翻译 ==================== */
const translateTasks = new Map();
// 术语库 + 翻译记忆（本地持久化）
const GLOSSARY_FILE = () => path.join(dirs().root, '术语库.json');
const TM_FILE = () => path.join(dirs().root, '翻译记忆.json');
function loadGlossary() { try { return JSON.parse(fs.readFileSync(GLOSSARY_FILE(), 'utf8')); } catch { return {}; } }
function saveGlossary(g) { fs.writeFileSync(GLOSSARY_FILE(), JSON.stringify(g, null, 2)); return g; }
function loadTM() { try { return JSON.parse(fs.readFileSync(TM_FILE(), 'utf8')); } catch { return {}; } }
function saveTM(m) { fs.writeFileSync(TM_FILE(), JSON.stringify(m, null, 2)); return m; }
function applyGlossary(text, glossary) {
  let out = text;
  for (const [en, zh] of Object.entries(glossary)) {
    if (en && zh) out = out.split(en).join(zh);
  }
  return out;
}
function qualityCheck(entries, translated) {
  const issues = [];
  const seenZh = new Map();
  const isEnglishWord = (s) => /[a-zA-Z]{4,}/.test(s);

  for (const [k, src] of entries) {
    const out = translated[k];
    if (!out || !String(out).trim()) issues.push({ key: k, src, out: out || '', kind: 'empty', message: '译文为空' });
    else if (placeholdersOf(src) !== placeholdersOf(out)) issues.push({ key: k, src, out, kind: 'placeholder', message: '占位符/颜色代码不完整（原文 ' + (placeholdersOf(src) || '无') + '，译文 ' + (placeholdersOf(out) || '无') + '）' });
    else if (String(out).length > String(src).length * 3 || String(out).length > String(src).length * 1.5 && String(src).length > 20) issues.push({ key: k, src, out, kind: 'long', message: '译文过长（超过原文 150%，可能导致界面溢出），建议精简' });
    else if (/[,;.!?'"]/.test(out)) issues.push({ key: k, src, out, kind: 'punct', message: '译文含英文标点，建议使用中文标点' });
    else if (isEnglishWord(out) && !/^(OSS|TPS|FPS|GUI|HUD)$/.test(out)) issues.push({ key: k, src, out, kind: 'untranslated', message: '译文似乎保留了未翻译的英文单词' });
    if (seenZh.has(out) && out) issues.push({ key: k, src, out, kind: 'dup', message: '与「' + seenZh.get(out) + '」的译文重复（同一中文对应多个英文）' });
    seenZh.set(out, k);
  }
  return issues;
}
let translateSeq = 1;

function listLangFiles(jarPath) {
  const zip = new AdmZip(jarPath);
  return zip.getEntries().filter((e) => /^assets\/[^/]+\/lang\/en_us\.json$/.test(e.entryName)).map((e) => e.entryName);
}
function readLang(zip, entry) {
  try { return JSON.parse(zip.getEntry(entry).getData().toString('utf8')); } catch { return {}; }
}
function flatStrings(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (typeof v === 'string') out[k] = v;
    else if (v && typeof v === 'object') Object.assign(out, flatStrings(v, prefix + k + '.'));
  }
  return out;
}
function placeholdersOf(s) {
  return (s.match(/%[sd]\b|%[1-9]\$s|%[1-9]\$d|§[0-9a-fk-or]/g) || []).sort().join(',');
}
function packFormatFor(mcVersion) {
  const v = String(mcVersion || '');
  if (/^1\.21/.test(v)) return 34;
  if (/^1\.20\.[3-6]/.test(v)) return 22;
  return 15;
}

async function translateBatch(entries, cfg) {
  const base = (cfg.apiBase || 'https://api.deepseek.com').replace(/\/$/, '');
  const body = {
    model: cfg.model || 'deepseek-chat',
    temperature: 0.2,
    messages: [
      { role: 'system', content: '你是 Minecraft 模组翻译专家。把 JSON 里的英文翻译成简体中文。规则：1) 保留所有 %s、%d、%1$s 等占位符和 § 颜色代码，一个都不能少；2) 使用 Minecraft 官方译名风格；3) 只输出 JSON 对象，键不变，值为中文。' },
      { role: 'user', content: JSON.stringify(entries) },
    ],
  };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 60000);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`API 返回 ${res.status}`);
    const j = await res.json();
    const text = j.choices?.[0]?.message?.content || '';
    const m = /\{[\s\S]*\}/.exec(text);
    return m ? JSON.parse(m[0]) : {};
  } catch (e) { clearTimeout(timer); throw e; }
}

async function runTranslate(taskId, jarPath, instanceId, failedKeys = null) {
  const task = translateTasks.get(taskId);
  const cfg = config.get().translate || {};
  const apiKey = secrets.get('translate:apikey') || cfg.apiKey || '';
  if (!apiKey) {
    toast('使用模组翻译需要先填入 AI API Key。你可以在设置中填入。', 'warn', 5000);
    throw new UserError('使用模组翻译需要先填入 AI API Key。你可以在设置中填入，或者点击“了解如何获取 Key”查看说明。');
  }
  const zip = new AdmZip(jarPath);
  const entries = [];
  for (const entry of listLangFiles(jarPath)) {
    const obj = readLang(zip, entry);
    const flat = flatStrings(obj);
    for (const [k, v] of Object.entries(flat)) entries.push([k, v]);
  }
  const todo = failedKeys ? entries.filter(([k]) => failedKeys.includes(k)) : entries;
  task.total = todo.length;
  task.done = 0;
  task.failed = [];
  const translated = {};
  const tmStore = loadTM();
  const CONC = 2, BATCH = 16;
  let idx = 0;
  const mcVersion = instances.get(instanceId).versionId;
  async function worker() {
    while (idx < todo.length && !task.canceled) {
      if (task.paused) { await new Promise((r) => setTimeout(r, 500)); continue; }
      const batch = todo.slice(idx, idx + BATCH);
      idx += BATCH;
      const obj = Object.fromEntries(batch);
      let ok = false;
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        try {
          const glossary = loadGlossary();
          const res = await translateBatch(obj, { ...cfg, apiKey });
          for (const kk of Object.keys(res || {})) { res[kk] = applyGlossary(String(res[kk] || ''), glossary); }
          for (const [k, src] of batch) {
            const out = res[k];
            if (typeof out === 'string' && out.trim()) {
              if (placeholdersOf(out) === placeholdersOf(src)) { translated[k] = out; tmStore[src] = out; }
              else if (attempt === 2) { task.failed.push(k); }
              else continue;
            } else if (attempt === 2) task.failed.push(k);
            ok = true;
          }
        } catch (e) {
          if (attempt === 2) { for (const [k] of batch) task.failed.push(k); }
          else await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
        }
      }
      task.done = Math.min(task.done + batch.length, task.total);
      broadcast('bb:translate-progress', { taskId, done: task.done, total: task.total, stage: 'translating', failedCount: task.failed.length });
    }
  }
  await Promise.all([worker(), worker()]);

  if (task.canceled) { broadcast('bb:translate-progress', { taskId, done: task.done, total: task.total, stage: 'canceled', failedCount: task.failed.length }); return; }

  // 打包资源包
  broadcast('bb:translate-progress', { taskId, done: task.total, total: task.total, stage: 'packing', failedCount: task.failed.length });
  const inst = instances.get(instanceId);
  const rpDir = path.join(inst.dir, 'resourcepacks');
  fs.mkdirSync(rpDir, { recursive: true });
  const packName = `AI翻译-${path.basename(jarPath, '.jar')}.zip`;
  const packZip = new AdmZip();
  packZip.addFile('pack.mcmeta', Buffer.from(JSON.stringify({ pack: { pack_format: packFormatFor(mcVersion), description: `§aAI 自动翻译：${path.basename(jarPath, '.jar')}` } })));
  packZip.addFile('assets/minecraft/lang/zh_cn.json', Buffer.from(JSON.stringify(translated, null, 2)));
  const outPath = path.join(rpDir, packName);
  packZip.writeZip(outPath);
  // 启用
  try {
    const optsPath = path.join(inst.dir, 'options.txt');
    let map = {};
    try {
      for (const line of fs.readFileSync(optsPath, 'utf8').split(/\r?\n/)) {
        const i = line.indexOf(':');
        if (i > 0) map[line.slice(0, i)] = line.slice(i + 1);
      }
    } catch { /* */ }
    let packs = [];
    try { packs = JSON.parse(map.resourcePacks || '[]'); } catch { /* */ }
    const entry = `file/${packName}`;
    if (!packs.includes(entry)) packs.push(entry);
    map.resourcePacks = JSON.stringify(['vanilla', ...packs]);
    fs.writeFileSync(optsPath, Object.entries(map).map(([k, v]) => `${k}:${v}`).join('\n'));
  } catch { /* options.txt 写失败不阻塞 */ }
  try { saveTM(tmStore); } catch { /* */ }
  broadcast('bb:translate-progress', { taskId, done: task.total, total: task.total, stage: 'done', failedCount: task.failed.length });
  task.result = { packPath: outPath, failed: task.failed, total: task.total };
  // 结果（含失败明细）延迟回收：留足界面取数时间，又避免多次翻译后 translateTasks 只增不减
  setTimeout(() => translateTasks.delete(taskId), 30 * 60 * 1000);
}

function registerTranslate(register) {
  register({
    'translate.start': async ({ jarPath, instanceId, retry }) => {
      if (!fs.existsSync(jarPath)) throw new UserError('找不到这个模组文件，它可能已被移动或删除。');
      if (!retry && !(config.get().translate || {}).apiKey) {
        throw new UserError('使用模组翻译需要先填入 AI API Key。你可以在设置中填入，或者点击“了解如何获取 Key”查看说明。');
      }
      const taskId = 'tr-' + (translateSeq++);
      translateTasks.set(taskId, { paused: false, canceled: false, done: 0, total: 0, failed: [] });
      let failedKeys = null;
      if (retry) {
        const prev = [...translateTasks.values()].reverse().find((t) => t.result?.failed?.length);
        failedKeys = prev?.result?.failed || null;
        if (!failedKeys?.length) throw new UserError('没有记录到失败的条目。');
      }
      runTranslate(taskId, jarPath, instanceId, failedKeys).catch((e) => {
        const t = translateTasks.get(taskId);
        if (t) { t.error = e.userMessage || e.message; broadcast('bb:translate-progress', { taskId, stage: 'error', errorMessage: t.error, failedCount: t.failed.length }); }
      });
      return { taskId, total: 0 };
    },
    'translate.pause': ({ taskId }) => { const t = translateTasks.get(taskId); if (t) t.paused = true; return true; },
    'translate.resume': ({ taskId }) => { const t = translateTasks.get(taskId); if (t) t.paused = false; return true; },
    'translate.cancel': ({ taskId }) => { const t = translateTasks.get(taskId); if (t) t.canceled = true; return true; },
    'translate.result': ({ taskId }) => translateTasks.get(taskId)?.result || null,
    'translate.glossary': () => loadGlossary(),
    'translate.saveGlossary': ({ glossary }) => { saveGlossary(glossary || {}); return true; },
    'translate.tmExport': () => loadTM(),
    'translate.tmImport': ({ map }) => { const m = loadTM(); Object.assign(m, map || {}); saveTM(m); return { count: Object.keys(map || {}).length }; },
    'translate.tmClear': () => { saveTM({}); return true; },
    'translate.qualityCheck': ({ entries, translated }) => qualityCheck(entries || [], translated || {}),
    'translate.exportPack': ({ jarPath, translated, author }) => {
      const AdmZip = require('adm-zip');
      const zip = new AdmZip();
      zip.addFile('pack.mcmeta', Buffer.from(JSON.stringify({ pack: { pack_format: 34, description: '§a社区翻译包：' + path.basename(jarPath, '.jar') + '（作者：' + (author || '匿名') + '）' } })));
      zip.addFile('assets/minecraft/lang/zh_cn.json', Buffer.from(JSON.stringify(translated || {}, null, 2)));
      zip.addFile('blockbox-meta.json', Buffer.from(JSON.stringify({ mod: path.basename(jarPath, '.jar'), language: 'zh_CN', author: author || '匿名', entryCount: Object.keys(translated || {}).length, generatedAt: new Date().toISOString() }, null, 2)));
      const out = path.join(dirs().meta, '翻译包-' + Date.now() + '.zip');
      zip.writeZip(out);
      return { path: out };
    },
    'translate.importPack': ({ path: p }) => {
      const zip = new AdmZip(p);
      const metaE = zip.getEntry('blockbox-meta.json');
      const langE = zip.getEntry('assets/minecraft/lang/zh_cn.json');
      if (!langE) throw new UserError('这个翻译包缺少语言文件（assets/minecraft/lang/zh_cn.json）。');
      const translated = JSON.parse(langE.getData().toString('utf8'));
      const meta = metaE ? JSON.parse(metaE.getData().toString('utf8')) : {};
      return { meta, translated, count: Object.keys(translated).length };
    },
    'translate.testKey': async () => {
      const cfg = config.get().translate || {};
      const apiKey = secrets.get('translate:apikey') || cfg.apiKey || '';
      if (!apiKey) return { ok: false, kind: 'key', message: '还没有填写 API Key。' };
      const base = (cfg.apiBase || 'https://api.deepseek.com').replace(/\/$/, '');
      try {
        const res = await fetch(base + '/chat/completions', {
          method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + apiKey },
          body: JSON.stringify({ model: cfg.model || 'deepseek-chat', messages: [{ role: 'user', content: '回复：好' }], max_tokens: 5 }),
          signal: AbortSignal.timeout(15000),
        });
        if (res.status === 401 || res.status === 403) return { ok: false, kind: 'key', message: 'API Key 不对或已被停用（服务返回 ' + res.status + '）。请到服务商后台检查 Key。' };
        if (res.status === 404) return { ok: false, kind: 'service', message: '接口地址不对（404）。请检查 API 地址是否完整，一般以 /v1 结尾。' };
        if (!res.ok) return { ok: false, kind: 'service', message: '服务暂时不可用（返回 ' + res.status + '）。稍后再试。' };
        return { ok: true, message: '连接成功，Key 有效！' };
      } catch (e) {
        return { ok: false, kind: 'network', message: '网络错误：连不上 API 服务器（' + (e.message || e) + '）。请检查网络或接口地址。' };
      }
    },
  });
}

/* ==================== 配方生成器：数据包 ==================== */
function recipeJson(r) {
  const modern = Number(r.packFormat) >= 48;
  const ing = (id) => (modern ? { item: `minecraft:${id.replace(/^minecraft:/, '')}` } : { item: `minecraft:${id.replace(/^minecraft:/, '')}` });
  const result = (res) => modern
    ? { type: `minecraft:${res.type}`, ...payload(res) }
    : { type: `minecraft:${res.type}`, ...payloadLegacy(res) };
  // 1.21+：ingredient 直接写 item 字符串或对象；1.20 及更早：{"item": ...}
  function payload(res) {
    switch (res.type) {
      case 'crafting_shaped': {
        const pattern = res.pattern || [];
        const key = {};
        for (const [k, v] of Object.entries(res.key || {})) key[k] = `minecraft:${String(v).replace(/^minecraft:/, '')}`;
        return { pattern, key, result: { id: `minecraft:${res.result.id.replace(/^minecraft:/, '')}`, count: res.result.count } };
      }
      case 'crafting_shapeless':
        return { ingredients: res.ingredients.map((i) => `minecraft:${String(i).replace(/^minecraft:/, '')}`), result: { id: `minecraft:${res.result.id.replace(/^minecraft:/, '')}`, count: res.result.count } };
      case 'smelting': case 'blasting': case 'smoking':
        return { ingredient: `minecraft:${res.ingredient.replace(/^minecraft:/, '')}`, result: `minecraft:${res.result.id.replace(/^minecraft:/, '')}`, experience: 0.1, cookingtime: res.type === 'smelting' ? 200 : 100 };
      case 'stonecutting':
        return { ingredient: `minecraft:${res.ingredient.replace(/^minecraft:/, '')}`, result: `minecraft:${res.result.id.replace(/^minecraft:/, '')}`, count: res.result.count };
      default: return {};
    }
  }
  function payloadLegacy(res) {
    switch (res.type) {
      case 'crafting_shaped': {
        const key = {};
        for (const [k, v] of Object.entries(res.key || {})) key[k] = { item: `minecraft:${String(v).replace(/^minecraft:/, '')}` };
        return { pattern: res.pattern || [], key, result: { item: `minecraft:${res.result.id.replace(/^minecraft:/, '')}`, count: res.result.count } };
      }
      case 'crafting_shapeless':
        return { ingredients: res.ingredients.map((i) => ({ item: `minecraft:${String(i).replace(/^minecraft:/, '')}` })), result: { item: `minecraft:${res.result.id.replace(/^minecraft:/, '')}`, count: res.result.count } };
      case 'smelting': case 'blasting': case 'smoking':
        return { ingredient: { item: `minecraft:${res.ingredient.replace(/^minecraft:/, '')}` }, result: `minecraft:${res.result.id.replace(/^minecraft:/, '')}`, experience: 0.1, cookingtime: res.type === 'smelting' ? 200 : 100 };
      case 'stonecutting':
        return { ingredient: { item: `minecraft:${res.ingredient.replace(/^minecraft:/, '')}` }, result: `minecraft:${res.result.id.replace(/^minecraft:/, '')}`, count: res.result.count };
      default: return {};
    }
  }
  void ing;
  return result(r);
}

function registerRecipe(register) {
  register({
    'recipe.exportDatapack': ({ name, packFormat, recipes, destDir }) => {
      if (!recipes?.length) throw new UserError('先在列表里添加至少一个配方。');
      if (!fs.existsSync(destDir)) throw new UserError('目标文件夹不存在。');
      const zip = new AdmZip();
      const fmt = Number(packFormat) || 48;
      zip.addFile('pack.mcmeta', Buffer.from(JSON.stringify({ pack: { pack_format: fmt, description: `§bWing Launch 配方数据包：${name}` } })));
      for (const r of recipes) {
        const safe = (r.name || 'recipe').replace(/[^a-z0-9_/]/g, '_');
        const dirPath = fmt >= 45 ? 'data/blockbox/recipe/' : 'data/blockbox/recipes/';
        zip.addFile(dirPath + safe + '.json', Buffer.from(JSON.stringify(recipeJson({ ...r, packFormat: fmt }), null, 2)));
      }
      const out = path.join(destDir, `${(name || 'datapack')}.zip`);
      zip.writeZip(out);
      return { path: out };
    },
    'recipe.importDatapack': ({ path: p }) => {
      if (!/\.zip$/i.test(p)) throw new UserError('数据包需要是 .zip 文件。');
      const zip = new AdmZip(p);
      const out = [];
      for (const e of zip.getEntries()) {
        const m = /^data\/[^/]+\/recipes?\/([^/]+)\.json$/.exec(e.entryName);
        if (!m || e.isDirectory) continue;
        try {
          const j = JSON.parse(e.getData().toString('utf8'));
          const type = String(j.type || '').replace('minecraft:', '');
          const r = { name: m[1], type: type || 'crafting_shaped', packFormat: 48, result: { id: '', count: 1 } };
          if (type === 'crafting_shaped') {
            r.pattern = j.pattern || [];
            r.key = {};
            for (const [k, v] of Object.entries(j.key || {})) r.key[k] = typeof v === 'string' ? v : v?.item || '';
            const res = j.result || {};
            r.result = { id: typeof res === 'string' ? res : (res.id || res.item || ''), count: res.count || 1 };
          } else if (type === 'crafting_shapeless') {
            r.ingredients = (j.ingredients || []).map((i) => (typeof i === 'string' ? i : i?.item || ''));
            const res = j.result || {};
            r.result = { id: typeof res === 'string' ? res : (res.id || res.item || ''), count: res.count || 1 };
          } else {
            r.ingredient = typeof j.ingredient === 'string' ? j.ingredient : (Array.isArray(j.ingredient) ? (j.ingredient[0]?.item || j.ingredient[0]) : j.ingredient?.item || '');
            const res = j.result || {};
            r.result = { id: typeof res === 'string' ? res : (res.id || res.item || ''), count: type === 'stonecutting' ? (res.count || 1) : (res.count || 1) };
          }
          out.push(r);
        } catch { /* 跳过解析失败的 */ }
      }
      if (!out.length) throw new UserError('这个压缩包里没有找到标准格式的配方（data/*/recipe/*.json）。');
      return out;
    },
  });
}

function registerAll(register) {
  registerSeedmap(register);
  register({
    'schematic.open': (p) => schematicOpen(p),
    'schematic.load': (p) => schematicLoad(p),
    'schematic.replace': (p) => schematicReplace(p),
    'schematic.exportSchematic': (p) => schematicExport(p),
  });
  registerTranslate(register);
  registerRecipe(register);
}
module.exports = { registerAll };
