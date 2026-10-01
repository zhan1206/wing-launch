// 模块 M：模组冲突诊断、依赖图、自动修复、更新提醒
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { instanceDir } = require('./paths');
const { UserError } = require('./ipc-gateway');
const mods = require('../instances/mods');
const instances = require('../instances/instances');
const sources = require('./download/sources');

// 内置已知冲突数据库（依据：社区长期已知不兼容组合，v1）
const KNOWN_CONFLICTS = [
  { a: /optifine/i, b: /iris/i, why: 'OptiFine 与 Iris 都会接管游戏的画面渲染，两者同时安装会导致游戏无法启动。依据：社区已知冲突（内置数据库 v1，来源为两个模组官方说明）。', advice: '保留 Iris 并移除 OptiFine（Iris 功能与之相当且支持更多光影）。' },
  { a: /optifine/i, b: /sodium/i, why: 'OptiFine 与 Sodium 都是画面性能优化模组，会重复修改同一段渲染代码。依据：社区已知冲突（内置数据库 v1）。', advice: '二选一。追求帧率建议保留 Sodium。' },
];
const CLIENT_SERVER_MARKS = /client[-_ ]?(only|side)|server[-_ ]?(only|side)/i;

function opLog(instanceId, entry) {
  const p = path.join(instanceDir(instanceId), '.blockbox', '操作日志.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  let arr = [];
  try { arr = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { /* */ }
  arr.unshift({ time: Date.now(), ...entry });
  fs.writeFileSync(p, JSON.stringify(arr.slice(0, 200), null, 2));
  return arr;
}

// 解析单个 jar 的 Mixin 配置文件名（作为冲突信号：同名 mixin 配置通常意味着同一注入点）
function mixinConfigs(file) {
  try {
    const zip = new AdmZip(file);
    return zip.getEntries().filter((e) => /^(\w+-)?mixins?\.\w+\.json$/.test(path.basename(e.entryName))).map((e) => path.basename(e.entryName));
  } catch { return []; }
}

// 全实例冲突扫描
function scanConflicts(instanceId) {
  const list = mods.list(instanceId);
  const issues = [];
  const enabled = list.filter((m) => m.enabled);
  for (let i = 0; i < enabled.length; i++) {
    for (let j = i + 1; j < enabled.length; j++) {
      const a = enabled[i], b = enabled[j];
      // 依据1：内置已知冲突库
      for (const rule of KNOWN_CONFLICTS) {
        if ((rule.a.test(a.name) || rule.a.test((a.modIds || []).join())) && (rule.b.test(b.name) || rule.b.test((b.modIds || []).join()))) {
          issues.push({ level: 'high', mods: [a.name, b.name], reason: rule.why, advice: rule.advice, basis: '内置冲突数据库 + 模组官方说明' });
        }
      }
      // 依据2：同名 Mixin 配置（同一注入点信号）
      const confA = mixinConfigs(path.join(modsDirOf(instanceId), a.file));
      const confB = mixinConfigs(path.join(modsDirOf(instanceId), b.file));
      if (confA.length && confB.length) {
        const common = confA.filter((c) => confB.includes(c));
        if (common.length) {
          issues.push({ level: 'high', mods: [a.name, b.name], reason: `两个模组包含同名的 Mixin 注入配置文件（${common.join('、')}），很可能修改同一段游戏代码导致启动失败。`, advice: '只保留其中一个；如果两个都需要，请到模组页面查找是否有兼容版本。', basis: '对两个模组 jar 文件内容的实际检查' });
        }
      }
    }
  }
  // 依据3：重复模组（同名不同版本）
  const byName = new Map();
  for (const m of enabled) {
    const key = (m.modIds || [])[0] || m.name.toLowerCase().replace(/[-_ ].*$/, '');
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(m);
  }
  for (const [key, arr] of byName) {
    if (arr.length > 1) {
      issues.push({ level: 'medium', mods: arr.map((m) => m.name + (m.version ? ' ' + m.version : '')), reason: `同一个模组（${key}）装了 ${arr.length} 份不同版本。`, advice: '只保留最新的一份，其余禁用或删除。', basis: '模组元数据比对' });
    }
  }
  // 依据4：前置缺失
  const have = new Set();
  for (const m of enabled) (m.modIds || []).forEach((x) => have.add(x));
  for (const m of enabled) {
    for (const dep of m.deps || []) {
      if (dep.required && !have.has(dep.id)) {
        issues.push({ level: 'high', mods: [m.name], reason: `「${m.name}」需要前置模组「${dep.id}」，但没有安装。`, advice: '点"自动修复"会尝试自动下载前置；也可以到模组页手动搜索安装。', basis: '模组元数据中的依赖声明', dep });
      }
    }
  }
  return issues;
}
const modsDirOf = (instanceId) => path.join(instanceDir(instanceId), 'mods');

// 安装前预检（对未安装的 jar 文件）
function precheck(instanceId, filePaths) {
  const inst = instances.get(instanceId);
  const list = mods.list(instanceId);
  const have = new Set();
  for (const m of list) (m.modIds || []).forEach((x) => have.add(x));
  const warnings = [];
  for (const p of filePaths) {
    const meta = mods.parseModMeta(p);
    // 依据1：与已安装模组的已知冲突
    for (const rule of KNOWN_CONFLICTS) {
      const newIsA = rule.a.test(meta.name) || rule.a.test((meta.modIds || []).join());
      for (const m of list) {
        if (rule.b.test(m.name) || rule.b.test((m.modIds || []).join())) {
          const [x, y] = newIsA ? [meta.name, m.name] : [m.name, meta.name];
          if (rule.a.test(y) && rule.b.test(x)) warnings.push({ level: 'high', mod: meta.name, reason: `与已安装的「${m.name}」存在已知冲突。${rule.why}`, advice: rule.advice, basis: '内置冲突数据库（来源：模组官方说明）' });
        }
      }
    }
    // 依据2：Mixin 同名注入
    const newMixins = mixinConfigs(p);
    if (newMixins.length) {
      for (const m of list) {
        const mMixins = mixinConfigs(path.join(modsDirOf(instanceId), m.file));
        const common = newMixins.filter((c) => mMixins.includes(c));
        if (common.length) warnings.push({ level: 'high', mod: meta.name, reason: `与已安装的「${m.name}」包含同名 Mixin 注入配置（${common.join('、')}），很可能不兼容。`, advice: '安装后如果游戏无法启动，请先禁用其中一个。', basis: 'jar 内容实际检查' });
      }
    }
    // 依据3：客户端/服务端专用
    if (CLIENT_SERVER_MARKS.test(meta.name)) {
      warnings.push({ level: 'low', mod: meta.name, reason: `模组名称带有客户端/服务端专用标记（${meta.name}）。`, advice: '客户端专用模组装到服务器（或反之）会导致加载失败，请确认用途。', basis: '模组命名特征' });
    }
    // 依据4：重复安装
    if ((meta.modIds || []).some((x) => have.has(x))) {
      warnings.push({ level: 'medium', mod: meta.name, reason: '你已安装了这个模组的另一个版本。', advice: '建议只保留一个版本。', basis: '模组元数据比对' });
    }
  }
  return warnings;
}

async function installByName(instanceId, modId, gameVersion, loader) {
  const r = await mods.search({ query: modId, gameVersion, loader: loader === 'vanilla' ? null : loader, limit: 3 });
  if (!r.length) throw new UserError('在 Modrinth 上没有找到叫「' + modId + '」的前置模组。请到模组页手动搜索安装。');
  const hit = r.find((x) => x.slug === modId) || r[0];
  return mods.install({ instanceId, projectId: hit.projectId, force: true });
}

async function autoFix(instanceId) {
  const issues = scanConflicts(instanceId);
  const actions = [];
  let ok = 0, failed = 0;
  const inst = instances.get(instanceId);
  for (const issue of issues) {
    try {
      if (issue.dep) {
        const r = await installByName(instanceId, issue.dep.id, inst.versionId, inst.loader);
        actions.push('为「' + issue.mods[0] + '」自动安装了前置「' + issue.dep.id + '」（来源 Modrinth）');
        ok++;
      } else if (issue.mods.length >= 2 && /装了/.test(issue.reason)) {
        const all = mods.list(instanceId);
        const dupName = issue.mods[0].replace(/ [\d.]+$/, '');
        const dups = all.filter((m) => m.enabled && (m.name === dupName || issue.mods.includes(m.name + (m.version ? ' ' + m.version : '')) || issue.mods.includes(m.name)));
        for (const dup of dups.slice(0, -1)) {
          mods.toggle(instanceId, dup.file, false);
          actions.push('禁用了重复的「' + dup.name + '」，保留最后一份（可在模组页重新启用）');
          ok++;
        }
      } else if (issue.mods.length >= 2 && /OptiFine/.test(issue.reason)) {
        const target = mods.list(instanceId).find((m) => /optifine/i.test(m.name) && m.enabled);
        if (target) { mods.toggle(instanceId, target.file, false); actions.push('禁用了「OptiFine」以解决与 Iris/Sodium 的冲突（可随时在模组页重新启用）'); ok++; }
      } else if (issue.mods.length >= 2) {
        actions.push('「' + issue.mods[0] + '」与「' + issue.mods[1] + '」无法同时使用，需要你选择保留哪一个：请打开模组页，禁用其中一个后再启动。');
      }
    } catch (e) {
      failed++;
      actions.push('修复「' + issue.mods.join('与') + '」失败了。可能的原因：' + (e.userMessage || e.message) + ' 下一步：可以到模组页手动搜索安装，或稍后重试。');
    }
  }
  const log = opLog(instanceId, { type: '自动修复', actions, ok, failed });
  return { ok, failed, actions, log };
}

function registerAll(register) {
  register({
    'modsdiag.graph': ({ instanceId }) => {
      const list = mods.list(instanceId);
      const nodes = list.map((m) => ({ id: (m.modIds || [])[0] || m.name, name: m.name, version: m.version, enabled: m.enabled, deps: (m.deps || []).map((d) => d.id), file: m.file }));
      const have = new Set(nodes.map((n) => n.id));
      const edges = [];
      for (const n of nodes) for (const dep of n.deps) edges.push({ from: n.id, to: dep, missing: !have.has(dep) && dep !== 'minecraft' && dep !== 'java' });
      // 循环依赖检测（依据：元数据依赖声明互相指向）
      const cycles = [];
      for (const n of nodes) for (const dep of n.deps) {
        const other = nodes.find((x) => x.id === dep);
        if (other?.deps.includes(n.id)) cycles.push([n.id, dep]);
      }
      const issues = scanConflicts(instanceId);
      return { nodes, edges, cycles, issues };
    },
    'modsdiag.precheck': ({ instanceId, paths }) => precheck(instanceId, paths || []),
    'modsdiag.autoFix': ({ instanceId }) => autoFix(instanceId),
    'modsdiag.opLog': ({ instanceId }) => {
      const p = path.join(instanceDir(instanceId), '.blockbox', '操作日志.json');
      try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return []; }
    },
    'modsdiag.updates': async ({ instanceId }) => {
      const inst = instances.get(instanceId);
      const list = mods.list(instanceId);
      const out = [];
      for (const m of list.slice(0, 30)) {
        const slug = (m.modIds || [])[0];
        if (!slug) continue;
        try {
          const versions = await sources.fetchJson(`https://api.modrinth.com/v2/project/${encodeURIComponent(slug)}/version?loaders=["${inst.loader}"]&game_versions=["${inst.versionId}"]`, { timeout: 8000 });
          const latest = versions[0];
          if (!latest) continue;
          // 分类依据：版本号主次位比较 + 发布时间
          const curV = String(m.version || '0');
          const newV = String(latest.version_number || '');
          const nums = (v) => v.split(/[.+,-]/).map((x) => parseInt(x, 10) || 0);
          const [a1, a2] = nums(curV), [b1, b2] = nums(newV);
          let level = 'none';
          if (newV !== curV && (b1 > a1 || (b1 === a1 && b2 > a2))) {
            level = b1 === a1 ? 'safe' : 'caution';
            if (m.version === '') level = 'caution';
          }
          if (level !== 'none') out.push({ name: m.name, current: curV || '（未识别版本号）', latest: newV, level, basis: 'Modrinth 官方版本数据 + 版本号比较', versionId: latest.id, date: latest.date_published });
        } catch { /* 单个模组查询失败不影响整体 */ }
      }
      const safe = out.filter((u) => u.level === 'safe');
      const advice = out.filter((u) => u.level === 'caution');
      return { updates: out, safeCount: safe.length, cautionCount: advice.length, classifyNote: '安全更新=同一大版本内的小更新（修复 bug 为主）；谨慎更新=跨大版本或无法确认版本号，可能改变游戏行为。' };
    },
    'modsdiag.applyUpdates': async ({ instanceId, versionIds }) => {
      const results = [];
      for (const vid of versionIds || []) {
        try {
          const v = await sources.fetchJson('https://api.modrinth.com/v2/version/' + vid);
          const primary = (v.files || []).find((f) => f.primary) || (v.files || [])[0];
          if (!primary) throw new Error('这个版本没有可下载的文件');
          const dir = path.join(instanceDir(instanceId), 'mods');
          fs.mkdirSync(dir, { recursive: true });
          await require('../core/download/manager').download({ name: primary.filename, type: '模组', url: primary.url, dest: path.join(dir, primary.filename), sha1: primary.hashes?.sha1 || null, size: primary.size || 0 });
          results.push({ versionId: vid, ok: true, file: primary.filename });
        } catch (e) { results.push({ versionId: vid, ok: false, message: e.message }); }
      }
      return results;
    },
  });
}
module.exports = { registerAll, scanConflicts, precheck };
