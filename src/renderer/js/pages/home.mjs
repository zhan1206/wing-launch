// 主页：经典 / 沉浸 双布局（导出数组，两个页面对象 id 均为 home）
import { api, on } from '../api.js';
import { toast, emptyState, skeletonRows, progressBar, setBreadcrumb, escapeHtml } from '../ui.js';

let offs = [];
function reg(fn) { if (typeof fn === 'function') offs.push(fn); }
function cleanup() { offs.splice(0).forEach((f) => { try { f(); } catch { /* 忽略 */ } }); }

function bbimg(p) {
  const s = String(p || '');
  if (!s) return '';
  if (/^(bbimg:|data:|https?:)/.test(s)) return s;
  return 'bbimg://' + encodeURIComponent(s);
}
function timeVal(t) {
  if (t == null) return 0;
  if (typeof t === 'number') return t;
  const n = Date.parse(t);
  return Number.isNaN(n) ? 0 : n;
}
function fmtLast(t) {
  const v = timeVal(t);
  if (!v) return '从未游玩';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '从未游玩';
  return '上次游玩 ' + d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function greeting() {
  const h = new Date().getHours();
  if (h < 5) return '夜深了';
  if (h < 11) return '早上好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
}
const LOADER_NAMES = { vanilla: '原版', forge: 'Forge', fabric: 'Fabric', quilt: 'Quilt', neoforge: 'NeoForge' };
function loaderName(l) { return LOADER_NAMES[l] || l || ''; }
function coverNode(inst, w, h, radius) {
  const url = bbimg(inst && inst.cover);
  if (url) return `<img src="${escapeHtml(url)}" alt="" style="width:${w}px;height:${h}px;object-fit:cover;border-radius:${radius}px">`;
  return `<div style="width:${w}px;height:${h}px;border-radius:${radius}px;background:linear-gradient(135deg,var(--accent),#9d5cff);display:grid;place-items:center;font-size:28px">🧱</div>`;
}

async function loadData() {
  const d = { settings: null, insts: null, instErr: '', accs: [], dls: [], lans: [] };
  try { d.settings = await api.settings.get(); } catch { d.settings = null; }
  try { d.insts = (await api.instances.list()) || []; }
  catch (e) { d.instErr = e.message || String(e); }
  try { d.accs = (await api.accounts.list()) || []; } catch { d.accs = []; }
  try { d.dls = (await api.downloads.list()) || []; } catch { d.dls = []; }
  try { d.lans = (await api.net.lanWorlds()) || []; } catch { d.lans = []; }
  return d;
}

function bindLaunch(btn, inst, acc) {
  btn.onclick = () => {
    const p = api.instances.launch({ id: inst.id, accountId: acc ? acc.id : undefined });
    p.catch((e) => toast('启动失败：' + (e.message || e) + '。请检查实例文件是否完整，可到实例详情页查看更多信息。', 'error', 6000));
    location.hash = '/instances/' + inst.id;
  };
}

function updateDlBar(d) {
  const holder = document.getElementById('home-dl');
  if (!holder) return;
  const act = (d.dls || []).filter((x) => x.state === 'pending' || x.state === 'downloading' || x.state === 'paused');
  if (!act.length) { holder.remove(); return; }
  let rec = 0, tot = 0;
  for (const a of act) { rec += a.received || 0; tot += a.total || 0; }
  const pct = tot ? Math.round((rec / tot) * 100) : null;
  holder.innerHTML = `
    <div class="row" style="gap:10px">
      <span>⬇️</span>
      <div style="flex:1;min-width:0">
        <div class="row small" style="justify-content:space-between">
          <span class="ellipsis">下载中心：${act.length} 个任务进行中 · ${escapeHtml(act[0].name || '')}</span>
          <span class="tiny muted">${pct != null ? pct + '%' : ''}${act[0].etaText ? ' · 剩余 ' + escapeHtml(act[0].etaText) : ''}</span>
        </div>
        ${progressBar(pct, { thin: true })}
      </div>
    </div>`;
}

async function renderHome(el, ctx, layout) {
  cleanup();
  setBreadcrumb([{ label: '主页' }]);
  el.classList.toggle('no-pad', layout === 'immersive');
  el.innerHTML = `<div class="col">${skeletonRows(4)}</div>`;
  const d = await loadData();

  // 实时刷新（页面仍在主页时才生效）
  const atHome = () => ((location.hash.replace(/^#/, '')) || '/') === '/';
  let rerenderTimer = null;
  const schedule = () => {
    if (!atHome()) return;
    clearTimeout(rerenderTimer);
    rerenderTimer = setTimeout(() => { if (atHome()) renderHome(el, ctx, layout); }, 500);
  };
  reg(on('bb:instances-changed', schedule));
  reg(on('bb:accounts-changed', schedule));
  reg(on('bb:downloads-changed', schedule));
  reg(on('bb:download-progress', (p) => {
    const it = (d.dls || []).find((x) => x.id === p.id);
    if (it) {
      it.received = p.received; it.total = p.total; it.state = p.state || it.state;
      it.speed = p.speed; it.etaText = p.etaText;
    }
    if (!atHome()) return;
    if (document.getElementById('home-dl')) updateDlBar(d);
    else schedule();
  }));

  const other = layout === 'classic' ? 'immersive' : 'classic';
  const switchLabel = layout === 'classic' ? '🌌 切换到沉浸主页' : '🧱 切换到经典主页';
  const bindSwitch = () => {
    const sw = el.querySelector('#home-switch-layout');
    if (sw) sw.onclick = async () => {
      try { await api.settings.set({ homepage: other }); }
      catch (e) { toast('切换主页布局失败：' + (e.message || e), 'error'); return; }
      toast(`已切换到${other === 'immersive' ? '沉浸' : '经典'}主页`, 'ok', 1500);
      renderHome(el, ctx, other);
    };
  };

  // 加载失败
  if (d.insts === null) {
    const errHtml = emptyState({
      icon: '😵', title: '主页数据加载失败',
      text: '读取实例列表时出现问题：' + d.instErr + '。可能是后台服务暂时不可用，请重试。',
      actionsHtml: '<button class="btn primary" id="home-retry">重试</button>',
    });
    el.innerHTML = layout === 'immersive'
      ? `<div style="padding:60px 24px"><div class="row" style="justify-content:flex-end"><button class="btn ghost sm" id="home-switch-layout">${switchLabel}</button></div>${errHtml}</div>`
      : `<div class="row" style="justify-content:flex-end"><button class="btn ghost sm" id="home-switch-layout">${switchLabel}</button></div>${errHtml}`;
    bindSwitch();
    el.querySelector('#home-retry').onclick = () => renderHome(el, ctx, layout);
    return;
  }

  const insts = d.insts;
  const cur = insts.find((i) => i.id === ((d.settings || ctx.settings || {}) || {}).currentInstanceId) || insts[0] || null;

  // 没有实例：空状态引导
  if (!cur) {
    const inner = emptyState({
      icon: '📦', title: '还没有游戏实例',
      text: '创建一个实例并下载好游戏文件后，就可以在这里一键启动。',
      actionsHtml: '<button class="btn primary lg" id="home-create">创建第一个实例</button>',
    });
    el.innerHTML = layout === 'immersive'
      ? `<div style="padding:60px 24px"><div class="row" style="justify-content:flex-end"><button class="btn ghost sm" id="home-switch-layout">${switchLabel}</button></div>${inner}</div>`
      : `<div class="row" style="justify-content:flex-end"><button class="btn ghost sm" id="home-switch-layout">${switchLabel}</button></div>${inner}`;
    bindSwitch();
    el.querySelector('#home-create').onclick = () => { location.hash = '/instances'; };
    return;
  }

  const acc = d.accs.find((a) => a.id === cur.boundAccountId) || d.accs[0] || null;
  const act = d.dls.filter((x) => x.state === 'pending' || x.state === 'downloading' || x.state === 'paused');
  const instSelect = `
    <select class="input sm" id="home-switch-inst" style="width:auto;max-width:220px" data-tip="切换实例">
      ${insts.map((i) => `<option value="${escapeHtml(i.id)}" ${i.id === cur.id ? 'selected' : ''}>${escapeHtml(i.name)}</option>`).join('')}
    </select>`;

  if (layout === 'immersive') {
    const url = bbimg(cur.cover);
    el.innerHTML = `
      <div style="position:relative;min-height:46vh;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#0e1014">
        ${url
          ? `<img src="${escapeHtml(url)}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">`
          : '<div style="position:absolute;inset:0;background:linear-gradient(135deg,var(--accent),#9d5cff)"></div>'}
        <div style="position:absolute;inset:0;background:linear-gradient(180deg, rgba(8,10,14,.35), rgba(8,10,14,.78))"></div>
        <div style="position:relative;text-align:center;color:#fff;padding:34px 20px;max-width:660px">
          <div class="small" style="opacity:.85">${greeting()}，${escapeHtml(acc ? (acc.displayName || acc.name) : '玩家')}</div>
          <div class="ellipsis" style="font-size:30px;font-weight:800;margin-top:4px;text-shadow:0 2px 12px rgba(0,0,0,.45)">${escapeHtml(cur.name)}</div>
          <div class="row mt-2" style="justify-content:center;gap:8px;flex-wrap:wrap">
            <span class="badge" style="background:rgba(255,255,255,.16);color:#fff;border-color:transparent">${escapeHtml(cur.versionId || '')}</span>
            ${cur.loader ? `<span class="badge" style="background:rgba(255,255,255,.16);color:#fff;border-color:transparent">${escapeHtml(loaderName(cur.loader))}${cur.loaderVersion ? ' ' + escapeHtml(cur.loaderVersion) : ''}</span>` : ''}
          </div>
          <button class="btn primary lg mt-3" id="home-launch" style="font-size:17px;padding:14px 52px">▶ 启动游戏</button>
          <div class="row mt-2" style="justify-content:center">
            ${instSelect}
            <button class="btn ghost sm" id="home-switch-layout" style="color:rgba(255,255,255,.8)">${switchLabel}</button>
          </div>
        </div>
      </div>
      <div style="padding:16px 20px 40px">
        <div class="row" style="justify-content:space-between">
          <div class="section-title" style="margin:0">全部实例</div>
          <span class="tiny muted">横向滑动查看更多</span>
        </div>
        <div style="display:flex;gap:12px;overflow-x:auto;padding:12px 2px 8px">
          ${insts.map((i) => `
            <div class="card hoverable" data-open="${escapeHtml(i.id)}" style="flex:0 0 auto;width:200px;padding:10px;${i.id === cur.id ? 'border-color:var(--accent)' : ''}">
              ${coverNode(i, 180, 100, 7)}
              <div class="bold ellipsis mt-1" style="font-size:13.5px">${escapeHtml(i.name)}</div>
              <div class="tiny muted ellipsis">${escapeHtml(i.versionId || '')}${i.loader && i.loader !== 'vanilla' ? ' · ' + escapeHtml(loaderName(i.loader)) : ''}</div>
            </div>`).join('')}
        </div>
        ${d.lans.length ? `<div class="small muted mt-2">🌐 检测到 ${d.lans.length} 个局域网世界，去「联机」页查看。</div>` : ''}
        ${act.length ? '<div class="card" id="home-dl" style="margin-top:10px;padding:12px 16px;cursor:pointer"></div>' : ''}
      </div>`;
  } else {
    const instsSorted = insts.slice().sort((a, b) => timeVal(b.lastPlayed) - timeVal(a.lastPlayed));
    const recent = instsSorted.slice(0, 6);
    const quick = [
      { icon: '🗂️', label: '实例', path: '/instances', badge: 0 },
      { icon: '⬇️', label: '下载中心', path: '/downloads', badge: 0 },
      { icon: '🧑‍🎤', label: '皮肤库', path: '/skins', badge: 0 },
      { icon: '🧰', label: '工具集', path: '/tools', badge: 0 },
      { icon: '🌐', label: '联机', path: '/multiplayer', badge: d.lans.length },
      { icon: '🗃️', label: '资源管理器', path: '/resources', badge: 0 },
    ];
    el.innerHTML = `
      <div class="row" style="margin-bottom:14px">
        <div style="min-width:0">
          <div style="font-size:20px;font-weight:700">${greeting()}，${escapeHtml(acc ? (acc.displayName || acc.name) : '玩家')}</div>
          <div class="small muted row" style="gap:8px">
            ${acc ? '<span>选好实例，随时开玩。</span>' : '<span>尚未添加账户，部分功能需要账户才能使用。</span><button class="btn sm ghost" id="home-add-acc">去添加</button>'}
          </div>
        </div>
        <div class="spacer"></div>
        <button class="btn ghost sm" id="home-switch-layout">${switchLabel}</button>
      </div>
      <div class="card" style="display:flex;gap:18px;align-items:stretch">
        <div style="flex:0 0 auto">${coverNode(cur, 220, 124, 10)}</div>
        <div class="col" style="flex:1;min-width:0">
          <div class="row" style="gap:8px">
            <div class="bold ellipsis" style="font-size:17px">${escapeHtml(cur.name)}</div>
            <span class="badge">${escapeHtml(cur.versionId || '')}</span>
            ${cur.loader ? `<span class="badge accent">${escapeHtml(loaderName(cur.loader))}${cur.loaderVersion ? ' ' + escapeHtml(cur.loaderVersion) : ''}</span>` : ''}
          </div>
          <div class="small muted mt-1">${fmtLast(cur.lastPlayed)}${cur.modsCount != null ? ' · ' + cur.modsCount + ' 个模组' : ''}</div>
          <div class="spacer"></div>
          <div class="row mt-2">
            <button class="btn primary lg" id="home-launch">▶ 启动游戏</button>
            ${instSelect}
          </div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1.25fr 1fr;gap:14px;margin-top:14px">
        <div style="min-width:0">
          <div class="section-title" style="margin-top:0">最近游玩</div>
          <div class="row" style="gap:10px;overflow-x:auto;padding-bottom:4px">
            ${recent.map((i) => `
              <div class="card hoverable" data-open="${escapeHtml(i.id)}" style="flex:0 0 auto;width:170px;padding:10px">
                ${coverNode(i, 150, 84, 7)}
                <div class="bold ellipsis mt-1" style="font-size:13px">${escapeHtml(i.name)}</div>
                <div class="tiny muted ellipsis">${i.lastPlayed ? new Date(timeVal(i.lastPlayed)).toLocaleDateString('zh-CN') : '从未游玩'}</div>
              </div>`).join('')}
          </div>
        </div>
        <div>
          <div class="section-title" style="margin-top:0">快捷入口</div>
          <div class="grid cols-3">
            ${quick.map((q) => `
              <div class="card hoverable center" data-go="${q.path}" style="padding:14px 8px" ${q.badge ? `data-tip="检测到 ${q.badge} 个局域网世界"` : ''}>
                <div style="font-size:22px">${q.icon}</div>
                <div class="small mt-1">${q.label}${q.badge ? ` <span class="badge ok">${q.badge}</span>` : ''}</div>
              </div>`).join('')}
          </div>
        </div>
      </div>
      ${d.lans.length ? `<div class="small muted mt-3">🌐 检测到 ${d.lans.length} 个局域网世界：${escapeHtml(d.lans.slice(0, 2).map((w) => (w.host || '') + ' — ' + (w.motd || '')).join('；'))}${d.lans.length > 2 ? ' 等' : ''}，去「联机」页查看。</div>` : ''}
      ${act.length ? '<div class="card" id="home-dl" style="margin-top:14px;padding:12px 16px;cursor:pointer"></div>' : ''}`;
  }

  // 绑定
  bindSwitch();
  bindLaunch(el.querySelector('#home-launch'), cur, acc);
  el.querySelectorAll('[data-open]').forEach((c) => { c.onclick = () => { location.hash = '/instances/' + c.dataset.open; }; });
  el.querySelectorAll('[data-go]').forEach((c) => { c.onclick = () => { location.hash = c.dataset.go; }; });
  const addAcc = el.querySelector('#home-add-acc');
  if (addAcc) addAcc.onclick = () => { location.hash = '/accounts'; };
  const sel = el.querySelector('#home-switch-inst');
  sel.onchange = async () => {
    try {
      await api.settings.set({ currentInstanceId: sel.value });
      const n = insts.find((i) => i.id === sel.value);
      toast(`已切换到「${(n && n.name) || '该实例'}」`, 'ok', 1500);
      renderHome(el, ctx, layout);
    } catch (e) {
      toast('切换实例失败：' + (e.message || e), 'error');
    }
  };
  const holder = el.querySelector('#home-dl');
  if (holder) holder.onclick = () => { location.hash = '/downloads'; };
  updateDlBar(d);
}

const classicPage = {
  id: 'home', title: '主页', icon: '🏠',
  home: 'classic', routes: ['/'], order: 1,
  async render(el, ctx) { return renderHome(el, ctx, 'classic'); },
};
const immersivePage = {
  id: 'home', title: '主页', icon: '🏠',
  home: 'immersive', routes: ['/'], order: 1, noPad: true,
  async render(el, ctx) { return renderHome(el, ctx, 'immersive'); },
};

export default [classicPage, immersivePage];
