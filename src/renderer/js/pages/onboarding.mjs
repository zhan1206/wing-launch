// 首次引导：全屏 4 步向导（欢迎 / 外观 / 账户 / 实例）
import { api, on } from '../api.js';
import { toast, setBreadcrumb, escapeHtml, skeletonRows, progressBar, showDialog } from '../ui.js';

const FALLBACK_PRESETS = [
  { id: 'dark-space', name: '深空黑', mode: 'dark', color: '#4f8cff', blur: 0, dim: 0.35 },
  { id: 'simple-white', name: '简约白', mode: 'light', color: '#4f8cff', blur: 0, dim: 0.35 },
  { id: 'emerald', name: '翡翠绿', mode: 'dark', color: '#3ecf7a', blur: 0, dim: 0.35 },
];

let offs = [];
let timers = [];
function reg(fn) { if (typeof fn === 'function') offs.push(fn); }
function regT(id) { timers.push(id); return id; }
function cleanup() {
  offs.splice(0).forEach((f) => { try { f(); } catch { /* 忽略 */ } });
  timers.splice(0).forEach((id) => clearTimeout(id));
}
function atOnboarding() { return (location.hash.replace(/^#/, '') || '/') === '/onboarding'; }

const W = {
  step: 0, done: false,
  mode: null, themeId: null, theme: null, presets: null,
  method: 'offline', account: null,
  ms: null, msStarting: false, msPolling: false, msDone: false, msError: '',
  offlineName: '', offlineError: '', yggError: '',
  recs: null, recsFailed: '',
  creating: null, lastCreate: null, createError: '',
};
function resetW() {
  W.step = 0; W.done = false;
  W.mode = null; W.themeId = null; W.theme = null; W.presets = null;
  W.method = 'offline'; W.account = null;
  W.ms = null; W.msStarting = false; W.msPolling = false; W.msDone = false; W.msError = '';
  W.offlineName = ''; W.offlineError = ''; W.yggError = '';
  W.recs = null; W.recsFailed = '';
  W.creating = null; W.lastCreate = null; W.createError = '';
}

let CUR = { el: null, ctx: null };
function repaint() { if (CUR.el && atOnboarding()) paint(CUR.el, CUR.ctx); }

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

/* ---------- 结束 / 跳过 ---------- */
async function setWizardDone() {
  try { await api.settings.set({ wizardDone: true }); } catch { /* 保存失败也继续进入 */ }
}
async function skipAll() {
  W.ms = null;
  await setWizardDone();
  toast('已跳过引导，随时可以在设置里调整外观和账户。', 'info', 3500);
  location.hash = '/';
}
async function finishWizard() {
  W.ms = null;
  await setWizardDone();
  W.done = true;
  toast('设置完成！', 'ok');
  location.hash = '/';
}

/* ---------- 布局 ---------- */
function footer(step, nextLabel) {
  return `<div class="row mt-4">
    ${step > 0 ? '<button class="btn" id="ob-back">← 上一步</button>' : '<span></span>'}
    <div class="spacer"></div>
    ${nextLabel ? `<button class="btn primary lg" id="ob-next">${nextLabel}</button>` : ''}
  </div>`;
}
function bindFooter(box) {
  const back = box.querySelector('#ob-back');
  if (back) back.onclick = () => { W.ms = null; W.step = Math.max(0, W.step - 1); repaint(); };
  const next = box.querySelector('#ob-next');
  if (next) next.onclick = () => { W.ms = null; W.step = Math.min(3, W.step + 1); repaint(); };
}

function paint(el, ctx) {
  CUR = { el, ctx };
  const steps = ['欢迎', '选择外观', '添加账户', '创建实例'];
  el.innerHTML = `
  <style>
    button.card { width:100%; font:inherit; color:var(--fg); cursor:pointer; }
    .ob-sel { border-color:var(--accent) !important; box-shadow:0 0 0 1px var(--accent) !important; }
  </style>
  <div style="position:fixed;inset:0;z-index:400;background:var(--bg);overflow-y:auto">
    <button class="btn ghost sm" id="ob-skip" style="position:absolute;top:12px;right:16px;z-index:5">跳过，直接进入 →</button>
    <div style="min-height:100%;display:flex;align-items:center;justify-content:center;padding:60px 24px 48px">
      <div style="width:min(720px,94vw)">
        <div class="row" style="justify-content:center;gap:8px;margin-bottom:22px">
          ${steps.map((s, i) => `<span class="badge ${i === W.step ? 'accent' : ''}" style="${i < W.step ? 'opacity:.5' : ''}">${i + 1} · ${s}</span>`).join('')}
        </div>
        <div id="ob-body"><div class="col">${skeletonRows(4)}</div></div>
      </div>
    </div>
  </div>`;
  el.querySelector('#ob-skip').onclick = () => skipAll();
  const body = el.querySelector('#ob-body');
  const stepsFn = [stepWelcome, stepAppearance, stepAccount, stepInstance];
  stepsFn[W.step](body, ctx);
}

/* ---------- 第 1 步：欢迎 ---------- */
function stepWelcome(box) {
  box.innerHTML = `
    <div class="center">
      <div style="font-size:52px">🧱</div>
      <h1 style="font-size:26px;margin:10px 0 8px">欢迎使用Wing Launch</h1>
      <p class="muted">接下来花 2 分钟完成设置，之后就能直接玩了。</p>
    </div>
    ${footer(0, '开始设置')}`;
  box.querySelector('#ob-next').onclick = () => { W.step = 1; repaint(); };
}

/* ---------- 第 2 步：选择外观 ---------- */
async function stepAppearance(box) {
  if (!W.mode) {
    box.innerHTML = `<div class="col">${skeletonRows(3)}</div>`;
    W.mode = 'dark';
    let ps = [];
    try { ps = (await api.theme.presets()) || []; } catch { ps = []; }
    W.presets = ps.length ? ps : FALLBACK_PRESETS;
    const p = W.presets.find((x) => /深空黑/.test(x.name || '')) || W.presets[0];
    W.themeId = p ? (p.id || p.name) : null;
    W.theme = p ? themeFields(p) : { mode: 'dark', color: '#4f8cff', background: null, blur: 0, dim: 0.35 };
    try { await api.settings.set({ theme: W.theme }); } catch { /* 预览失败不阻塞 */ }
    if (W.step === 1 && atOnboarding()) repaint();
    return;
  }
  if (!W.presets) {
    let ps = [];
    try { ps = (await api.theme.presets()) || []; } catch { ps = []; }
    W.presets = ps.length ? ps : FALLBACK_PRESETS;
  }
  const rec = W.presets.filter((p) => /深空黑|简约白|翡翠绿/.test(p.name || '')).slice(0, 3);
  const list = rec.length ? rec : W.presets.slice(0, 3);
  box.innerHTML = `
    <h2 style="font-size:20px;margin-bottom:6px">选择外观</h2>
    <p class="muted small mb-3">先挑一个顺眼的样子，之后在「设置 → 外观」里随时可改。</p>
    <div class="grid cols-2">
      <button class="card hoverable ${W.mode === 'light' ? 'ob-sel' : ''}" id="ob-mode-light" style="text-align:left;padding:16px">
        <div class="row"><div style="font-size:26px">☀️</div><div><div class="bold">亮色</div><div class="small muted">白天看得更清楚</div></div></div>
      </button>
      <button class="card hoverable ${W.mode === 'dark' ? 'ob-sel' : ''}" id="ob-mode-dark" style="text-align:left;padding:16px">
        <div class="row"><div style="font-size:26px">🌙</div><div><div class="bold">暗色</div><div class="small muted">夜里不刺眼</div></div></div>
      </button>
    </div>
    <div class="section-title">推荐主题</div>
    <div class="grid cols-3">
      ${list.map((p, i) => `
        <button class="card hoverable ${W.themeId === (p.id || p.name) ? 'ob-sel' : ''}" data-ti="${i}" style="text-align:left;padding:12px">
          <div class="row" style="gap:8px">
            <div style="width:34px;height:34px;border-radius:8px;flex:0 0 auto;background:${escapeHtml(p.color || '#4f8cff')}"></div>
            <div style="min-width:0"><div class="bold small ellipsis">${escapeHtml(p.name || '主题')}</div><div class="tiny muted">${p.mode === 'light' ? '亮色' : '暗色'}</div></div>
          </div>
        </button>`).join('')}
    </div>
    ${footer(1, '下一步')}`;
  box.querySelector('#ob-mode-light').onclick = () => setMode('light');
  box.querySelector('#ob-mode-dark').onclick = () => setMode('dark');
  box.querySelectorAll('[data-ti]').forEach((b) => {
    b.onclick = async () => {
      const p = list[+b.dataset.ti];
      if (!p) return;
      W.themeId = p.id || p.name;
      W.theme = themeFields(p);
      W.mode = p.mode || W.mode;
      try { await api.settings.set({ theme: W.theme }); } catch (e) { toast('主题预览失败：' + (e.message || e), 'warn'); }
      repaint();
    };
  });
  bindFooter(box);
}
async function setMode(m) {
  W.mode = m;
  W.theme = { ...(W.theme || { color: '#4f8cff', background: null, blur: 0, dim: 0.35 }), mode: m };
  try { await api.settings.set({ theme: W.theme }); } catch (e) { toast('预览失败：' + (e.message || e), 'warn'); }
  repaint();
}

/* ---------- 第 3 步：添加账户 ---------- */
function stepAccount(box) {
  const opts = [
    { id: 'offline', icon: '🎮', name: '离线账户', desc: '最简单，输入昵称即可' },
    { id: 'microsoft', icon: '🪪', name: '微软正版账户', desc: '使用正版账号登录' },
    { id: 'yggdrasil', icon: '🌍', name: '第三方皮肤站账户', desc: 'LittleSkin / Ely.by 等' },
  ];
  box.innerHTML = `
    <h2 style="font-size:20px;margin-bottom:6px">添加账户</h2>
    <p class="muted small mb-3">选择一种登录方式；也可以先跳过，之后在「账户」页添加。</p>
    <div class="col" style="gap:8px">
      ${opts.map((o) => `
        <button class="card hoverable ${W.method === o.id ? 'ob-sel' : ''}" data-method="${o.id}" style="text-align:left;padding:13px 16px">
          <div class="row">
            <div style="font-size:22px">${o.icon}</div>
            <div style="flex:1;min-width:0"><div class="bold">${o.name}</div><div class="small muted">${o.desc}</div></div>
            ${W.method === o.id ? '<span class="badge accent">已选择</span>' : ''}
          </div>
        </button>`).join('')}
    </div>
    <div id="ob-method-body" class="mt-3"></div>
    ${footer(2, '下一步')}`;
  box.querySelectorAll('[data-method]').forEach((b) => {
    b.onclick = () => {
      W.method = b.dataset.method;
      W.offlineError = ''; W.yggError = '';
      if (W.method === 'microsoft') {
        if (!W.ms && !W.msStarting && !W.msDone) startMsFlow();
        else repaint();
        return;
      }
      repaint();
    };
  });
  bindFooter(box);
  renderMethodBody(box.querySelector('#ob-method-body'));
}

function renderMethodBody(sub) {
  if (!sub) return;
  if (W.method === 'offline') {
    sub.innerHTML = `
      ${W.account ? `<div class="small" style="color:var(--ok)">✅ 当前账户：${escapeHtml(W.account.displayName || W.account.name || '')}</div>` : ''}
      <div class="row" style="max-width:440px">
        <input class="input" id="ob-offline-name" placeholder="输入游戏昵称，例如 Steve" maxlength="16" value="${escapeHtml(W.offlineName || '')}">
        <button class="btn primary" id="ob-offline-add">添加账户</button>
      </div>
      ${W.offlineError ? `<div class="small mt-2" style="color:var(--err)">${escapeHtml(W.offlineError)}</div>` : ''}`;
    sub.querySelector('#ob-offline-name').oninput = (e) => { W.offlineName = e.target.value; };
    sub.querySelector('#ob-offline-add').onclick = async () => {
      const name = sub.querySelector('#ob-offline-name').value.trim();
      if (!name) { toast('请先输入昵称', 'warn'); return; }
      W.offlineName = name;
      const btn = sub.querySelector('#ob-offline-add');
      btn.disabled = true; btn.textContent = '正在添加…';
      try {
        W.account = await api.accounts.addOffline(name);
        W.offlineError = '';
        toast('离线账户添加成功', 'ok');
        repaint();
      } catch (e) {
        W.offlineError = (e.message || e) + '。请检查昵称后重试，也可以先跳过这一步。';
        repaint();
      }
    };
  } else if (W.method === 'microsoft') {
    if (W.msStarting) {
      sub.innerHTML = '<div class="row muted small"><div class="spinner sm"></div>正在向微软请求设备码…</div>';
      return;
    }
    if (W.msError) {
      sub.innerHTML = `
        <div class="card" style="border-color:color-mix(in srgb, var(--err) 40%, transparent);max-width:520px">
          <div class="small" style="color:var(--err)">${escapeHtml(W.msError)}</div>
          <div class="row mt-2">
            <button class="btn sm" id="ob-ms-retry">重试</button>
            <button class="btn sm ghost" id="ob-ms-skip">先跳过，稍后在账户页添加</button>
          </div>
        </div>`;
      sub.querySelector('#ob-ms-retry').onclick = () => startMsFlow();
      sub.querySelector('#ob-ms-skip').onclick = () => { W.msError = ''; W.step = 3; repaint(); };
      return;
    }
    if (W.msDone && W.account) {
      sub.innerHTML = `<div class="small" style="color:var(--ok)">✅ 微软账户 ${escapeHtml(W.account.displayName || W.account.name || '')} 登录成功，点「下一步」继续。</div>`;
      return;
    }
    if (!W.ms) {
      sub.innerHTML = `
        <div class="small muted">将打开微软设备码登录：显示一串代码，你在浏览器里输入即可完成授权，全程不会索要账号密码。</div>
        <button class="btn primary mt-2" id="ob-ms-start">开始登录</button>`;
      sub.querySelector('#ob-ms-start').onclick = () => startMsFlow();
      return;
    }
    sub.innerHTML = `
      <div class="card" style="max-width:480px">
        <div class="small muted">在浏览器打开验证页面，输入这串代码完成登录：</div>
        <div class="mt-2"><code style="font-size:24px;letter-spacing:4px;font-weight:700" id="ob-ms-code">${escapeHtml(W.ms.userCode || '')}</code></div>
        <div class="row mt-2">
          <button class="btn sm" id="ob-ms-copy">复制代码</button>
          <button class="btn sm" id="ob-ms-open">打开验证页面</button>
        </div>
        <div class="row mt-2 muted small"><div class="spinner sm"></div>等待授权中，每 ${Math.round((W.ms.interval || 5000) / 1000)} 秒自动检查一次…</div>
      </div>`;
    sub.querySelector('#ob-ms-copy').onclick = async () => {
      try { await api.clip.write(W.ms.userCode || ''); toast('已复制设备码', 'ok', 1500); }
      catch {
        try { await navigator.clipboard.writeText(W.ms.userCode || ''); toast('已复制设备码', 'ok', 1500); }
        catch { toast('复制失败，请手动选择代码复制', 'warn'); }
      }
    };
    sub.querySelector('#ob-ms-open').onclick = async () => {
      try { await api.shell.openPath(W.ms.verifyUrl || ''); }
      catch {
        await showDialog({
          title: '无法自动打开浏览器',
          body: `<p>请手动复制这个链接，到浏览器里打开完成验证：</p><p><code>${escapeHtml(W.ms.verifyUrl || '')}</code></p>`,
          actions: [{ label: '知道了', value: true, primary: true }],
        });
      }
    };
  } else {
    sub.innerHTML = `
      ${W.account ? `<div class="small" style="color:var(--ok)">✅ 当前账户：${escapeHtml(W.account.displayName || W.account.name || '')}</div>` : ''}
      <div class="row wrap" style="max-width:600px">
        <select class="input" id="ob-ygg-site" style="width:160px">
          <option value="littleskin">LittleSkin</option>
          <option value="elyby">Ely.by</option>
        </select>
        <input class="input" id="ob-ygg-user" placeholder="邮箱或用户名" style="flex:1;min-width:170px">
        <input class="input" id="ob-ygg-pass" type="password" placeholder="密码" style="flex:1;min-width:150px">
        <button class="btn primary" id="ob-ygg-add">登录并添加</button>
      </div>
      ${W.yggError ? `<div class="small mt-2" style="color:var(--err)">${escapeHtml(W.yggError)}</div><div class="mt-2"><button class="btn sm ghost" id="ob-ygg-skip">先跳过，稍后在账户页添加</button></div>` : ''}`;
    sub.querySelector('#ob-ygg-add').onclick = async () => {
      const site = sub.querySelector('#ob-ygg-site').value;
      const user = sub.querySelector('#ob-ygg-user').value.trim();
      const pass = sub.querySelector('#ob-ygg-pass').value;
      if (!user || !pass) { toast('请填写账号和密码', 'warn'); return; }
      const btn = sub.querySelector('#ob-ygg-add');
      btn.disabled = true; btn.textContent = '正在登录…';
      try {
        W.account = await api.accounts.addYggdrasil({ preset: site, username: user, password: pass });
        W.yggError = '';
        toast('账户添加成功', 'ok');
        repaint();
      } catch (e) {
        W.yggError = (e.message || e) + '。请确认账号、密码与站点选择是否正确。';
        repaint();
      }
    };
    const sk = sub.querySelector('#ob-ygg-skip');
    if (sk) sk.onclick = () => { W.yggError = ''; W.step = 3; repaint(); };
  }
}

async function startMsFlow() {
  if (W.msStarting) return;
  W.msStarting = true; W.ms = null; W.msError = '';
  repaint();
  try {
    const r = await api.accounts.msStart();
    W.msStarting = false;
    W.ms = { deviceId: r.deviceId, userCode: r.userCode, verifyUrl: r.verifyUrl, interval: r.interval || 5000 };
    if (!atOnboarding()) return;
    repaint();
    msPollLoop();
  } catch (e) {
    W.msStarting = false;
    W.msError = '无法开始微软登录：' + (e.message || e) + '。可能是网络不通或登录服务暂时不可用，可稍后重试或改用其他方式。';
    repaint();
  }
}
function msPollLoop() {
  if (!W.ms || W.msPolling) return;
  W.msPolling = true;
  const iv = W.ms.interval || 5000;
  regT(setTimeout(async () => {
    W.msPolling = false;
    if (!W.ms || !atOnboarding()) { W.ms = null; return; }
    try {
      const r = await api.accounts.msPoll(W.ms.deviceId);
      if (r && r.status === 'done') {
        W.account = r.account || null;
        W.msDone = true;
        W.ms = null;
        toast('微软账户登录成功', 'ok');
        repaint();
        return;
      }
      msPollLoop();
    } catch (e) {
      W.ms = null;
      W.msError = '查询登录状态失败：' + (e.message || e) + '。可以重试，或改用其他登录方式。';
      repaint();
    }
  }, iv));
}

/* ---------- 第 4 步：创建第一个实例 ---------- */
async function stepInstance(box) {
  if (W.recs === null) {
    box.innerHTML = `
      <h2 style="font-size:20px;margin-bottom:10px">创建第一个实例</h2>
      <div class="col">${skeletonRows(2)}</div>`;
    let rs = [];
    try { rs = (await api.versions.recommend()) || []; } catch (e) { W.recsFailed = e.message || String(e); }
    W.recs = rs;
    if (W.step === 3 && atOnboarding()) repaint();
    return;
  }
  if (W.creating) {
    box.innerHTML = `
      <h2 style="font-size:20px;margin-bottom:6px">正在创建实例</h2>
      <div class="card" style="max-width:520px">
        <div class="row"><div class="spinner"></div>
          <div style="flex:1;min-width:0"><div class="bold">${escapeHtml(W.creating.name)}</div>
          <div class="small muted" id="ob-cp-text">${escapeHtml(W.creating.text)}</div></div></div>
        <div class="mt-2" id="ob-cp-bar">${W.creating.pct != null ? progressBar(W.creating.pct) : progressBar(null, { indeterminate: true })}</div>
        <div class="tiny muted mt-2">正在下载游戏与所需组件，视网络情况可能需要几分钟。</div>
      </div>`;
    return;
  }
  if (W.recsFailed && !W.recs.length) {
    box.innerHTML = `
      <h2 style="font-size:20px;margin-bottom:6px">创建第一个实例</h2>
      <div class="card" style="max-width:560px">
        <div class="small" style="color:var(--warn)">推荐版本列表获取失败：${escapeHtml(W.recsFailed)}。可能是网络暂时不通。</div>
        <div class="row mt-2">
          <button class="btn sm" id="ob-recs-retry">重试</button>
          <button class="btn sm ghost" id="ob-pick-own">我想自己选择</button>
        </div>
      </div>`;
    box.querySelector('#ob-recs-retry').onclick = () => { W.recs = null; W.recsFailed = ''; repaint(); };
    box.querySelector('#ob-pick-own').onclick = goOwn;
    return;
  }
  const pickA = W.recs.find((r) => r.type === 'release') || W.recs[0] || null;
  const vidA = pickA ? String(pickA.versionId || pickA.id || '') : '';
  const pickB = W.recs.find((r) => String(r.versionId || r.id || '').includes('1.20.1')) || null;
  const vidB = pickB ? String(pickB.versionId || pickB.id || '1.20.1') : '1.20.1';
  const loaderB = (pickB && pickB.loader) || 'forge';
  box.innerHTML = `
    <h2 style="font-size:20px;margin-bottom:6px">创建第一个实例</h2>
    <p class="muted small mb-3">选一个开始玩；创建时会自动下载游戏本体和所需组件。</p>
    ${W.createError ? `
      <div class="card mb-3" style="border-color:color-mix(in srgb, var(--err) 40%, transparent)">
        <div class="small" style="color:var(--err)">实例创建失败：${escapeHtml(W.createError)}</div>
        <div class="row mt-2">
          <button class="btn sm" id="ob-create-retry">重试</button>
          <button class="btn sm ghost" id="ob-create-skip">先进入启动器</button>
        </div>
      </div>` : ''}
    <div class="grid cols-2">
      <button class="card hoverable" id="ob-create-a" style="text-align:left;padding:16px">
        <div style="font-size:26px">🌱</div>
        <div class="bold mt-1">最新正式版 · 原版</div>
        <div class="small muted">${vidA ? '版本 ' + escapeHtml(vidA) : ''}</div>
        <div class="tiny muted mt-1">适合体验最新内容，纯净稳定。</div>
      </button>
      <button class="card hoverable" id="ob-create-b" style="text-align:left;padding:16px">
        <div style="font-size:26px">🔨</div>
        <div class="bold mt-1">1.20.1 · Forge 热门模组版</div>
        <div class="small muted">版本 ${escapeHtml(vidB)} · Forge</div>
        <div class="tiny muted mt-1">模组生态最成熟的版本，适合玩大型整合。</div>
      </button>
    </div>
    <div class="center mt-3"><button class="btn ghost" id="ob-pick-own">我想自己选择版本和加载器 →</button></div>`;
  box.querySelector('#ob-create-a').onclick = () => createInstance('最新正式版', vidA, 'vanilla');
  box.querySelector('#ob-create-b').onclick = () => createInstance('1.20.1 Forge', vidB, loaderB);
  box.querySelector('#ob-pick-own').onclick = goOwn;
  const rt = box.querySelector('#ob-create-retry');
  if (rt) rt.onclick = () => {
    W.createError = '';
    if (W.lastCreate) createInstance(W.lastCreate.name, W.lastCreate.versionId, W.lastCreate.loader);
    else repaint();
  };
  const sk = box.querySelector('#ob-create-skip');
  if (sk) sk.onclick = () => finishWizard();
}

async function goOwn() {
  W.ms = null;
  await setWizardDone();
  W.done = true;
  location.hash = '/instances';
}

async function createInstance(name, versionId, loader) {
  W.createError = '';
  W.lastCreate = { name, versionId, loader };
  W.creating = { name, text: '正在准备创建…', pct: null };
  repaint();
  const off = on('bb:install-progress', (d) => {
    if (!W.creating || !atOnboarding()) return;
    if (d && d.text) W.creating.text = d.text;
    if (d && d.total) W.creating.pct = Math.round(((d.received || 0) / d.total) * 100);
    const t = document.getElementById('ob-cp-text');
    if (t && d && d.text) t.textContent = d.text;
    const bar = document.getElementById('ob-cp-bar');
    if (bar) bar.innerHTML = W.creating.pct != null ? progressBar(W.creating.pct) : progressBar(null, { indeterminate: true });
  });
  reg(off);
  const stop = () => { try { off && off(); } catch { /* 忽略 */ } };
  try {
    await api.instances.create({ name, versionId, loader });
    stop();
    W.creating = null;
    toast('实例创建成功', 'ok');
    finishWizard();
  } catch (e) {
    stop();
    W.creating = null;
    W.createError = (e.message || String(e)) + '。可以重试，或之后在「实例」页手动创建。';
    repaint();
  }
}

export default {
  id: 'onboarding',
  title: '首次引导',
  icon: '🧭',
  routes: ['/onboarding'],
  order: 0,
  hiddenNav: true,
  noPad: true,
  async render(el, ctx) {
    if (W.done) resetW();
    cleanup();
    setBreadcrumb([{ label: '首次引导' }]);
    paint(el, ctx);
  },
};
