// 模块 L：智能性能调优与硬件适配
const os = require('os');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { dirs, instanceDir } = require('./paths');
const config = require('./config');
const instances = require('../instances/instances');
const mods = require('../instances/mods');
const { UserError } = require('./ipc-gateway');
const { broadcast } = require('./emitter');

function gpuName() {
  return new Promise((resolve) => {
    try {
      execFile('system_profiler', ['SPDisplaysDataType'], { timeout: 8000 }, (_e, stdout) => {
        const m = /Chipset Model: (.+)/.exec(stdout || '');
        resolve(m ? m[1].trim() : null);
      });
    } catch { resolve(null); }
  });
}
function chipName() {
  return new Promise((resolve) => {
    try {
      execFile('sysctl', ['-n', 'machdep.cpu.brand_string'], { timeout: 5000 }, (_e, stdout) => resolve(String(stdout || '').trim() || null));
    } catch { resolve(null); }
  });
}

async function hardwareProfile() {
  const totalGB = Math.round(os.totalmem() / 1e9);
  const freeGB = Math.round(os.freemem() / 1e9);
  let gpu = null, chip = null, detectFailed = false;
  try { [gpu, chip] = await Promise.all([gpuName(), chipName()]); } catch { detectFailed = true; }
  if (!chip && process.arch === 'arm64') chip = 'Apple Silicon';
  if (!gpu) detectFailed = true;
  return {
    arch: process.arch, chip: chip || '未知', gpu: gpu || '未知', detectFailed,
    cpuCores: os.cpus().length, totalGB, freeGB,
    diskFreeGB: (() => { try { const st = fs.statfsSync(dirs().root); return Math.round(st.bsize * st.bavail / 1e9); } catch { return null; } })(),
  };
}

// 中文性能建议（每条都解释为什么）
function buildAdvice(hw, { modCount = 0, loader = 'vanilla', versionId = '' } = {}) {
  const advice = [];
  let memoryMB;
  if (hw.totalGB <= 4) { memoryMB = 1536; advice.push({ key: 'memory', text: `你的电脑总内存约 ${hw.totalGB}GB，比较紧张。建议给游戏分配 ${(memoryMB / 1024).toFixed(1)}GB——分多了系统和其他程序会卡，分少了游戏自己会卡。` }); }
  else if (hw.totalGB <= 8) { memoryMB = modCount > 30 ? 3072 : 2048; advice.push({ key: 'memory', text: `你的电脑总内存约 ${hw.totalGB}GB。建议给游戏分配 ${(memoryMB / 1024).toFixed(1)}GB${modCount > 30 ? '（你装了 ' + modCount + ' 个模组，比原版更需要内存）' : ''}，剩下的留给系统，双方都不卡。` }); }
  else if (hw.totalGB <= 16) { memoryMB = modCount > 30 ? 4096 : modCount > 10 ? 3072 : 2048; advice.push({ key: 'memory', text: `你的电脑总内存约 ${hw.totalGB}GB，比较充裕。建议给游戏分配 ${(memoryMB / 1024).toFixed(1)}GB${modCount > 10 ? '（当前实例有 ' + modCount + ' 个模组，模组越多越吃内存）' : ''}。超过这个数字游戏通常不会更快，反而可能因为垃圾回收变慢而卡顿。` }); }
  else { memoryMB = modCount > 30 ? 6144 : 4096; advice.push({ key: 'memory', text: `你的电脑总内存约 ${hw.totalGB}GB，非常充裕。建议给游戏分配 ${(memoryMB / 1024).toFixed(1)}GB。注意：内存不是越多越好，过多会让 Java 的垃圾回收变慢，反而卡顿。` }); }

  if (modCount > 15) advice.push({ key: 'gc', text: '你装了较多模组，建议启用 G1 垃圾回收调优参数。它能在模组多的时候减少游戏突然卡一下（顿卡）的次数。这个是启动器默认开启的，无需操作。' });
  if (hw.arch === 'arm64' && hw.chip !== '未知') advice.push({ key: 'arch', text: `你的 Mac 芯片是 ${hw.chip}（Apple 芯片），启动器会自动使用原生版本的游戏和 Java，性能比转译方式好很多，无需任何设置。` });
  if (loader !== 'vanilla' && modCount > 0) advice.push({ key: 'perfmods', text: '检测到你使用模组加载器。安装 Sodium/Iris（画面）与 Lithium/FerriteCore（内部优化）这类优化模组，可以明显提升流畅度，可在下方一键安装。' });
  advice.push({ key: 'disk', text: `数据目录所在磁盘剩余约 ${hw.diskFreeGB ?? '?'}GB${(hw.diskFreeGB || 99) < 10 ? '，偏少：空间不足会导致存档变慢甚至损坏，建议清理到 10GB 以上。' : '，足够游戏与存档使用。'}` });
  return { memoryMB, advice };
}

