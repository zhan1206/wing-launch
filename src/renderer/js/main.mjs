// Wing Launch 渲染层入口：路由 + 布局 + 主题应用
import { api, on, bare } from './api.js';
import { toast, listenMainToasts, setDropText, showDialog } from './ui.js';
import { applyTheme } from './theme.js';
import { translate, LOCALES } from './i18n.mjs';

const $ = (s, el = document) => el.querySelector(s);
export { applyTheme, setDropText };

function applyA11y(s) {
  const zoom = { sm: 0.9, md: 1, lg: 1.15, xl: 1.3 }[s.fontSize || 'md'] || 1;
  document.documentElement.style.zoom = zoom;
  document.body.dataset.contrast = s.contrast === 'high' ? 'high' : 'normal';
  document.body.dataset.motion = s.motion === 'reduced' ? 'reduced' : 'normal';
  document.body.dataset.colorblind = s.colorblindMode ? '1' : '0';
}

/* ---------- 通知中心 ---------- */
const NOTIFY_KEY = 'bb-notifications';
export function pushNotification(n) {
  try {
    const list = JSON.parse(localStorage.getItem(NOTIFY_KEY) || '[]');
    list.unshift({ ...n, time: Date.now() });
    localStorage.setItem(NOTIFY_KEY, JSON.stringify(list.slice(0, 50)));
    renderBell();
  injectCloseGameFab();
  } catch { /* */ }
}
function renderBell() {
  const holder = document.getElementById('topbar-actions');
  if (!holder || document.getElementById('bb-bell')) return;
  const bell = document.createElement('button');
  bell.id = 'bb-bell'; bell.className = 'btn ghost sm'; bell.dataset.tip = '通知中心'; bell.setAttribute('aria-label', '通知中心');
  bell.textContent = '🔔';
  bell.onclick = () => showNotifications();
  holder.prepend(bell);
}
function showNotifications() {
  let list = [];
  try { list = JSON.parse(localStorage.getItem(NOTIFY_KEY) || '[]'); } catch { /* */ }
  showDialog({ title: '通知中心', wide: true, body: list.length
    ? '<div class="col">' + list.map((n) => '<div class="card" style="padding:10px 14px"><div class="row"><span>' + escapeHtmlN(n.text || '') + '</span><span class="spacer"></span><span class="tiny muted">' + new Date(n.time).toLocaleString('zh-CN') + '</span></div></div>').join('') + '</div>'
    : '<div class="empty-state"><div class="big">📭</div><div class="title">还没有通知</div><div class="small">下载完成、备份完成、崩溃分析完成时，会在这里提醒你。</div></div>',
    actions: [{ label: '清空通知', value: 'clear', danger: true }, { label: '关闭', value: true, primary: true }] }).then((v) => {
    if (v === 'clear') { localStorage.setItem(NOTIFY_KEY, '[]'); }
  });
}
function escapeHtmlN(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/* ---------- 全局快捷键 ---------- */
function bindShortcuts() {
  window.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === ',') { e.preventDefault(); location.hash = '#/settings'; }
    else if (k === '/') { e.preventDefault(); location.hash = '#/help'; }
    else if (k === 'k') { e.preventDefault(); location.hash = '#/instances'; setTimeout(() => document.querySelector('input[type="search"], input.input')?.focus?.(), 400); }
    else if (k === 'l') { e.preventDefault(); document.getElementById('page')?.querySelector('.btn.primary')?.click?.(); }
    else if (e.shiftKey && k === 'd') { e.preventDefault(); location.hash = '#/downloads'; }
  });
}
/* ---------- 启动失败/警告弹窗 ---------- */
function bindLaunchEvents() {
  on('bb:launch-failed', ({ category, message, fixes }) => {
    pushNotification({ text: '启动失败：' + message });
    showDialog({
      title: '游戏没能启动',
      body: '<p style="color:var(--err);font-weight:600;margin-bottom:6px">' + escapeHtmlN(category || '未知') + '问题</p><p>' + escapeHtmlN(message || '') + '</p>',
      actions: [
        ...(fixes || []).map((f) => ({ label: f.text, value: f.action, primary: true })),
        { label: '关闭', value: null },
      ],
    }).then(async (action) => {
      if (!action) return;
      try { const r = await api.fixes.apply({ fix: action }); toast(r?.message || '已执行', 'ok'); } catch (e) { toast(e.message, 'error'); }
    });
  });
  on('bb:launch-warning', ({ text }) => { pushNotification({ text }); }); // 页面内已 toast，这里只入通知中心
}
/* ---------- 页面气泡引导（可关闭，只显示一次） ---------- */
const BUBBLES = {
  '/instances': '把整合包或模组直接拖进窗口就能安装；也可以点右上角“新建实例”。',
  '/downloads': '所有下载任务都会出现在这里，可以暂停、继续、重试。',
  '/multiplayer': '同一 WiFi 用“局域网直连”；不在同一网络用“联机房间”。',
  '/tools': '这里都是实用小工具：渐变文字、种子地图、投影查看、模组翻译、配方生成。',
};
function maybeBubble(path) {
  const bubble = BUBBLES[path];
  if (!bubble) return;
  import('./api.js').then(({ api }) => api.settings.get()).then((s) => {
    const seen = s.seenBubbles || {};
    if (seen[path]) return;
    const el = document.getElementById('page');
    if (!el) return;
    const tip = document.createElement('div');
    tip.className = 'card'; tip.style.cssText = 'margin-bottom:14px;border-left:4px solid var(--accent)';
    tip.innerHTML = '<div class="row">💡 <span>' + escapeHtmlN(bubble) + '</span><span class="spacer"></span><button class="btn sm ghost">知道了</button></div>';
    tip.querySelector('button').onclick = async () => { tip.remove(); const cur = await import('./api.js').then(({ api }) => api.settings.get()); import('../js/api.js'); window.bb.raw.invoke('bb:invoke', { ch: 'settings.set', payload: { seenBubbles: { ...cur.seenBubbles, [path]: true } } }); };
    el.prepend(tip);
  }).catch(() => {});
}

