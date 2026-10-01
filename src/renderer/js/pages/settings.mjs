// 设置页：外观 / 主题包 / 主页 / 游戏 / 下载 / Java 管理 / 高级
import { api, on, bare } from '../api.js';
import { toast, confirmDialog, showDialog, emptyState, skeletonRows, progressBar, setBreadcrumb, escapeHtml } from '../ui.js';
import { applyTheme } from '../theme.js';
import { LOCALES } from '../i18n.mjs';

const ACCENTS = ['#4f8cff', '#3ecf7a', '#f0b13e', '#f26d6d', '#9d5cff', '#00b8d4', '#ff6f91', '#a3e635'];
const JAVA_CARDS = [
  { major: 8, desc: '适用于 Minecraft 1.7 – 1.16' },
  { major: 11, desc: '适用于 Minecraft 1.17 早期版本' },
  { major: 17, desc: '适用于 Minecraft 1.18 – 1.20.4' },
  { major: 21, desc: '适用于 Minecraft 1.20.5 及以上' },
];
const KEY_MASK = '********';
const FS_OPTIONS = [['sm', '小'], ['md', '中'], ['lg', '大'], ['xl', '特大']];
const PROXY_MODES = [
  { id: 'system', name: '跟随系统' },
  { id: 'none', name: '不使用代理' },
  { id: 'manual', name: '手动' },
];
const AFTER_LAUNCH = [
  { id: 'nothing', name: '不动作' },
  { id: 'minimize', name: '最小化' },
  { id: 'quit', name: '退出启动器' },
];
const KEY_TEST_KIND = { key: 'Key 错误', network: '网络错误', service: '服务不可用' };
const RESET_LEVELS = [
  { id: 'ui', name: '仅界面设置', desc: '把主题、字号、主页样式、下载源等全部设置恢复为默认值。实例、账户与已下载的游戏内容都不受影响。' },
  { id: 'cache', name: '仅缓存', desc: '清理下载缓存与日志文件，释放磁盘空间。实例、存档、账户都完好，游戏库文件需要时会自动重新下载。' },
  { id: 'instances', name: '全部实例', desc: '把所有实例（连同其中的模组、存档、备份）移入系统回收站，可在资源管理器中恢复；账户与设置保留。' },
  { id: 'all', name: '全部数据', desc: '恢复出厂状态：全部设置重置、所有实例移入回收站、皮肤库清空、账户文件转存为备份。建议先导出配置。' },
];
const TABS = [
  { id: 'appearance', label: '外观' },
  { id: 'packs', label: '主题包' },
  { id: 'homepage', label: '主页' },
  { id: 'game', label: '游戏' },
  { id: 'download', label: '下载' },
  { id: 'java', label: 'Java 管理' },
  { id: 'status', label: '启动器状态' },
  { id: 'advanced', label: '高级' },
];

let curTab = 'appearance';
let offs = [];
let S = null; // 当前设置副本
let presets = [];
let bootInfo = null;
let autoMemMb = null;
const javaBusy = new Map();
let bgPicking = false;

function reg(fn) { if (typeof fn === 'function') offs.push(fn); }
function cleanup() { offs.splice(0).forEach((f) => { try { f(); } catch { /* 忽略 */ } }); }