// 5 套性能预设（中文命名 + 说明 + 参数）
const PRESETS = [
  { id: 'battery', name: '省电模式', desc: '适合用电池玩、或想让电脑风扇安静：限制游戏使用的资源，牺牲部分画面流畅度换取续航与低温。', memory: 'auto', jvmArgs: '', viewDistance: 8, maxFps: 60, expect: '帧率降低、发热减少、续航更长。' },
  { id: 'balanced', name: '均衡模式', desc: '默认推荐：在流畅与省电之间平衡，适合大多数玩家日常游玩。', memory: 'auto', jvmArgs: '', viewDistance: 10, maxFps: 120, expect: '与默认一致，稳定流畅。' },
  { id: 'smooth', name: '流畅优先', desc: '适合对帧率敏感的玩家：提高内存上限并建议安装优化模组，追求不卡顿。', memory: 'auto', jvmArgs: '-XX:+UseG1GC', viewDistance: 10, maxFps: 240, expect: '帧率更稳，电脑发热略增。' },
  { id: 'modded', name: '模组友好', desc: '适合装了很多模组的实例：给游戏更多内存，减少因内存不足导致的顿卡和崩溃。', memory: 'auto', jvmArgs: '-XX:+UseG1GC', viewDistance: 8, maxFps: 120, expect: '模组多时顿卡明显减少。' },
  { id: 'maxperf', name: '极致性能', desc: '追求最高帧率：大内存 + 高帧率上限。笔记本会明显发热，建议插电使用。可能导致老旧设备不稳定。', memory: 'auto', jvmArgs: '-XX:+UseG1GC', viewDistance: 12, maxFps: 260, expect: '帧率最高，功耗最高，风险自负（可一键回滚）。' },
];

function presetParams(preset, hw, modCount) {
  const advice = buildAdvice(hw, { modCount });
  let memoryMB = advice.memoryMB;
  switch (preset.id) {
    case 'battery': memoryMB = Math.min(memoryMB, Math.max(1536, Math.round(hw.totalGB * 1024 * 0.125 / 512) * 512)); break;
    case 'modded': memoryMB = Math.max(memoryMB, Math.min(4096, Math.round(hw.totalGB * 1024 * 0.25 / 512) * 512)); break;
    case 'maxperf': memoryMB = Math.max(memoryMB, Math.min(8192, Math.round(hw.totalGB * 1024 * 0.3 / 512) * 512)); break;
    case 'smooth': memoryMB = Math.max(memoryMB, 3072); break;
  }
  return { memoryMB, jvmArgs: preset.jvmArgs, viewDistance: preset.viewDistance, maxFps: preset.maxFps };
}

const PERF_MODS = [
  { key: 'sodium', name: 'Sodium', desc: '大幅提升画面渲染速度', slug: 'sodium' },
  { key: 'lithium', name: 'Lithium', desc: '优化游戏内部计算（ tick 速度）', slug: 'lithium' },
  { key: 'ferritecore', name: 'FerriteCore', desc: '降低内存占用', slug: 'ferrite-core' },
];