/* ---------- 页面注册 ---------- */
const PAGES = [];
const PAGE_MODULES = [
  'home', 'instances', 'downloads', 'accounts', 'skins', 'multiplayer',
  'resources', 'tools', 'settings', 'server', 'onboarding', 'help', 'performance', 'gametools',
];
function loadPages() {
  return Promise.all(PAGE_MODULES.map((name) =>
    import(`./pages/${name}.mjs`)
      .then((mod) => {
        const page = mod.default;
        if (!page) return;
        if (Array.isArray(page)) PAGES.push(...page);
        else PAGES.push(page);
      })
      .catch((e) => { if (!/Cannot find module|Failed to load|ERR_MODULE_NOT_FOUND/.test(String(e))) console.warn(`页面 ${name} 加载失败`, e); })
  ));
}

const NAV_ORDER = ['home', 'performance', 'instances', 'downloads', 'accounts', 'skins', 'multiplayer', 'gametools', 'resources', 'tools', 'settings', 'help'];
const ICONS = { home: '🏠', performance: '⚡', instances: '🗂️', downloads: '⬇️', accounts: '👤', skins: '🧑‍🎤', multiplayer: '🌐', resources: '🗃️', tools: '🧰', settings: '⚙️', server: '🖥️', gametools: '📸', help: '❓' };

function navPages(layout) {
  return NAV_ORDER
    .map((id) => PAGES.filter((p) => p.id === id && p.routes?.length && (!p.home || p.home === 'both' || p.home === layout)))
    .map((arr) => arr[0])
    .filter(Boolean);
}

function renderSidebar(currentPath, settings) {
  const layout = settings?.homepage === 'immersive' ? 'immersive' : 'classic';
  const sb = $('#sidebar');
  sb.innerHTML = `<div class="nav-brand"><span class="logo">方</span><span class="brand-text">Wing Launch</span></div>`;
  for (const p of navPages(layout)) {
    if (p.hiddenNav) continue;
    const btn = document.createElement('button');
    const t = translate(p.title, SETTINGS?.language || 'zh-CN');
    btn.className = 'nav-item' + (currentPath.startsWith(p.routes[0]) ? ' active' : '');
    btn.dataset.tip = t.text;
    btn.setAttribute('aria-label', t.text);
    btn.innerHTML = `<span class="nav-icon" aria-hidden="true">${p.icon || ICONS[p.id] || '📄'}</span><span class="nav-label">${t.text}</span>`;
    btn.onclick = () => { location.hash = p.routes[0] === '/home' ? '#/' : p.routes[0]; };
    sb.appendChild(btn);
  }
  const spacer = document.createElement('div'); spacer.className = 'nav-spacer'; sb.appendChild(spacer);
  const foot = document.createElement('div');
  foot.className = 'nav-foot';
  foot.textContent = 'Wing Launch v' + (window.__APP_VERSION__ || '1.0.0');
  sb.appendChild(foot);
}

/* ---------- 路由 ---------- */
let SETTINGS = null;
export const getSettings = () => SETTINGS;
export const refreshSettings = async () => { SETTINGS = await api.settings.get(); applyTheme(SETTINGS); return SETTINGS; };

function matchPage(path) {
  const layout = SETTINGS?.homepage === 'immersive' ? 'immersive' : 'classic';
  let best = null, bestLen = -1;
  for (const p of PAGES) {
    for (const r of p.routes || []) {
      const hit = r.endsWith('/') ? path.startsWith(r) : (path === r || path.startsWith(r + '/'));
      if (hit) {
        if (r.length > bestLen) { best = p; bestLen = r.length; }
        else if (r.length === bestLen && best?.id === 'home' && p.id === 'home' && p.home === layout) best = p;
      }
    }
  }
  return best;
}