function isPlain(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function deepMerge(base, patch) {
  const out = isPlain(base) ? { ...base } : {};
  for (const k of Object.keys(patch || {})) {
    const v = patch[k];
    out[k] = isPlain(v) && isPlain(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out;
}

/* ---------- 保存（防抖） ---------- */
let pending = {};
let pendingText = '已保存';
let saveTimer = null;
function queueSave(patch, okText) {
  pendingText = okText || '已保存';
  S = deepMerge(S, patch);
  applyTheme(S);
  pending = deepMerge(pending, patch);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 450);
}
async function flushSave() {
  if (!Object.keys(pending).length) return;
  const patch = pending;
  pending = {};
  try {
    const saved = await api.settings.set(patch);
    if (saved && isPlain(saved)) S = deepMerge(saved, pending);
    applyTheme(S);
    toast(pendingText, 'ok', 1500);
  } catch (e) {
    toast('设置保存失败：' + (e.message || e) + '。请稍后重试，改动可能没有生效。', 'error', 5000);
  }
}

function friendlyErr(e) {
  const msg = String((e && e.message) || e || '未知错误');
  if (msg.includes('该功能的后台正在接通中')) return '该功能需要较新版本启动器支持';
  return msg;
}

function themeFields(p) {
  p = p || {};
  return {
    mode: p.mode || 'dark',
    color: p.color || '#4f8cff',
    background: p.background || null,
    blur: Number.isFinite(p.blur) ? p.blur : 0,
    dim: Number.isFinite(p.dim) ? p.dim : 0.35,
  };
}
function applyPreset(p) {
  queueSave({ theme: themeFields(p), currentThemeId: p.id || null }, `已应用主题「${p.name || '未命名'}」`);
  paintBody();
}

/* ---------- 页面骨架 ---------- */
async function renderPage(el) {
  cleanup();
  setBreadcrumb([{ label: '主页', onClick() { location.hash = '/'; } }, { label: '设置' }]);
  el.innerHTML = `<div class="col">${skeletonRows(5)}</div>`;
  try { S = await api.settings.get(); } catch (e) { renderLoadError(el, e); return; }
  await Promise.all([
    api.theme.presets().then((r) => { presets = r || []; }).catch(() => { presets = []; }),
    bare('bootstrap')().then((r) => { bootInfo = r || null; }).catch(() => { bootInfo = null; }),
    api.settings.autoMemory().then((r) => {
      autoMemMb = typeof r === 'number' ? r : ((r && (r.mb ?? r.memory ?? r.value)) ?? null);
    }).catch(() => { autoMemMb = null; }),
  ]);
  el.innerHTML = `
    <div class="tabs" id="settings-tabs"></div>
    <div id="settings-body"></div>`;
  paintTabs();
  paintBody();
  reg(on('bb:download-progress', onJavaProgress));
}

function renderLoadError(el, e) {
  el.innerHTML = emptyState({
    icon: '😵', title: '设置加载失败',
    text: '读取设置时出现问题：' + String(e.message || e) + '。可能是后台服务暂时不可用，请重试。',
    actionsHtml: '<button class="btn primary" id="settings-retry">重试</button>',
  });
  el.querySelector('#settings-retry').onclick = () => renderPage(el);
}

function paintTabs() {
  const bar = document.getElementById('settings-tabs');
  if (!bar) return;
  bar.innerHTML = TABS.map((t) => `<button class="tab ${curTab === t.id ? 'active' : ''}" data-tab="${t.id}">${t.label}</button>`).join('');
  bar.querySelectorAll('[data-tab]').forEach((b) => {
    b.onclick = () => { if (curTab !== b.dataset.tab) { curTab = b.dataset.tab; paintTabs(); paintBody(); } };
  });
}

function paintBody() {
  const box = document.getElementById('settings-body');
  if (!box || !S) return;
  box.innerHTML = '';
  if (curTab === 'appearance') tabAppearance(box);
  else if (curTab === 'packs') tabPacks(box);
  else if (curTab === 'homepage') tabHomepage(box);
  else if (curTab === 'game') tabGame(box);
  else if (curTab === 'download') tabDownload(box);
  else if (curTab === 'java') tabJava(box);
  else if (curTab === 'status') tabStatus(box);
  else tabAdvanced(box);
}

/* ---------- 外观 ---------- */
function tabAppearance(box) {
  const t = S.theme || {};
  const mode = t.mode || 'dark';
  const color = t.color || '#4f8cff';
  const hasBg = !!t.background;
  const dimPct = Math.round((Number.isFinite(t.dim) ? t.dim : 0.35) * 100);
  const fs = S.fontSize || 'md';
  const contrast = S.contrast === 'high' ? 'high' : 'normal';
  const reducedMotion = S.motion === 'reduced';
  const colorblind = !!S.colorblindMode;
  box.innerHTML = `
    <div class="section-title">外观模式</div>
    <div class="row" id="mode-row">
      ${[['light', '☀️ 亮色'], ['dark', '🌙 暗色'], ['system', '🖥️ 跟随系统']].map(([m, label]) =>
        `<button class="btn ${mode === m ? 'primary' : ''}" data-mode="${m}">${label}</button>`).join('')}
    </div>
    <div class="section-title">主题色</div>
    <div class="row wrap" id="accent-row">
      ${ACCENTS.map((c) => `<button data-color="${c}" data-tip="${c}" style="width:30px;height:30px;border-radius:8px;border:none;cursor:pointer;background:${c};${String(color).toLowerCase() === c ? 'box-shadow:0 0 0 2px var(--card),0 0 0 4px var(--accent);' : ''}"></button>`).join('')}
      <label class="row small muted" style="gap:8px;cursor:pointer;margin-left:6px">自定义
        <input type="color" id="accent-custom" value="${/^#[0-9a-fA-F]{6}$/.test(color) ? color : '#4f8cff'}" style="width:44px;height:30px;padding:2px;border:1px solid var(--border-2);border-radius:8px;background:var(--card);cursor:pointer">
      </label>
    </div>
    <div class="section-title">自定义背景图</div>
    ${hasBg ? `
      <div class="row">
        <img src="${escapeHtml(t.background)}" alt="背景图预览" style="width:220px;height:110px;object-fit:cover;border-radius:8px;border:1px solid var(--border)">
        <button class="btn danger sm" id="bg-remove">移除背景图</button>
      </div>` : `
      <div class="col" style="align-items:flex-start">
        <button class="btn" id="bg-pick">🖼️ 选择图片…</button>
        <div class="field-hint">支持 jpg / png / webp，过大的图片会自动压缩。</div>
      </div>`}
    <div class="grid cols-2 mt-3" style="max-width:640px">
      <label class="field">
        <span class="field-label">背景模糊度（<span id="blur-val">${Number(t.blur) || 0}</span> px）</span>
        <input type="range" class="slider" id="bg-blur" min="0" max="30" step="1" value="${Number(t.blur) || 0}">
      </label>
      <label class="field">
        <span class="field-label">背景暗化（<span id="dim-val">${dimPct}</span>%）</span>
        <input type="range" class="slider" id="bg-dim" min="0" max="100" step="1" value="${dimPct}">
      </label>
    </div>
    <div class="section-title">无障碍</div>
    <div class="col" style="gap:14px;max-width:640px">
      <div>
        <div class="field-label" style="margin-bottom:6px">界面字号</div>
        <div class="row" id="fs-row">
          ${FS_OPTIONS.map(([id, label]) => `<button class="btn ${fs === id ? 'primary' : ''}" data-fs="${id}">${label}</button>`).join('')}
        </div>
        <div class="field-hint">特大号时界面会整体放大，个别页面需要滚动。</div>
      </div>
      <label class="row" style="gap:12px;cursor:pointer;align-items:flex-start">
        <span class="switch" style="margin-top:1px"><input type="checkbox" id="a11y-contrast" ${contrast === 'high' ? 'checked' : ''}><span class="track"></span></span>
        <span class="col" style="gap:2px">
          <span class="small bold">高对比度模式</span>
          <span class="tiny muted">加深文字与背景对比，配合系统放大功能使用更好。</span>
        </span>
      </label>
      <label class="row" style="gap:12px;cursor:pointer;align-items:flex-start">
        <span class="switch" style="margin-top:1px"><input type="checkbox" id="a11y-motion" ${reducedMotion ? 'checked' : ''}><span class="track"></span></span>
        <span class="col" style="gap:2px">
          <span class="small bold">减少动态效果</span>
          <span class="tiny muted">关闭过渡与动画，适合容易晕动或使用辅助功能的用户。</span>
        </span>
      </label>
      <label class="row" style="gap:12px;cursor:pointer;align-items:flex-start">
        <span class="switch" style="margin-top:1px"><input type="checkbox" id="a11y-colorblind" ${colorblind ? 'checked' : ''}><span class="track"></span></span>
        <span class="col" style="gap:2px">
          <span class="small bold">色盲友好模式</span>
          <span class="tiny muted">成功/失败状态会附加 ✓/✕/⚠ 符号，不只靠颜色区分。</span>
        </span>
      </label>
    </div>`;

  box.querySelectorAll('#mode-row [data-mode]').forEach((b) => {
    b.onclick = () => queueSave({ theme: { ...(S.theme || {}), mode: b.dataset.mode } });
  });
  box.querySelectorAll('#accent-row [data-color]').forEach((b) => {
    b.onclick = () => queueSave({ theme: { ...(S.theme || {}), color: b.dataset.color } });
  });
  const custom = box.querySelector('#accent-custom');
  custom.oninput = () => queueSave({ theme: { ...(S.theme || {}), color: custom.value } });
  const blurEl = box.querySelector('#bg-blur');
  blurEl.oninput = () => {
    box.querySelector('#blur-val').textContent = blurEl.value;
    queueSave({ theme: { ...(S.theme || {}), blur: +blurEl.value } });
  };
  const dimEl = box.querySelector('#bg-dim');
  dimEl.oninput = () => {
    box.querySelector('#dim-val').textContent = dimEl.value;
    queueSave({ theme: { ...(S.theme || {}), dim: +dimEl.value / 100 } });
  };
  const pick = box.querySelector('#bg-pick');
  if (pick) pick.onclick = async () => {
    if (bgPicking) return;
    bgPicking = true;
    try {
      const p = await api.pick.file({ title: '选择背景图片', filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'] }] });
      if (!p) return;
      pick.disabled = true;
      pick.textContent = '正在处理图片…';
      let r = null;
      try { r = await api.theme.processBackground(p); } catch (e) { throw new Error('图片压缩失败：' + (e.message || e)); }
      const path = r && r.path ? r.path : p;
      queueSave({ theme: { ...(S.theme || {}), background: 'bbimg://' + encodeURIComponent(path) } }, '背景图已设置');
      paintBody();
    } catch (e) {
      toast('设置背景图失败：' + (e.message || e) + '。可以换一张图片再试。', 'error', 5000);
      paintBody();
    } finally { bgPicking = false; }
  };
  const rm = box.querySelector('#bg-remove');
  if (rm) rm.onclick = () => { queueSave({ theme: { ...(S.theme || {}), background: null } }, '已移除背景图'); paintBody(); };
  box.querySelectorAll('#fs-row [data-fs]').forEach((b) => {
    b.onclick = () => {
      if ((S.fontSize || 'md') === b.dataset.fs) return;
      queueSave({ fontSize: b.dataset.fs }, '界面字号已调整');
      box.querySelectorAll('#fs-row [data-fs]').forEach((x) => x.classList.toggle('primary', x.dataset.fs === b.dataset.fs));
    };
  });
  box.querySelector('#a11y-contrast').onchange = (e) =>
    queueSave({ contrast: e.target.checked ? 'high' : 'normal' }, e.target.checked ? '已开启高对比度模式' : '已关闭高对比度模式');
  box.querySelector('#a11y-motion').onchange = (e) =>
    queueSave({ motion: e.target.checked ? 'reduced' : 'normal' }, e.target.checked ? '已减少动态效果' : '已恢复动态效果');
  box.querySelector('#a11y-colorblind').onchange = (e) =>
    queueSave({ colorblindMode: e.target.checked }, e.target.checked ? '已开启色盲友好模式' : '已关闭色盲友好模式');
}

/* ---------- 主题包 ---------- */
function tabPacks(box) {
  const curId = S.currentThemeId || null;
  const custom = Array.isArray(S.customThemes) ? S.customThemes : [];
  const card = (t, isCustom) => `
    <div class="card" data-tid="${escapeHtml(t.id || '')}">
      <div class="row">
        <div style="width:40px;height:40px;border-radius:9px;flex:0 0 auto;background:${escapeHtml(t.color || '#4f8cff')}"></div>
        <div class="col" style="gap:2px;flex:1;min-width:0">
          <div class="bold ellipsis">${escapeHtml(t.name || '未命名主题')}</div>
          <div class="tiny muted">${t.mode === 'light' ? '亮色' : '暗色'} · 暗化 ${(Number.isFinite(t.dim) ? t.dim : 0.35).toFixed(2)}</div>
        </div>
        ${curId && curId === t.id ? '<span class="badge ok">使用中</span>' : ''}
      </div>
      <div class="row mt-2">
        <button class="btn sm primary" data-act="apply">应用</button>
        ${isCustom ? '<button class="btn sm danger" data-act="del">删除</button>' : ''}
      </div>
    </div>`;
  box.innerHTML = `
    <div class="row wrap mb-3">
      <div class="section-title" style="margin:0;flex:1">内置主题</div>
      <button class="btn sm" id="theme-export">导出当前主题</button>
      <button class="btn sm" id="theme-import">导入主题</button>
      <button class="btn sm primary" id="theme-save-current">保存当前为主题</button>
    </div>
    ${presets.length
      ? `<div class="grid cols-3">${presets.map((p) => card(p, false)).join('')}</div>`
      : '<div class="small muted mb-2">内置主题列表暂时无法获取（后台接通中），仍可使用下方自定义主题。</div>'}
    <div class="section-title">我的主题</div>
    ${custom.length
      ? `<div class="grid cols-3">${custom.map((t) => card(t, true)).join('')}</div>`
      : '<div class="small muted">还没有自定义主题。在外观里调好后，点上方「保存当前为主题」即可。</div>'}`;

  box.querySelectorAll('.card[data-tid]').forEach((c) => {
    const id = c.dataset.tid;
    const find = () => presets.find((p) => p.id === id) || (Array.isArray(S.customThemes) ? S.customThemes : []).find((x) => x.id === id);
    const applyBtn = c.querySelector('[data-act="apply"]');
    if (applyBtn) applyBtn.onclick = () => { const t = find(); if (t) applyPreset(t); };
    const del = c.querySelector('[data-act="del"]');
    if (del) del.onclick = async () => {
      const t = find();
      const ok = await confirmDialog('删除自定义主题', `「${(t && t.name) || id}」将被删除，删除后无法恢复。确定要删除吗？`, { danger: true, okLabel: '删除' });
      if (!ok) return;
      const patch = { customThemes: (Array.isArray(S.customThemes) ? S.customThemes : []).filter((x) => x.id !== id) };
      if (S.currentThemeId === id) patch.currentThemeId = null;
      queueSave(patch, '主题已删除');
      paintBody();
    };
  });

  box.querySelector('#theme-save-current').onclick = async () => {
    const r = await showDialog({
      title: '保存当前为主题',
      body: '<label class="field"><span class="field-label">主题名称</span><input class="input" id="theme-name-input" placeholder="例如：我的夜间主题"></label>',
      actions: [{ label: '取消', value: null }, { label: '保存', value: true, primary: true }],
      onMount(mask, close) {
        const inp = mask.querySelector('#theme-name-input');
        setTimeout(() => inp.focus(), 60);
        const btns = [...mask.querySelectorAll('.dialog-actions .btn')];
        const saveBtn = btns[btns.length - 1];
        saveBtn.onclick = () => {
          const v = inp.value.trim();
          if (!v) { toast('请先填写主题名称', 'warn'); return; }
          close({ name: v });
        };
      },
    });
    if (!r || !r.name) return;
    const list = Array.isArray(S.customThemes) ? S.customThemes.slice() : [];
    list.push({ id: 'custom-' + Date.now(), name: r.name, ...themeFields(S.theme) });
    queueSave({ customThemes: list }, '主题已保存');
    paintBody();
  };

  box.querySelector('#theme-export').onclick = async () => {
    try {
      const p = await api.pick.save({ title: '导出主题', defaultName: 'Wing Launch主题.mctheme', filters: [{ name: 'Wing Launch主题', extensions: ['mctheme'] }] });
      if (!p) return;
      await api.theme.exportTo(p);
      toast('主题已导出到所选位置', 'ok');
    } catch (e) {
      toast('导出失败：' + (e.message || e), 'error', 5000);
    }
  };

  box.querySelector('#theme-import').onclick = async () => {
    let p = null;
    try {
      p = await api.pick.file({ title: '选择主题文件', filters: [{ name: '主题文件', extensions: ['mctheme', 'json'] }] });
    } catch (e) { toast('无法打开文件选择器：' + (e.message || e), 'error'); return; }
    if (!p) return;
    let res = null;
    try { res = await api.theme.importFile(p); } catch (e) { toast('导入失败：' + (e.message || e), 'error', 5000); return; }
    if (res && res.ok && res.theme) {
      applyPreset({ ...res.theme, name: res.theme.name || '导入的主题' });
      toast('主题已导入并应用', 'ok');
      return;
    }
    if (res && res.ok === false && res.severity === 'partial') {
      toast(res.message || '主题文件部分内容无法识别，已尽量还原可用部分。', 'warn', 5000);
      if (res.theme) applyPreset({ ...res.theme, name: res.theme.name || '导入的主题' });
      return;
    }
    const act = await showDialog({
      title: '主题文件无法使用',
      body: `<p>${escapeHtml((res && res.message) || '这个主题文件读取失败，可能已损坏，或者不是「Wing Launch」导出的主题格式。')}</p>`,
      actions: [{ label: '忽略此文件', value: 'ignore' }, { label: '仍然导入基础配色', value: 'force', primary: true }],
    });
    if (act === 'force') {
      if (res && res.theme) {
        applyPreset({ ...res.theme, name: res.theme.name || '导入的主题' });
        toast('已导入文件中的基础配色', 'ok');
      } else {
        toast('文件中没有可以恢复的配色信息', 'warn');
      }
    }
  };
}

/* ---------- 主页 ---------- */
function tabHomepage(box) {
  const hp = S.homepage === 'immersive' ? 'immersive' : 'classic';
  const opts = [
    { id: 'classic', icon: '🧱', name: '经典主页', desc: '信息分区清晰，实例、快捷入口、下载进度一目了然。' },
    { id: 'immersive', icon: '🌌', name: '沉浸主页', desc: '用当前实例封面做全屏展示，启动更专注、更有氛围。' },
  ];
  box.innerHTML = `
    <div class="grid cols-2">
      ${opts.map((o) => `
        <div class="card hoverable" data-hp="${o.id}" style="${hp === o.id ? 'border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)' : ''}">
          <div class="row">
            <div style="font-size:26px">${o.icon}</div>
            <div style="flex:1;min-width:0"><div class="bold">${o.name}</div><div class="small muted">${o.desc}</div></div>
            ${hp === o.id ? '<span class="badge accent">使用中</span>' : ''}
          </div>
        </div>`).join('')}
    </div>
    <div class="field-hint mt-2">切换后整个界面的布局会立即变化，随时可以改回来。</div>`;
  box.querySelectorAll('[data-hp]').forEach((c) => {
    c.onclick = () => {
      if (c.dataset.hp !== hp) queueSave({ homepage: c.dataset.hp }, `已切换到${c.dataset.hp === 'immersive' ? '沉浸' : '经典'}主页`);
      paintBody();
    };
  });
}

/* ---------- 游戏 ---------- */
function tabGame(box) {
  const isAuto = S.memory === 'auto' || S.memory == null;
  const manualVal = typeof S.memory === 'number' ? S.memory : 4096;
  const width = Number.isFinite(S.width) ? S.width : 1280;
  const height = Number.isFinite(S.height) ? S.height : 720;
  box.innerHTML = `
    <div class="section-title">内存</div>
    <div class="row mb-2">
      <button class="btn ${isAuto ? 'primary' : ''}" id="mem-auto">自动（推荐）</button>
      <button class="btn ${!isAuto ? 'primary' : ''}" id="mem-manual">手动</button>
    </div>
    ${isAuto
      ? `<div class="field-hint">自动约为 ${autoMemMb ? autoMemMb + ' MB' : '电脑可用内存的一半（当前无法获取具体数值）'}，启动器会按需分配，无需关心细节。</div>`
      : `<label class="field" style="max-width:420px">
          <span class="field-label">游戏可用内存（<span id="mem-val">${manualVal}</span> MB）</span>
          <input type="range" class="slider" id="mem-slider" min="1024" max="16384" step="512" value="${manualVal}">
          <div class="field-hint">内存太小游戏会卡顿甚至崩溃，太大可能拖慢系统，建议 4096 – 8192 MB。</div>
        </label>`}
    <div class="section-title">游戏窗口</div>
    <div class="row wrap" style="align-items:flex-end">
      <label class="field" style="width:150px;margin-bottom:0"><span class="field-label">宽度（px）</span><input type="number" class="input" id="win-w" value="${width}" min="100" max="10000"></label>
      <label class="field" style="width:150px;margin-bottom:0"><span class="field-label">高度（px）</span><input type="number" class="input" id="win-h" value="${height}" min="100" max="10000"></label>
      <label class="row" style="gap:8px;cursor:pointer;margin-bottom:8px">
        <span class="switch"><input type="checkbox" id="win-fs" ${S.fullscreen ? 'checked' : ''}><span class="track"></span></span>
        <span>以全屏启动</span>
      </label>
    </div>
    <div class="field-hint mt-2">这里是新实例的默认窗口参数，已有实例可以在实例设置里单独调整。</div>`;

  box.querySelector('#mem-auto').onclick = () => { queueSave({ memory: 'auto' }, '内存已设为自动'); paintBody(); };
  box.querySelector('#mem-manual').onclick = () => { queueSave({ memory: manualVal }, '内存已设为手动'); paintBody(); };
  const slider = box.querySelector('#mem-slider');
  if (slider) slider.oninput = () => {
    box.querySelector('#mem-val').textContent = slider.value;
    queueSave({ memory: +slider.value });
  };
  const wEl = box.querySelector('#win-w');
  const hEl = box.querySelector('#win-h');
  wEl.onchange = () => {
    const v = Math.max(100, Math.min(10000, Math.round(+wEl.value || 0)));
    wEl.value = v;
    queueSave({ width: v });
  };
  hEl.onchange = () => {
    const v = Math.max(100, Math.min(10000, Math.round(+hEl.value || 0)));
    hEl.value = v;
    queueSave({ height: v });
  };
  box.querySelector('#win-fs').onchange = (e) => queueSave({ fullscreen: e.target.checked });
}

/* ---------- 下载 ---------- */
function tabDownload(box) {
  const cur = S.downloadSource || 'auto';
  const opts = [
    { id: 'auto', name: '自动选择（推荐）', desc: '自动模式会先尝试官方源，网络不畅时自动切换国内镜像。' },
    { id: 'official', name: '官方源', desc: '始终从 Mojang 官方服务器下载，最稳定，但国内网络可能较慢。' },
    { id: 'mirror', name: '国内镜像', desc: '始终从国内镜像下载，速度快，但新版本同步可能稍有延迟。' },
  ];
  box.innerHTML = `
    <div class="col" style="gap:10px;max-width:640px">
      ${opts.map((o) => `
        <div class="card hoverable" data-src="${o.id}" style="${cur === o.id ? 'border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)' : ''}">
          <div class="row">
            <div style="flex:1;min-width:0"><div class="bold">${o.name}</div><div class="small muted">${o.desc}</div></div>
            ${cur === o.id ? '<span class="badge accent">使用中</span>' : ''}
          </div>
        </div>`).join('')}
    </div>
    <div class="field-hint mt-2">下载源影响游戏文件、模组等资源的下载速度，一般保持「自动选择」即可。</div>`;
  box.querySelectorAll('[data-src]').forEach((c) => {
    c.onclick = () => { queueSave({ downloadSource: c.dataset.src }, '已切换下载源'); paintBody(); };
  });
}

/* ---------- Java 管理 ---------- */
function javaCardHtml(j) {
  const busy = javaBusy.get(j.major);
  return `
  <div class="card" data-java-card="${j.major}">
    <div class="bold">Java ${j.major}</div>
    <div class="tiny muted" style="min-height:34px">${j.desc}</div>
    ${busy
      ? `<div class="mt-2">${progressBar(busy.percent, { thin: true })}
         <div class="tiny muted mt-1">${busy.percent != null ? '已下载 ' + busy.percent + '%' : '正在下载…'}</div></div>`
      : `<button class="btn sm mt-2" data-java-dl="${j.major}">下载</button>`}
  </div>`;
}
function updateJavaCards() {
  const cards = [...document.querySelectorAll('[data-java-card]')];
  for (const cardEl of cards) {
    const major = +cardEl.dataset.javaCard;
    const j = JAVA_CARDS.find((x) => x.major === major);
    if (!j) continue;
    const tmp = document.createElement('div');
    tmp.innerHTML = javaCardHtml(j);
    cardEl.replaceWith(tmp.firstElementChild);
  }
  for (const b of document.querySelectorAll('[data-java-dl]')) {
    b.onclick = () => downloadJava(+b.dataset.javaDl);
  }
}
async function downloadJava(major) {
  if (javaBusy.has(major)) return;
  javaBusy.set(major, { percent: null });
  updateJavaCards();
  try {
    await api.java.download({ major });
    javaBusy.delete(major);
    toast(`Java ${major} 下载完成`, 'ok');
    updateJavaCards();
    const list = document.getElementById('java-list');
    if (list) refreshJavaList(list);
  } catch (e) {
    javaBusy.delete(major);
    updateJavaCards();
    toast(`Java ${major} 下载失败：${e.message || e}。可以稍后重试，启动器在需要时也会自动下载。`, 'error', 6000);
  }
}
function onJavaProgress(d) {
  if (!document.getElementById('java-cards')) return;
  const text = String(((d && d.name) || '') + ' ' + ((d && d.type) || ''));
  if (!/java/i.test(text)) return;
  const m = text.match(/(\d{1,2})/);
  const major = m ? +m[1] : null;
  if (!major || !JAVA_CARDS.some((j) => j.major === major) || !javaBusy.has(major)) return;
  const total = (d && d.total) || 0;
  javaBusy.set(major, { percent: total ? Math.round(((d.received || 0) / total) * 100) : null });
  updateJavaCards();
}
async function refreshJavaList(holder) {
  if (!holder) return;
  try {
    const list = (await api.java.list()) || [];
    if (!list.length) {
      holder.innerHTML = '<div class="small muted">没有检测到已安装的 Java。下方提供常用版本的快捷下载，平时启动器也会按需自动下载，一般不用操心。</div>';
      return;
    }
    holder.innerHTML = `
      <table class="tbl">
        <thead><tr><th>版本</th><th>厂商</th><th>来源</th><th>路径</th><th></th></tr></thead>
        <tbody>
          ${list.map((r) => `
            <tr>
              <td class="bold">Java ${escapeHtml(String(r.major ?? ''))}${r.version ? `<span class="tiny muted"> (${escapeHtml(r.version)})</span>` : ''}</td>
              <td>${escapeHtml(r.vendor || '未知')}</td>
              <td>${r.source === 'downloaded' ? '<span class="badge ok">启动器下载</span>' : '<span class="badge">系统</span>'}</td>
              <td><code class="ellipsis" data-tip="${escapeHtml(r.path || '')}" style="display:inline-block;max-width:300px;vertical-align:middle">${escapeHtml(r.path || '')}</code></td>
              <td style="text-align:right"><button class="btn sm danger" data-java-rm="${r.major}">删除</button></td>
            </tr>`).join('')}
        </tbody>
      </table>`;
    holder.querySelectorAll('[data-java-rm]').forEach((b) => {
      b.onclick = async () => {
        const major = +b.dataset.javaRm;
        const row = list.find((x) => +x.major === major);
        const ok = await confirmDialog('删除这个 Java？',
          `将删除 Java ${major}${row && row.version ? '（' + row.version + '）' : ''} 的运行时文件。已创建的实例不受影响，下次需要时会自动重新下载。`,
          { danger: true, okLabel: '删除' });
        if (!ok) return;
        try {
          await api.java.remove({ major });
          toast(`已删除 Java ${major}`, 'ok');
          refreshJavaList(holder);
        } catch (e) {
          toast('删除失败：' + (e.message || e), 'error', 5000);
        }
      };
    });
  } catch (e) {
    holder.innerHTML = `<div class="small muted">Java 列表读取失败：${escapeHtml(e.message || String(e))}<button class="btn sm" id="java-retry" style="margin-left:10px">重试</button></div>`;
    const rt = holder.querySelector('#java-retry');
    if (rt) rt.onclick = () => refreshJavaList(holder);
  }
}
function tabJava(box) {
  box.innerHTML = `
    <div class="section-title">已安装的 Java</div>
    <div id="java-list"><div class="row muted small"><div class="spinner sm"></div>正在读取 Java 列表…</div></div>
    <div class="section-title">缺少 Java？在这里下载</div>
    <div class="grid cols-4" id="java-cards">
      ${JAVA_CARDS.map((j) => javaCardHtml(j)).join('')}
    </div>
    <div class="field-hint mt-3">启动器会为每个实例自动匹配所需 Java 版本，一般无需手动操作。</div>`;
  refreshJavaList(box.querySelector('#java-list'));
  updateJavaCards();
}

/* ---------- 启动器状态 ---------- */
function fmtBytes(n) {
  n = Number(n);
  if (!Number.isFinite(n) || n < 0) return '未知大小';
  if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(2) + ' GB';
  if (n >= 1024 ** 2) return (n / 1024 ** 2).toFixed(1) + ' MB';
  if (n >= 1024) return Math.round(n / 1024) + ' KB';
  return Math.round(n) + ' B';
}

async function tabStatus(box) {
  box.innerHTML = `<div class="col">${skeletonRows(4)}</div>`;
  let h = null, err = '';
  try { h = await api.app.health(); } catch (e) { err = e.message || String(e); }
  if (!h || !isPlain(h)) {
    box.innerHTML = emptyState({
      icon: '😵', title: '启动器状态读取失败',
      text: '读取状态信息时出现问题：' + String(err || '原因未知') + '。可能是后台服务暂时不可用，请稍后重试。',
      actionsHtml: '<button class="btn primary" id="status-retry">重试</button>',
    });
    box.querySelector('#status-retry').onclick = () => tabStatus(box);
    return;
  }
  const sizes = isPlain(h.sizes) ? h.sizes : {};
  const cacheBytes = Number(sizes.cache) || 0;
  const javas = Array.isArray(h.javas) ? h.javas : [];
  const sizeRow = (label, v) => `<div class="row" style="padding:7px 4px;border-bottom:1px solid var(--border)"><span class="small">${escapeHtml(String(label))}</span><span class="spacer"></span><span class="small bold">${fmtBytes(v)}</span></div>`;
  const appVer = String(h.version || (bootInfo && bootInfo.appVersion) || '未知');
  box.innerHTML = `
    <div class="grid cols-2" style="max-width:880px">
      <div class="card">
        <div class="row"><span style="font-size:22px">📦</span><div class="bold">启动器版本</div></div>
        <div class="small mt-1">版本：v${escapeHtml(appVer)} · ${escapeHtml(String(h.channel || '稳定版'))}</div>
        ${h.dataDir ? `<div class="small muted ellipsis mt-1" data-tip="${escapeHtml(String(h.dataDir))}" style="max-width:360px">数据目录：${escapeHtml(String(h.dataDir))}</div>
        <div class="row mt-2"><button class="btn sm" id="status-open-dir">📁 打开数据目录</button></div>` : ''}
      </div>
      <div class="card">
        <div class="row"><span style="font-size:22px">💾</span><div class="bold">磁盘占用</div></div>
        <div class="col mt-1">
          ${sizeRow('已安装的实例', sizes.instances)}
          ${sizeRow('资源文件', sizes.assets)}
          ${sizeRow('游戏库文件', sizes.libraries)}
          ${sizeRow('版本文件', sizes.versions)}
          ${sizeRow('下载缓存', sizes.cache)}
          ${sizeRow('回收站', sizes.trash)}
        </div>
      </div>
      <div class="card">
        <div class="row"><span style="font-size:22px">🧠</span><div class="bold">启动器内存占用</div></div>
        <div class="small mt-1" id="mem-render-line"></div>
        <div class="small muted mt-1">空闲时整个启动器约 120-180MB（Electron 运行时）。</div>
        <div class="row mt-2"><button class="btn sm" id="status-free-mem">🧴 释放内存</button></div>
      </div>
    </div>
    ${h.lastCrash ? `
    <div class="card mt-3" style="border-left:3px solid var(--warn);max-width:880px">
      <div class="row"><span style="font-size:20px">⚠️</span>
        <div class="col" style="gap:2px;flex:1;min-width:0">
          <div class="bold small" style="color:var(--warn)">上次崩溃提示</div>
          <div class="small muted">启动器上次运行时检测到一次异常退出（${escapeHtml(String(h.lastCrash))}）。你的实例与账户数据不受影响；如果再次遇到问题，可以到实例详情里使用崩溃分析。</div>
        </div>
      </div>
    </div>` : ''}
    <div class="card mt-3" style="max-width:880px">
      <div class="row"><span style="font-size:20px">🩺</span><div class="bold">上次退出自检</div></div>
      <div class="col mt-2" id="selfcheck-body">
        <div class="row small muted" style="gap:8px"><div class="spinner sm"></div><span>正在自检…</span></div>
      </div>
    </div>
    <div class="section-title">已安装的 Java 运行时</div>
    ${javas.length
      ? `<div class="col" style="max-width:880px">${javas.map((j) => sizeRow('Java ' + (j.major ?? '未知'), j.size)).join('')}</div>`
      : '<div class="small muted">没有检测到启动器下载的 Java 运行时。启动游戏需要时会自动下载，无需提前准备。</div>'}
    <div class="section-title">维护</div>
    <div class="row wrap">
      <button class="btn" id="status-clear-cache">🧹 清理缓存</button>
      <button class="btn" id="status-export">📤 导出启动器配置</button>
      <button class="btn" id="status-import">📥 恢复配置</button>
    </div>
    <div class="field-hint">清理缓存只删除下载缓存与临时文件，不影响已安装的实例与账户。导出 / 恢复配置与「高级」页里的按钮功能相同，导出的配置不含令牌与 API Key。</div>`;

  const openBtn = box.querySelector('#status-open-dir');
  if (openBtn) openBtn.onclick = async () => {
    try { await api.shell.openPath(h.dataDir); } catch (e) { toast('打开数据目录失败：' + friendlyErr(e), 'error', 5000); }
  };
  box.querySelector('#status-clear-cache').onclick = async () => {
    const ok = await confirmDialog('清理下载缓存', `将删除 ${fmtBytes(cacheBytes)} 的下载缓存（资源文件与临时文件），不影响已安装的实例和账户。继续吗？`, { okLabel: '清理' });
    if (!ok) return;
    try {
      const r = await api.data.reset({ level: 'cache' });
      toast((r && r.message) || '缓存已清理', 'ok', 5000);
      tabStatus(box);
    } catch (e) {
      toast('清理缓存失败：' + friendlyErr(e) + '。可以稍后再试。', 'error', 5000);
    }
  };
  box.querySelector('#status-export').onclick = () => dataExportFlow(box.querySelector('#status-export'));
  box.querySelector('#status-import').onclick = () => dataImportFlow();

  /* 启动器内存占用（主进程暂无实时接口，仅展示界面进程堆内存与经验估计） */
  const mem = (typeof performance !== 'undefined' && performance.memory) ? performance.memory : null;
  const memLine = box.querySelector('#mem-render-line');
  if (memLine) {
    memLine.textContent = (mem && Number(mem.usedJSHeapSize) > 0)
      ? `界面进程堆内存约 ${fmtBytes(mem.usedJSHeapSize)}（实时，未含主进程）。`
      : '暂时读不到实时数值，以下为经验估计。';
  }
  box.querySelector('#status-free-mem').onclick = () => {
    if (typeof window.gc === 'function') {
      try { window.gc(); toast('已请求回收内存', 'ok', 2500); }
      catch { toast('回收失败；关闭不用的页面或重启启动器可释放内存', 'info', 5000); }
      return;
    }
    toast('启动器无法手动回收内存；关闭不用的页面或重启启动器可释放内存', 'info', 6000);
  };

  /* 上次退出自检 */
  const scBody = box.querySelector('#selfcheck-body');
  (async () => {
    if (!scBody) return;
    let r = null;
    try { r = await api.selfcheck.run(); } catch (e) {
      scBody.innerHTML = `<div class="tiny muted">自检信息暂时拿不到（${escapeHtml(friendlyErr(e))}），不影响正常使用。</div>`;
      return;
    }
    const checks = Array.isArray(r && r.checks) ? r.checks : [];
    const rowHtml = (c) => {
      const ok = !!c && (c.ok === true || c.ok === 'true' || c.status === 'ok');
      const name = String((c && (c.name || c.id || c.title)) || '检查项');
      const detail = String((c && (c.detail || c.message || c.reason)) || '');
      return `<div class="row" style="padding:6px 0; gap:8px; border-bottom:1px solid var(--border)">
        <span class="small">${escapeHtml(name)}</span>
        <span class="badge ${ok ? 'ok' : 'err'}">${ok ? '正常' : '异常'}</span>
        ${detail ? `<span class="spacer"></span><span class="tiny muted-3 ellipsis" style="max-width:55%" data-tip="${escapeHtml(detail)}">${escapeHtml(detail)}</span>` : ''}
      </div>`;
    };
    let crashHtml = '';
    const crash = r && r.crash;
    if (crash) {
      const reason = typeof crash === 'string'
        ? crash
        : String((crash && (crash.reason || crash.message || crash.text)) || '原因未知');
      crashHtml = `
        <div class="mt-2" id="selfcheck-crash" style="padding:10px 12px; border-radius:8px; background:color-mix(in srgb, var(--warn) 8%, var(--card)); border:1px solid color-mix(in srgb, var(--warn) 45%, transparent)">
          <div class="bold small" style="color:var(--warn)">上次启动器异常退出</div>
          <div class="small muted mt-1">${escapeHtml(reason)}。你的实例与账户数据不受影响。</div>
          <button class="btn sm mt-2" id="selfcheck-ack">知道了</button>
        </div>`;
    }
    scBody.innerHTML = `${checks.length ? checks.map(rowHtml).join('') : '<div class="tiny muted">没有可显示的检查项。</div>'}${crashHtml}`;
    const ackBtn = scBody.querySelector('#selfcheck-ack');
    if (ackBtn) ackBtn.onclick = async () => {
      try { await api.selfcheck.ackCrash(); } catch (e) { toast('确认失败：' + friendlyErr(e), 'error', 5000); return; }
      const crashCard = scBody.querySelector('#selfcheck-crash');
      if (crashCard) crashCard.remove();
      toast('已确认，下次打开不再提示', 'ok', 2500);
    };
  })();
}

/* ---------- 导出 / 导入配置（状态页与高级页共用） ---------- */
async function dataExportFlow(btn) {
  if (btn) btn.disabled = true;
  let data = null;
  try { data = await api.data.export(); } catch (e) { if (btn) btn.disabled = false; toast('导出失败：' + friendlyErr(e), 'error', 5000); return; }
  const text = JSON.stringify(data, null, 2);
  let pickFailed = false;
  const p = await api.pick.save({ title: '导出配置备份', defaultName: 'Wing Launch配置备份.json', filters: [{ name: '配置备份', extensions: ['json'] }] })
    .catch(() => { pickFailed = true; return null; });
  if (p) {
    try {
      await api.data.save({ path: p, text });
      toast('配置已导出到所选位置', 'ok');
      if (btn) btn.disabled = false;
      return;
    } catch { /* 保存路由不可用，改走剪贴板 */ }
  } else if (!pickFailed) {
    if (btn) btn.disabled = false;
    return; /* 用户取消了保存对话框 */
  }
  try {
    await api.clip.write(text);
    toast('已把配置文本复制到剪贴板，请粘贴到文本编辑器并保存为 .json 文件（内容不含令牌与 API Key）。', 'info', 6000);
  } catch (e) {
    toast('导出失败：' + friendlyErr(e), 'error', 5000);
  }
  if (btn) btn.disabled = false;
}

async function dataImportFlow() {
  const data = await showDialog({
    title: '导入配置',
    wide: true,
    body: `<p class="small muted" style="margin-top:0">用文本编辑器打开之前导出的 .json 备份文件，全选复制其中的内容，粘贴到下面：</p>
      <textarea class="input" id="import-json-text" rows="9" style="width:100%;resize:vertical" placeholder="粘贴配置备份的 JSON 文本…"></textarea>
      <div class="field-hint">导入的账户只保留昵称等信息，需要重新登录；部分设置可能要重启启动器后才完全生效。</div>`,
    actions: [{ label: '取消', value: null }, { label: '导入', value: true, primary: true }],
    onMount(mask, close) {
      const ta = mask.querySelector('#import-json-text');
      setTimeout(() => ta.focus(), 60);
      const okBtn = [...mask.querySelectorAll('.dialog-actions .btn')].pop();
      okBtn.onclick = () => {
        const text = ta.value.trim();
        if (!text) { toast('请先粘贴配置备份的 JSON 文本', 'warn'); return; }
        let parsed;
        try { parsed = JSON.parse(text); } catch { toast('粘贴的内容不是有效的 JSON，请确认复制了完整内容再试。', 'error', 4000); return; }
        close(parsed);
      };
    },
  });
  if (!data) return;
  try {
    const res = await api.data.import({ data });
    toast((res && res.message) || '配置已导入', 'ok', 5000);
  } catch (e) {
    toast('导入失败：' + friendlyErr(e), 'error', 5000);
  }
}

/* ---------- 高级 ---------- */
function tabAdvanced(box) {
  const tr = S.translate || {};
  const proxy = isPlain(S.proxy) ? S.proxy : {};
  let proxyMode = PROXY_MODES.some((m) => m.id === proxy.mode) ? proxy.mode : 'system';
  const offline = !!S.offlineMode;
  const hasKey = !!tr.apiKey;
  const devMode = !!S.devMode;
  const localApiEnabled = !!S.localApiEnabled;
  const syncConf = isPlain(S.sync) ? S.sync : {};
  const syncEnabled = !!syncConf.enabled;
  const syncFolder = syncConf.folder || '';
  const lang = LOCALES[S.language] ? S.language : 'zh-CN';
  let afterLaunch = AFTER_LAUNCH.some((m) => m.id === S.afterLaunch) ? S.afterLaunch : 'nothing';
  const appVer = (bootInfo && bootInfo.appVersion) || window.__APP_VERSION__ || '';
  box.innerHTML = `
    <div class="card mb-3" style="border-left:3px solid var(--accent)">
      <div class="row">
        <span style="font-size:22px">🚀</span>
        <div class="col" style="gap:2px;flex:1;min-width:0">
          <div class="bold small">想优化游戏性能？</div>
          <div class="small muted">针对你的 Mac 与模组数量的一键优化建议，在『性能』页面</div>
        </div>
        <button class="btn sm primary" id="go-performance">前往性能页</button>
      </div>
    </div>
    <div class="section-title">微软登录</div>
    <label class="field" style="max-width:460px">
      <span class="field-label">微软登录应用 ID（Azure Client ID）</span>
      <input class="input" id="ms-client-id" value="${escapeHtml(S.msClientId || '')}" placeholder="留空使用内置公共应用 ID">
      <div class="field-hint">使用自己的 Azure 应用可提高登录成功率；不确定就直接留空。</div>
    </label>

    <div class="section-title">离线模式</div>
    <label class="row" style="gap:12px;cursor:pointer">
      <span class="switch"><input type="checkbox" id="offline-mode" ${offline ? 'checked' : ''}><span class="track"></span></span>
      <span class="small bold">开启离线模式</span>
    </label>
    <div class="card mt-2" id="offline-detail" style="max-width:640px;${offline ? '' : 'display:none'}">
      <div class="small bold">开启后将不可用</div>
      <div class="small muted">资源与游戏的在线下载、在线搜索、微软 / 第三方在线登录、模组翻译。</div>
      <div class="small bold mt-2">仍然可用</div>
      <div class="small muted">已下载的游戏与实例、模组 / 存档 / 皮肤等本地管理和工具集，以及联机房间、局域网直连中的本地功能。</div>
    </div>
    <div class="field-hint">离线模式不会删除任何数据，随时关闭即可恢复正常联网功能。</div>

    <div class="section-title">代理设置</div>
    <div class="row wrap" id="proxy-mode-row">
      ${PROXY_MODES.map((m) => `<button class="btn ${proxyMode === m.id ? 'primary' : ''}" data-pm="${m.id}">${m.name}</button>`).join('')}
    </div>
    <div id="proxy-manual-wrap" style="${proxyMode === 'manual' ? '' : 'display:none'}">
      <div class="row wrap mt-2" style="align-items:flex-end">
        <label class="field" style="width:280px;margin-bottom:0"><span class="field-label">代理服务器地址</span><input class="input" id="proxy-host" value="${escapeHtml(String(proxy.host || ''))}" placeholder="例如 127.0.0.1"></label>
        <label class="field" style="width:140px;margin-bottom:0"><span class="field-label">端口</span><input type="number" class="input" id="proxy-port" value="${escapeHtml(proxy.port == null ? '' : String(proxy.port))}" placeholder="例如 7890" min="1" max="65535"></label>
      </div>
    </div>
    <div class="row mt-2" style="align-items:center">
      <button class="btn sm" id="proxy-test">测试连接</button>
      <span class="small" id="proxy-test-result"></span>
    </div>
    <div class="field-hint">代理用于下载与在线服务的网络访问；「跟随系统」会读取系统网络设置。</div>

    <div class="section-title">AI 翻译</div>
    <div class="grid cols-3" style="max-width:720px">
      <label class="field"><span class="field-label">API 地址</span><input class="input" id="tr-base" value="${escapeHtml(tr.apiBase || '')}" placeholder="https://…"></label>
      <label class="field"><span class="field-label">模型</span><input class="input" id="tr-model" value="${escapeHtml(tr.model || '')}" placeholder="例如 gpt-4o-mini"></label>
      <label class="field"><span class="field-label">API Key</span><input class="input" id="tr-key" type="password" autocomplete="off" value="${escapeHtml(tr.apiKey || '')}" placeholder="${hasKey ? '已保存（掩码显示），输入新 Key 可覆盖' : 'sk-…'}"></label>
    </div>
    <div class="row" style="align-items:center">
      <button class="btn sm" id="tr-key-test">测试连接</button>
      <span class="small" id="tr-key-test-result"></span>
    </div>
    <div class="field-hint">仅模组翻译功能使用。Key 会保存在 macOS 钥匙串中，不会写入配置文件或日志。</div>

    <div class="section-title">开发者模式</div>
    <label class="row" style="gap:12px;cursor:pointer">
      <span class="switch"><input type="checkbox" id="dev-mode" ${devMode ? 'checked' : ''}><span class="track"></span></span>
      <span class="small bold">开启开发者模式</span>
    </label>
    <div class="field-hint">开启后显示详细日志、允许手动改 Java 路径和 JVM 参数、查看实例完整文件列表。普通玩家不需要开启，日常功能完全不受影响。</div>

    <div class="section-title">启动后动作</div>
    <div class="row wrap" id="after-launch-row">
      ${AFTER_LAUNCH.map((m) => `<button class="btn ${afterLaunch === m.id ? 'primary' : ''}" data-al="${m.id}">${m.name}</button>`).join('')}
    </div>
    <div class="field-hint" id="after-launch-hint"></div>

    <div class="section-title">本地 API</div>
    <label class="row" style="gap:12px;cursor:pointer">
      <span class="switch"><input type="checkbox" id="local-api-enabled" ${localApiEnabled ? 'checked' : ''}><span class="track"></span></span>
      <span class="small bold">允许本机程序通过 API 控制启动器</span>
    </label>
    <div class="field-hint">API 仅监听本机，外部设备无法访问；但拿到令牌的本机程序可以控制启动器，请勿把令牌交给不信任的脚本。</div>
    <div id="local-api-panel" style="${localApiEnabled ? '' : 'display:none'}">
      <div class="row wrap mt-2" style="align-items:flex-end">
        <label class="field" style="width:170px;margin-bottom:0"><span class="field-label">端口（留空自动分配）</span><input type="number" class="input" id="local-api-port" placeholder="自动" min="1" max="65535"></label>
        <button class="btn sm primary" id="local-api-start" style="margin-bottom:4px">启动 API</button>
        <button class="btn sm" id="local-api-stop" style="margin-bottom:4px;display:none">停止</button>
        <span class="small muted" id="local-api-state"></span>
      </div>
      <div id="local-api-result" class="mt-2"></div>
    </div>

    <div class="section-title">界面语言</div>
    <label class="field" style="max-width:280px">
      <span class="field-label">语言</span>
      <select class="input" id="ui-language">
        ${Object.keys(LOCALES).map((k) => `<option value="${k}" ${lang === k ? 'selected' : ''}>${escapeHtml(LOCALES[k].name)}${LOCALES[k].complete ? '（完整）' : ''}</option>`).join('')}
      </select>
    </label>
    <div class="field-hint">非中文语言仅翻译了部分界面文字，其余自动回退为简体中文。</div>

    <div class="section-title">云同步（可选，默认关闭）</div>
    <label class="row" style="gap:12px;cursor:pointer">
      <span class="switch"><input type="checkbox" id="sync-enabled" ${syncEnabled ? 'checked' : ''}><span class="track"></span></span>
      <span class="small bold">把启动器配置同步到本地文件夹（可放进 iCloud Drive）</span>
    </label>
    <div id="sync-panel" style="${syncEnabled ? '' : 'display:none'}">
      <div class="row wrap mt-2">
        <span class="small muted ellipsis" id="sync-folder" style="max-width:380px">${syncFolder ? escapeHtml(syncFolder) : '还没选择同步文件夹'}</span>
        <button class="btn sm" id="sync-pick">选择文件夹…</button>
      </div>
      <div class="row wrap mt-2">
        <button class="btn sm primary" id="sync-export">立即同步到文件夹</button>
        <button class="btn sm" id="sync-import">从文件夹恢复</button>
      </div>
      <div class="field-hint">同步内容：启动器设置、账户显示信息（不含密码与令牌）、实例配置索引、皮肤。存档与模组文件请用实例导出功能。删除方式：删除文件夹中的 blockbox-sync.json。</div>
    </div>

    <div class="section-title">数据管理</div>
    <div class="row wrap">
      <button class="btn" id="data-export">📤 导出配置</button>
      <button class="btn" id="data-import">📥 导入配置</button>
      <button class="btn" id="data-reset">↺ 重置启动器</button>
      <button class="btn" id="open-data-dir">📁 打开数据文件夹</button>
    </div>
    ${bootInfo && bootInfo.dataDir ? `<div class="small muted ellipsis mt-1" data-tip="${escapeHtml(bootInfo.dataDir)}" style="max-width:560px">数据文件夹：${escapeHtml(bootInfo.dataDir)}</div>` : ''}
    <div class="field-hint">导出的配置文件不含令牌与 API Key，可以放心分享或保存。</div>

    <div class="section-title">更新</div>
    <div class="row" style="align-items:center">
      <span class="small">当前版本：<span class="bold">${appVer ? 'v' + escapeHtml(appVer) : '未知'}</span></span>
      <button class="btn sm" id="update-check">检查更新</button>
    </div>
    <div id="update-result" class="mt-2"></div>
    <div class="field-hint">启动器不会自动安装更新，也不会强制更新；发现新版本后由你决定是否前往下载。</div>`;

  box.querySelector('#ms-client-id').onchange = (e) => queueSave({ msClientId: e.target.value.trim() }, '微软登录应用 ID 已保存');

  /* 离线模式 */
  box.querySelector('#offline-mode').onchange = (e) => {
    queueSave({ offlineMode: e.target.checked }, e.target.checked ? '已开启离线模式' : '已关闭离线模式');
    const detail = box.querySelector('#offline-detail');
    if (detail) detail.style.display = e.target.checked ? '' : 'none';
  };

  /* 代理设置 */
  const paintProxyUi = () => {
    box.querySelectorAll('#proxy-mode-row [data-pm]').forEach((b) => b.classList.toggle('primary', b.dataset.pm === proxyMode));
    const wrap = box.querySelector('#proxy-manual-wrap');
    if (wrap) wrap.style.display = proxyMode === 'manual' ? '' : 'none';
  };
  box.querySelectorAll('#proxy-mode-row [data-pm]').forEach((b) => {
    b.onclick = () => {
      if (b.dataset.pm === proxyMode) return;
      proxyMode = b.dataset.pm;
      queueSave({ proxy: { ...proxy, mode: proxyMode } }, '代理设置已保存');
      paintProxyUi();
    };
  });
  const saveProxyManual = () => {
    const host = (box.querySelector('#proxy-host')?.value || '').trim();
    const portRaw = (box.querySelector('#proxy-port')?.value || '').trim();
    const port = portRaw === '' ? '' : Math.max(1, Math.min(65535, Math.round(+portRaw || 0)));
    queueSave({ proxy: { ...proxy, mode: 'manual', host, port } }, '代理设置已保存');
  };
  const proxyHost = box.querySelector('#proxy-host');
  const proxyPort = box.querySelector('#proxy-port');
  if (proxyHost) proxyHost.onchange = saveProxyManual;
  if (proxyPort) proxyPort.onchange = saveProxyManual;
  box.querySelector('#proxy-test').onclick = async () => {
    const btn = box.querySelector('#proxy-test');
    const out = box.querySelector('#proxy-test-result');
    btn.disabled = true;
    out.textContent = '正在测试连接…';
    out.style.color = '';
    let r = null;
    try { r = await api.proxy.test(); } catch (e) { r = { ok: false, message: friendlyErr(e) }; }
    btn.disabled = false;
    const ok = !!(r && r.ok);
    out.textContent = (ok ? '✓ ' : '✕ ') + ((r && r.message) || (ok ? '连接成功' : '连接失败'));
    out.style.color = ok ? 'var(--ok)' : 'var(--err)';
    toast(ok ? '代理连接成功' : '代理连接失败：' + ((r && r.message) || '原因未知'), ok ? 'ok' : 'error', 4500);
  };

  /* AI 翻译 */
  box.querySelector('#tr-base').onchange = (e) => queueSave({ translate: { ...(S.translate || {}), apiBase: e.target.value.trim() } }, 'AI 翻译设置已保存');
  box.querySelector('#tr-model').onchange = (e) => queueSave({ translate: { ...(S.translate || {}), model: e.target.value.trim() } }, 'AI 翻译设置已保存');
  box.querySelector('#tr-key').onchange = (e) => {
    const v = e.target.value.trim();
    if (!v || v === KEY_MASK) {
      e.target.value = tr.apiKey || '';
      toast('未输入新的 Key，已保留原有设置', 'info', 2000);
      return;
    }
    queueSave({ translate: { ...(S.translate || {}), apiKey: v } }, 'API Key 已保存');
  };
  box.querySelector('#tr-key-test').onclick = async () => {
    const btn = box.querySelector('#tr-key-test');
    const out = box.querySelector('#tr-key-test-result');
    btn.disabled = true;
    out.textContent = '正在测试连接…';
    out.style.color = '';
    let r = null;
    try { r = await api.translate.testKey(); } catch (e) { r = { ok: false, kind: null, message: friendlyErr(e) }; }
    btn.disabled = false;
    const ok = !!(r && r.ok);
    const text = ok
      ? '连接成功' + (r.message ? '：' + r.message : '')
      : (KEY_TEST_KIND[r && r.kind] || '测试失败') + ((r && r.message) ? '：' + r.message : '');
    out.textContent = (ok ? '✓ ' : '✕ ') + text;
    out.style.color = ok ? 'var(--ok)' : 'var(--err)';
    toast(ok ? 'AI 翻译 API 连接成功' : text, ok ? 'ok' : 'error', 5000);
  };

  /* 性能页入口 */
  box.querySelector('#go-performance').onclick = () => { location.hash = '/performance'; };

  /* 开发者模式 */
  box.querySelector('#dev-mode').onchange = async (e) => {
    if (!e.target.checked) { queueSave({ devMode: false }, '已关闭开发者模式'); return; }
    const ok = await showDialog({
      title: '开启开发者模式',
      body: '<p style="margin-top:0">开发者模式会显示详细日志、允许手动改 Java 路径和 JVM 参数、查看实例完整文件列表。普通玩家不需要开启，日常功能完全不受影响。确定开启吗？</p>',
      actions: [{ label: '取消', value: false }, { label: '确定开启', value: true, primary: true }],
    });
    if (!ok) { e.target.checked = false; return; }
    queueSave({ devMode: true }, '已开启开发者模式');
  };

  /* 启动后动作 */
  const paintAfterLaunchHint = () => {
    const hint = box.querySelector('#after-launch-hint');
    if (!hint) return;
    const base = '游戏启动后启动器窗口的动作。选择「退出启动器」后游戏不受影响；崩溃分析会在下次打开启动器时自动进行。';
    hint.textContent = afterLaunch === 'minimize' ? `最小化暂未实现，等效于不动作。${base}` : base;
  };
  box.querySelectorAll('#after-launch-row [data-al]').forEach((b) => {
    b.onclick = () => {
      const v = b.dataset.al;
      if (v === afterLaunch) return;
      afterLaunch = v;
      box.querySelectorAll('#after-launch-row [data-al]').forEach((x) => x.classList.toggle('primary', x.dataset.al === v));
      paintAfterLaunchHint();
      queueSave({ afterLaunch: v }, '启动后动作已保存');
    };
  });
  paintAfterLaunchHint();

  /* 本地 API */
  const paintLocalApi = (running, port) => {
    const startBtn = box.querySelector('#local-api-start');
    const stopBtn = box.querySelector('#local-api-stop');
    const state = box.querySelector('#local-api-state');
    if (!startBtn || !stopBtn || !state) return;
    startBtn.style.display = running ? 'none' : '';
    stopBtn.style.display = running ? '' : 'none';
    const enabledNow = !!box.querySelector('#local-api-enabled')?.checked;
    state.textContent = running ? `本地 API 运行中，端口 ${port}` : (enabledNow ? '未启动' : '');
  };
  box.querySelector('#local-api-enabled').onchange = async (e) => {
    const on2 = e.target.checked;
    queueSave({ localApiEnabled: on2 }, on2 ? '已开启本地 API' : '已关闭本地 API');
    const panel = box.querySelector('#local-api-panel');
    if (panel) panel.style.display = on2 ? '' : 'none';
    if (!on2) {
      try { await api.localApi.stop(); } catch { /* 停止失败不影响设置保存 */ }
      const res = box.querySelector('#local-api-result');
      if (res) res.innerHTML = '';
      paintLocalApi(false);
    }
  };
  box.querySelector('#local-api-start').onclick = async () => {
    const btn = box.querySelector('#local-api-start');
    const portRaw = (box.querySelector('#local-api-port')?.value || '').trim();
    const port = portRaw ? Math.max(1, Math.min(65535, Math.round(+portRaw || 0))) : null;
    btn.disabled = true;
    await flushSave(); /* 后台校验设置里的开关状态，先把未落盘的改动写入 */
    if (!box.querySelector('#local-api-enabled')?.checked) {
      btn.disabled = false;
      toast('请先打开「本地 API」开关再启动。', 'warn', 3500);
      return;
    }
    let r = null;
    try { r = await api.localApi.start({ port }); } catch (e) {
      btn.disabled = false;
      toast('启动本地 API 失败：' + friendlyErr(e) + '。可以换个端口再试。', 'error', 6000);
      return;
    }
    btn.disabled = false;
    const apiPort = (r && r.port) || port;
    paintLocalApi(true, apiPort);
    let docs = r && isPlain(r.docs) ? r.docs : null;
    if (!docs) { try { docs = await api.localApi.docs(); } catch { /* 文档获取失败时只展示端口与令牌 */ } }
    const token = (r && r.token) || '';
    const res = box.querySelector('#local-api-result');
    if (!res) return;
    res.innerHTML = `
      <div class="card" style="max-width:720px">
        <div class="small">已在端口 <b>${escapeHtml(String(apiPort ?? ''))}</b> 启动本地 API，地址：<code>http://127.0.0.1:${escapeHtml(String(apiPort ?? ''))}</code></div>
        ${token ? `
        <div class="row wrap mt-2" style="align-items:center"><span class="small bold">访问令牌：</span><code id="local-api-token" style="word-break:break-all">${escapeHtml(token)}</code><button class="btn sm" id="local-api-copy-token">复制令牌</button></div>
        <div class="tiny" style="color:var(--warn)">令牌只在现在显示一次，请妥善保管。</div>`
        : '<div class="tiny muted mt-1">API 服务此前已在运行，令牌只在首次启动时显示；如需新令牌，请先停止再启动。</div>'}
        ${docs ? `
        <div class="section-title" style="margin-top:14px">接口文档</div>
        <div class="col" style="gap:8px">
          ${(Array.isArray(docs.endpoints) ? docs.endpoints : []).map((ep) => `
            <div class="card" style="padding:8px 12px">
              <div class="row wrap"><span class="badge accent">${escapeHtml(String(ep.method || 'GET'))}</span><code>${escapeHtml(String(ep.path || ''))}</code><span class="small muted">${escapeHtml(String(ep.desc || ''))}</span></div>
              ${ep.example ? `<pre class="tiny muted" style="white-space:pre-wrap;margin:6px 0 0;user-select:all">${escapeHtml(String(ep.example))}</pre>` : ''}
            </div>`).join('')}
        </div>
        ${docs.auth ? `<div class="field-hint mt-2">${escapeHtml(String(docs.auth))}</div>` : ''}
        ${docs.security ? `<div class="field-hint" style="color:var(--warn)">${escapeHtml(String(docs.security))}</div>` : ''}` : ''}
      </div>`;
    const copyBtn = res.querySelector('#local-api-copy-token');
    if (copyBtn) copyBtn.onclick = async () => {
      try { await api.clip.write(token); toast('令牌已复制到剪贴板', 'ok', 2000); }
      catch { toast('复制失败，请手动选中令牌复制。', 'warn'); }
    };
    toast('本地 API 已启动', 'ok', 2500);
  };
  box.querySelector('#local-api-stop').onclick = async () => {
    const btn = box.querySelector('#local-api-stop');
    btn.disabled = true;
    try { await api.localApi.stop(); } catch (e) { toast('停止失败：' + friendlyErr(e), 'error', 5000); btn.disabled = false; return; }
    btn.disabled = false;
    paintLocalApi(false);
    const res = box.querySelector('#local-api-result');
    if (res) res.innerHTML = '';
    toast('本地 API 已停止', 'info', 2500);
  };

  /* 界面语言 */
  box.querySelector('#ui-language').onchange = (e) => {
    queueSave({ language: e.target.value }, '界面语言已保存');
  };

  /* 云同步 */
  const syncState = () => (isPlain(S.sync) ? S.sync : {});
  box.querySelector('#sync-enabled').onchange = async (e) => {
    if (!e.target.checked) {
      queueSave({ sync: { ...syncState(), enabled: false } }, '已关闭云同步');
      const panel = box.querySelector('#sync-panel');
      if (panel) panel.style.display = 'none';
      return;
    }
    const ok = await showDialog({
      title: '开启云同步',
      body: `<p style="margin-top:0">云同步会把以下内容写入你选择的文件夹（可以是 iCloud Drive）：<b>启动器设置、账户显示信息（不含密码与令牌）、实例配置索引、皮肤</b>。</p>
        <p><b>不会同步：</b>存档与模组文件（请用实例导出功能）、账户令牌、API Key。</p>
        <p class="small muted">删除方式：删除文件夹中的 blockbox-sync.json。确定开启吗？</p>`,
      actions: [{ label: '取消', value: false }, { label: '确定开启', value: true, primary: true }],
    });
    if (!ok) { e.target.checked = false; return; }
    queueSave({ sync: { ...syncState(), enabled: true } }, '已开启云同步');
    const panel = box.querySelector('#sync-panel');
    if (panel) panel.style.display = '';
  };
  box.querySelector('#sync-pick').onclick = async () => {
    try {
      const dir = await api.pick.dir({ title: '选择同步文件夹（可放在 iCloud Drive 中）' });
      if (!dir) return;
      queueSave({ sync: { ...syncState(), folder: dir } }, '同步文件夹已保存');
      const el = box.querySelector('#sync-folder');
      if (el) el.textContent = dir;
    } catch (e) {
      toast('选择文件夹失败：' + friendlyErr(e), 'error', 5000);
    }
  };
  box.querySelector('#sync-export').onclick = async (e) => {
    const sync = syncState();
    if (!sync.folder) { toast('请先选择同步文件夹', 'warn'); return; }
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const r = await api.sync.export({ destDir: sync.folder });
      toast(String((r && (r.what || r.message)) || '已同步到所选文件夹'), 'ok', 9000);
    } catch (e2) {
      toast('同步失败：' + friendlyErr(e2) + '。请确认文件夹还存在且可写，然后重试。', 'error', 6000);
    }
    btn.disabled = false;
  };
  box.querySelector('#sync-import').onclick = async (e) => {
    const sync = syncState();
    if (!sync.folder) { toast('请先选择同步文件夹', 'warn'); return; }
    const btn = e.currentTarget;
    let picked = null;
    const conflict = await showDialog({
      title: '从文件夹恢复',
      body: `<p class="small" style="margin-top:0">如果本机与云端内容有冲突，按哪种方式处理？</p>
        <div class="col" style="gap:8px">
          <div class="card hoverable" data-conflict="local"><div class="bold small">保留本机</div><div class="tiny muted">忽略云端带来的设置与皮肤改动，只合并新增的账户信息。</div></div>
          <div class="card hoverable" data-conflict="cloud"><div class="bold small">使用云端</div><div class="tiny muted">用同步文件夹里的设置覆盖本机设置。</div></div>
          <div class="card hoverable" data-conflict="keep-both"><div class="bold small">两者都保留</div><div class="tiny muted">应用云端设置，同名皮肤两份都保留。</div></div>
        </div>`,
      actions: [{ label: '取消', value: null }, { label: '恢复', value: true, primary: true }],
      onMount(mask, close) {
        const okBtn = [...mask.querySelectorAll('.dialog-actions .btn')].pop();
        okBtn.disabled = true;
        mask.querySelectorAll('[data-conflict]').forEach((c) => {
          c.onclick = () => {
            picked = c.dataset.conflict;
            mask.querySelectorAll('[data-conflict]').forEach((x) => { x.style.borderColor = ''; x.style.boxShadow = ''; });
            c.style.borderColor = 'var(--accent)';
            c.style.boxShadow = '0 0 0 1px var(--accent)';
            okBtn.disabled = false;
          };
        });
        okBtn.onclick = () => { if (picked) close(picked); };
      },
    });
    if (!conflict) return;
    btn.disabled = true;
    try {
      const r = await api.sync.import({ srcDir: sync.folder, conflict });
      toast((r && r.message) || '已从文件夹恢复', 'ok', 8000);
      try {
        const fresh = await api.settings.get();
        if (isPlain(fresh)) { S = fresh; applyTheme(S); }
      } catch { /* 重新读取设置失败不影响恢复结果 */ }
    } catch (e2) {
      toast('恢复失败：' + friendlyErr(e2) + '。请确认所选文件夹中有 blockbox-sync.json。', 'error', 6000);
    }
    btn.disabled = false;
  };

  /* 数据管理 */
  box.querySelector('#open-data-dir').onclick = async () => {
    if (!bootInfo || !bootInfo.dataDir) { toast('暂时无法获取数据文件夹位置，请稍后再试。', 'warn'); return; }
    try { await api.shell.openPath(bootInfo.dataDir); } catch (e) { toast('打开数据文件夹失败：' + (e.message || e), 'error', 5000); }
  };
  box.querySelector('#data-export').onclick = () => dataExportFlow(box.querySelector('#data-export'));
  box.querySelector('#data-import').onclick = () => dataImportFlow();
  box.querySelector('#data-reset').onclick = async () => {
    let picked = null;
    const r = await showDialog({
      title: '重置启动器',
      wide: true,
      body: `<p class="small muted" style="margin-top:0">请选择要重置的范围，选定后还会再次确认。</p>
        <div class="col" style="gap:8px">
          ${RESET_LEVELS.map((l) => `
            <div class="card hoverable" data-level="${l.id}">
              <div class="row">
                <div class="col" style="gap:2px;flex:1;min-width:0">
                  <div class="bold small">${l.name}</div>
                  <div class="tiny muted">${l.desc}</div>
                </div>
                <span class="badge accent" data-sel style="display:none">已选择</span>
              </div>
            </div>`).join('')}
        </div>`,
      actions: [{ label: '取消', value: null }, { label: '下一步', value: true, primary: true }],
      onMount(mask, close) {
        const okBtn = [...mask.querySelectorAll('.dialog-actions .btn')].pop();
        okBtn.disabled = true;
        mask.querySelectorAll('[data-level]').forEach((c) => {
          c.onclick = () => {
            picked = RESET_LEVELS.find((l) => l.id === c.dataset.level) || null;
            mask.querySelectorAll('[data-level]').forEach((x) => {
              x.style.borderColor = '';
              x.style.boxShadow = '';
              const sel = x.querySelector('[data-sel]');
              if (sel) sel.style.display = 'none';
            });
            if (picked) {
              c.style.borderColor = 'var(--accent)';
              c.style.boxShadow = '0 0 0 1px var(--accent)';
              const sel = c.querySelector('[data-sel]');
              if (sel) sel.style.display = '';
            }
            okBtn.disabled = !picked;
          };
        });
      },
    });
    if (!r || !picked) return;
    const ok = await confirmDialog('确认' + picked.name, picked.desc + ' 确定要继续吗？', { danger: true, okLabel: '确认重置' });
    if (!ok) return;
    try {
      const res = await api.data.reset({ level: picked.id });
      toast((res && res.message) || '重置完成', 'ok', 5000);
    } catch (e) {
      toast('重置失败：' + friendlyErr(e), 'error', 5000);
    }
  };

  /* 更新 */
  box.querySelector('#update-check').onclick = async () => {
    const btn = box.querySelector('#update-check');
    const out = box.querySelector('#update-result');
    btn.disabled = true;
    out.innerHTML = '<div class="row small muted"><div class="spinner sm"></div>正在检查更新…</div>';
    let r = null;
    try { r = await api.update.check(); } catch (e) {
      out.innerHTML = `<div class="small" style="color:var(--err)">✕ ${escapeHtml(friendlyErr(e))}</div>`;
      btn.disabled = false;
      return;
    }
    btn.disabled = false;
    if (r && (r.unconfigured || r.error)) {
      out.innerHTML = `<div class="small" style="color:var(--warn)">ℹ️ ${escapeHtml(r.message || '暂时无法检查更新，请稍后再试。')}</div>`;
      return;
    }
    if (r && r.available) {
      const ver = String(r.latestVersion || '');
      const url = r.downloadUrl || r.url || null;
      out.innerHTML = `
        <div class="card" style="max-width:640px;border-color:var(--accent)">
          <div class="row">
            <div class="bold">发现新版本 v${escapeHtml(ver)}</div>
            <span class="spacer"></span>
            <span class="tiny muted">当前 v${escapeHtml(String(r.currentVersion || appVer || ''))}</span>
          </div>
          ${r.notes ? `<div class="small muted mt-2" style="white-space:pre-wrap;max-height:200px;overflow:auto">${escapeHtml(r.notes)}</div>` : ''}
          <div class="row mt-2">
            ${url ? '<button class="btn sm primary" id="update-open">打开下载页</button>' : ''}
            <button class="btn sm" id="update-skip">跳过此版本</button>
          </div>
        </div>`;
      const openBtn = out.querySelector('#update-open');
      if (openBtn) openBtn.onclick = async () => {
        try { await api.update.openPage({ url }); } catch (e) { toast('打开下载页失败：' + friendlyErr(e), 'error', 5000); }
      };
      out.querySelector('#update-skip').onclick = async () => {
        try {
          await api.update.skip({ version: ver });
          toast('已跳过 v' + ver + '，这个版本不会再提醒', 'ok');
          out.innerHTML = `<div class="small muted">已跳过版本 v${escapeHtml(ver)}，下次有更新时再提醒你。</div>`;
        } catch (e) {
          toast('操作失败：' + friendlyErr(e), 'error', 5000);
        }
      };
      return;
    }
    if (r && r.skipped) {
      out.innerHTML = `<div class="small muted">已跳过版本 ${escapeHtml(String(r.latestVersion || ''))}，启动器不会再提醒这个版本。</div>`;
      return;
    }
    out.innerHTML = `<div class="small muted">✓ ${escapeHtml((r && r.message) || '当前已是最新版本。')}</div>`;
  };
}

export default {
  id: 'settings',
  title: '设置',
  icon: '⚙️',
  routes: ['/settings'],
  order: 9,
  render: (el) => renderPage(el),
};