function registerAll(register) {
  register({
    'perf.profile': () => hardwareProfile(),
    'perf.advice': async ({ instanceId }) => {
      const hw = await hardwareProfile();
      let modCount = 0, loader = 'vanilla';
      try { const inst = instances.get(instanceId); loader = inst.loader; modCount = (await Promise.resolve(mods.list(instanceId))).length; } catch { /* 全局建议 */ }
      return { hw, ...buildAdvice(hw, { modCount, loader }), detectFailedText: hw.detectFailed ? '启动器无法完整检测你的硬件信息（显卡型号未获取到）。你可以手动在设置中填写内存大小，或直接使用默认配置，不影响使用。' : null };
    },
    'perf.presets': () => PRESETS,
    'perf.presetDiff': async ({ instanceId, presetId }) => {
      const inst = instances.get(instanceId);
      const hw = await hardwareProfile();
      const preset = PRESETS.find((p) => p.id === presetId);
      const modCount = mods.list(instanceId).length;
      const params = presetParams(preset, hw, modCount);
      const oldMem = inst.settings?.memory === 'auto' ? config.memoryMB() : Number(inst.settings?.memory) || config.memoryMB();
      const diffs = [];
      diffs.push({ text: `内存分配将从 ${(oldMem / 1024).toFixed(1)}GB 调整为 ${(params.memoryMB / 1024).toFixed(1)}GB`, why: params.memoryMB > oldMem ? '预计可减少因内存不足导致的卡顿。' : '可降低功耗与发热。' });
      if (params.jvmArgs !== (inst.settings?.jvmArgs || '')) diffs.push({ text: '将启用针对当前场景的垃圾回收参数', why: '减少游戏突然卡一下的次数。' });
      return { diffs, params, expect: preset.expect };
    },
    'perf.applyPreset': async ({ instanceId, presetId }) => {
      const inst = instances.get(instanceId);
      const hw = await hardwareProfile();
      const preset = PRESETS.find((p) => p.id === presetId) || PRESETS[1];
      const modCount = mods.list(instanceId).length;
      const params = presetParams(preset, hw, modCount);
      // 保存优化前快照（一键回滚）
      const snapshot = { memory: inst.settings?.memory ?? 'auto', jvmArgs: inst.settings?.jvmArgs ?? '', time: Date.now(), presetName: preset.name };
      const fsmod = fs;
      const snapPath = path.join(instanceDir(instanceId), '.blockbox', 'pre-optimization.json');
      fsmod.mkdirSync(path.dirname(snapPath), { recursive: true });
      fsmod.writeFileSync(snapPath, JSON.stringify(snapshot));
      const d = config.readJson(dirs().instancesFile, { instances: [] });
      const raw = d.instances.find((x) => x.id === instanceId);
      if (!raw) throw new UserError('找不到这个实例。');
      raw.settings = { ...raw.settings, memory: params.memoryMB, jvmArgs: params.jvmArgs };
      config.writeJson(dirs().instancesFile, d);
      // 渲染设置写入 options.txt
      try {
        const optPath = path.join(instanceDir(instanceId), 'options.txt');
        let map = {};
        try { for (const line of fs.readFileSync(optPath, 'utf8').split(/\r?\n/)) { const i = line.indexOf(':'); if (i > 0) map[line.slice(0, i)] = line.slice(i + 1); } } catch { /* */ }
        map.renderDistance = String(params.viewDistance);
        map.maxFps = String(params.maxFps);
        fs.writeFileSync(optPath, Object.entries(map).map(([k, v]) => k + ':' + v).join('\n'));
      } catch { /* options.txt 不存在则游戏首启生成 */ }
      broadcast('bb:instances-changed', instances.list());
      return {
        summary: `已为你的「${inst.name}」设置：内存 ${(params.memoryMB / 1024).toFixed(1)}GB（你的电脑总内存 ${hw.totalGB}GB${modCount ? '，当前 ' + modCount + ' 个模组' : ''}）${params.jvmArgs ? '，启用了 G1 垃圾回收调优（适合模组较多的场景，减少顿卡）' : ''}，渲染距离 ${params.viewDistance} 格，帧率上限 ${params.maxFps}。预期效果：${preset.expect}`,
        rollback: { type: 'perf.rollback', instanceId },
      };
    },
    'perf.rollback': async ({ instanceId }) => {
      const snapPath = path.join(instanceDir(instanceId), '.blockbox', 'pre-optimization.json');
      if (!fs.existsSync(snapPath)) throw new UserError('没有找到优化前的设置快照。');
      const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
      const d = config.readJson(dirs().instancesFile, { instances: [] });
      const raw = d.instances.find((x) => x.id === instanceId);
      if (!raw) throw new UserError('找不到这个实例。');
      raw.settings = { ...raw.settings, memory: snap.memory, jvmArgs: snap.jvmArgs };
      config.writeJson(dirs().instancesFile, d);
      broadcast('bb:instances-changed', instances.list());
      return `已恢复到「${snap.presetName}」优化前的设置（内存 ${snap.memory === 'auto' ? '自动' : (snap.memory / 1024) + 'GB'}）。`;
    },
    'perf.detectMods': ({ instanceId }) => {
      const list = mods.list(instanceId);
      const found = new Set();
      for (const m of list) for (const id of m.modIds || []) {
        if (/sodium/i.test(id) || /sodium/i.test(m.name)) found.add('sodium');
        if (/lithium/i.test(id) || /lithium/i.test(m.name)) found.add('lithium');
        if (/ferrite/i.test(id) || /ferrite/i.test(m.name)) found.add('ferritecore');
      }
      return { installed: [...found], missing: PERF_MODS.filter((p) => !found.has(p.key)) };
    },
    'perf.diagnose': async ({ instanceId }) => {
      const inst = instances.get(instanceId);
      const hw = await hardwareProfile();
      const list = mods.list(instanceId);
      const modCount = list.filter((m) => m.enabled).length;
      const advice = buildAdvice(hw, { modCount, loader: inst.loader });
      const memNow = inst.settings?.memory === 'auto' || !inst.settings?.memory ? config.memoryMB() : Number(inst.settings.memory);
      const items = [];
      items.push({ title: '内存分配', ok: memNow >= advice.memoryMB * 0.75, detail: `当前 ${memNow}MB，建议 ${advice.memoryMB}MB。${memNow < advice.memoryMB * 0.75 ? '内存偏小是模组场景下卡顿最常见的原因。' : '合理。'}`, fix: memNow < advice.memoryMB * 0.75 ? { type: 'setMemory', value: advice.memoryMB } : null });
      const perfFound = new Set();
      for (const m of mods.list(inst.id)) for (const id of m.modIds || []) {
        if (/sodium/i.test(id)) perfFound.add('sodium');
        if (/lithium/i.test(id)) perfFound.add('lithium');
        if (/ferrite/i.test(id)) perfFound.add('ferritecore');
      }
      items.push({ title: '优化模组', ok: perfFound.size > 0 || inst.loader === 'vanilla', detail: perfFound.size ? '已安装优化模组：' + [...perfFound].join('、') + '。' : inst.loader === 'vanilla' ? '原版实例不依赖优化模组。' : '未安装优化模组（Sodium/Lithium/FerriteCore）。它们能明显提升流畅度，可到实例模组页搜索安装。', fix: perfFound.size === 0 && inst.loader !== 'vanilla' ? { type: 'openMods' } : null });
      let renderDistance = null;
      try {
        for (const line of fs.readFileSync(path.join(instanceDir(inst.id), 'options.txt'), 'utf8').split(/\r?\n/)) {
          if (line.startsWith('renderDistance:')) renderDistance = Number(line.split(':')[1]);
        }
      } catch { /* */ }
      items.push({ title: '渲染距离', ok: !renderDistance || renderDistance <= 12, detail: renderDistance ? `当前 ${renderDistance} 格。渲染距离越大越吃性能，卡顿时建议调到 8-10 格。` : '未设置（使用游戏默认值）。', fix: null });
      items.push({ title: 'Java 版本', ok: true, detail: '启动器会为这个实例自动匹配正确的 Java，无需担心。' });
      items.push({ title: '模组数量', ok: modCount <= 60, detail: modCount > 60 ? `启用了 ${modCount} 个模组，数量较大。卡顿时可用"检查缺失前置+逐个禁用"定位问题模组。` : `当前启用 ${modCount} 个模组，数量正常。` });
      return { items, adviceMemoryMB: advice.memoryMB };
    },
  });
}
module.exports = { registerAll, PRESETS, PERF_MODS };