async function route() {
  const path = location.hash.replace(/^#/, '') || '/';
  const page = matchPage(path);
  const el = $('#page');
  renderSidebar(path, SETTINGS);
  if (!page) {
    el.innerHTML = `<div class="empty-state"><div class="big">🚧</div><div class="title">页面走丢了</div><div class="small">这个地址没有对应的页面。</div></div>`;
    return;
  }
  el.innerHTML = `<div class="page-loading"><div class="spinner"></div><div>正在加载…</div></div>`;
  el.classList.toggle('no-pad', !!page.noPad);
  $('#topbar-actions').innerHTML = '';
  try {
    await page.render(el, { path, settings: SETTINGS, params: parseParams(path, page.routes) });
    maybeBubble(path);
  } catch (e) {
    console.error('页面渲染失败', e);
    el.innerHTML = `<div class="empty-state"><div class="big">😵</div><div class="title">页面没能正常打开</div>
      <div class="small">错误信息：${String(e.message || e)}</div>
      <div class="mt-3"><button class="btn" onclick="location.reload()">刷新重试</button></div></div>`;
  }
}

function parseParams(path, routes) {
  const base = (routes || []).reduce((a, b) => (b.length > a.length ? b : a), '');
  const rest = path.slice(base.length).replace(/^\//, '');
  return rest ? rest.split('/') : [];
}

window.addEventListener('hashchange', route);

/* ---------- 全局拖拽 ---------- */
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { e.preventDefault(); if ([...(e.dataTransfer?.types || [])].includes('Files')) { dragDepth++; $('#drop-overlay').classList.add('active'); } });
window.addEventListener('dragleave', (e) => { e.preventDefault(); dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#drop-overlay').classList.remove('active'); });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault(); dragDepth = 0; $('#drop-overlay').classList.remove('active');
  const paths = [];
  for (const f of e.dataTransfer.files) { try { paths.push(window.bb.raw.pathForFile(f)); } catch { /* */ } }
  if (!paths.length) return;
  try {
    const r = await api.drop.install({ paths });
    if (r?.message) toast(r.message, r.type || 'info', 5000);
  } catch (err) { toast(String(err.message || err), 'error'); }
});

/* ---------- 启动 ---------- */
async function boot() {
  listenMainToasts();
  bindShortcuts();
  bindLaunchEvents();
  renderBell();
  on('bb:download-progress', (d) => { if (d.state === 'done') pushNotification({ text: '下载完成：' + (d.name || '') }); });
  on('bb:server-status', (s2) => { if (s2.status === 'running') pushNotification({ text: '服务器已启动，端口 ' + (s2.port || '') }); });
  const bootInfo = await bare('bootstrap')();
  window.__APP_VERSION__ = bootInfo.appVersion;
  SETTINGS = await api.settings.get();
  document.body.dataset.design = 'pinguo';
  applyTheme(SETTINGS);
  applyA11y(SETTINGS);
  on('bb:settings-changed', (s) => { SETTINGS = s; applyTheme(s); applyA11y(s); renderSidebar(location.hash.replace(/^#/, '') || '/', s); });
  on('bb:goto', (p) => { location.hash = p; });
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', async () => {
    if (SETTINGS.theme?.mode === 'system') applyTheme(SETTINGS);
  });
  if (SETTINGS.language && SETTINGS.language !== 'zh-CN' && !LOCALES[SETTINGS.language]?.complete) console.info('部分内容尚未翻译为' + (LOCALES[SETTINGS.language]?.name || '') + '，已自动回退中文。');
  injectCloseGameFab();
  if (bootInfo.isFirstRun) location.hash = '/onboarding';
  route();
}
// AK.6 关闭游戏进程按钮：游戏运行时全局常驻，二次确认+关闭后引导
function injectCloseGameFab() {
  const fab = document.createElement('button');
  fab.id = 'close-game-fab';
  fab.setAttribute('aria-label', '关闭游戏进程');
  fab.dataset.tip = '安全关闭正在运行的游戏进程';
  fab.innerHTML = '⛔ 关闭游戏进程';
  fab.onclick = async () => {
    const { confirmDialog } = await import('./ui.js');
    const ok = await confirmDialog('关闭游戏进程', '游戏可能未保存，确定要关闭吗？', { danger: true, okLabel: '确定关闭' });
    if (!ok) return;
    const { api } = await import('./api.js');
    try {
      const r = await api.game.close({ reason: '用户通过按钮关闭' });
      toast(r.message, r.ok ? 'ok' : 'warn', 6000);
      if (r.ok) {
        setTimeout(async () => {
          const { showDialog } = await import('./ui.js');
          await showDialog({ title: '游戏已关闭', body: '<p>已自动创建存档快照。</p>', actions: [{ label: '进行崩溃分析', value: 'crash', primary: true }, { label: '查看存档快照', value: 'snap' }, { label: '关闭', value: null }] }).then(async (v) => {
            if (v === 'crash') location.hash = '#/instances';
            if (v === 'snap') location.hash = '#/instances';
          });
        }, 5500);
      }
    } catch (e) { toast(e.message, 'error'); }
  };
  document.body.appendChild(fab);
  const poll = setInterval(async () => {
    try {
      const st = await api.game.status();
      fab.classList.toggle('show', !!st.running);
    } catch { /* */ }
  }, 8000);
}
loadPages().then(() => boot());
