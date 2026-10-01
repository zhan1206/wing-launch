// 实例列表页 + 实例详情页
import { api, on } from '../api.js';
import {
  toast, confirmDialog, showDialog, emptyState, skeletonRows,
  progressBar, setBreadcrumb, escapeHtml, dragPaths, attachContextMenu,
} from '../ui.js';
import { setDropText } from '../ui.js';

const $ = (s, el = document) => el.querySelector(s);

/* ---------- 事件订阅与清理 ---------- */
let offFns = [];
function sub(ch, cb) {
  try {
    const off = on(ch, cb);
    if (typeof off === 'function') offFns.push(off);
  } catch { /* 忽略 */ }
}
function clearSubs() {
  for (const f of offFns) { try { f(); } catch { /* 忽略 */ } }
  offFns = [];
}
// 离开 /instances 路由时兜底清理（页面内跳转由各 render 开头的 clearSubs 处理）
window.addEventListener('hashchange', () => {
  const p = location.hash.replace(/^#/, '');
  if (!p.startsWith('/instances')) { clearSubs(); IL_LIST = []; }
});

let SETTINGS = null;

/* ---------- 通用工具 ---------- */
const LOADERS = { vanilla: '原版', forge: 'Forge', fabric: 'Fabric', quilt: 'Quilt', neoforge: 'NeoForge' };
const ACC_TYPES = { offline: '离线', microsoft: '微软正版', yggdrasil: '外置登录' };
const TABS = [['mods', '模组'], ['worlds', '存档'], ['resourcepacks', '资源包'], ['shaders', '光影包'], ['backups', '备份']];

function loaderLabel(l) { return LOADERS[l] || l || '原版'; }
function loaderBadge(l) {
  const t = escapeHtml(loaderLabel(l));
  return (!l || l === 'vanilla') ? `<span class="badge">${t}</span>` : `<span class="badge accent">${t}</span>`;
}
function accTypeBadge(t) { return t ? `<span class="badge">${escapeHtml(ACC_TYPES[t] || t)}</span>` : ''; }

function zhErr(e) {
  let s = '';
  if (e && typeof e === 'object') s = String(e.message || e.__err || '');
  else s = String(e || '');
  s = s.trim();
  if (!s) return '出了点问题，请稍后再试';
  if (/^[\x00-\x7F]+$/.test(s)) return `出了点问题（${s.slice(0, 120)}）。请重试；如果反复出现，请到设置里查看日志。`;
  return s;
}
// 新增诊断类接口在旧版后台不存在，降级为可理解的提示
function diagErr(e) {
  const m = zhErr(e);
  return /接通中|__unimplemented/.test(m) ? '该功能需要较新版本支持' : m;
}

function bbimg(p) { return 'bbimg://' + String(p).split('/').map(encodeURIComponent).join('/'); }

function toTs(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const n = Date.parse(String(v));
  return Number.isNaN(n) ? 0 : n;
}
function fmtTime(v) {
  if (!v) return '从未';
  const d = v instanceof Date ? v : new Date(typeof v === 'number' ? v : String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  const diff = Date.now() - d.getTime();
  const min = 60000, hour = 3600000, day = 86400000;
  if (diff < min) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / min)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 30 * day) return `${Math.floor(diff / day)} 天前`;
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}
function fmtSize(n) {
  n = Number(n) || 0;
  if (n >= 1073741824) return `${(n / 1073741824).toFixed(2)} GB`;
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}
function fmtNum(n) {
  n = Number(n) || 0;
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)} 亿`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)} 万`;
  return String(n);
}
function baseName(p) { return String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || String(p || ''); }

function loadErrorHtml(msg) {
  return emptyState({ icon: '😵', title: '加载失败了', text: msg, actionsHtml: '<button class="btn primary retry-btn">重试</button>' });
}
function showRetryable(box, msg, retry) {
  box.innerHTML = loadErrorHtml(msg);
  const b = box.querySelector('.retry-btn');
  if (b) b.onclick = retry;
}

// 区域拖入：dragover 高亮 + drop 收集路径；drop 后补发一次 dragleave 让全局遮罩计数复位
function wireDrop(zone, onDrop) {
  if (!zone) return;
  zone.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); zone.classList.add('drag'); });
  zone.addEventListener('dragleave', (e) => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag'); });
  zone.addEventListener('drop', (e) => {
    e.preventDefault(); e.stopPropagation();
    zone.classList.remove('drag');
    try { window.dispatchEvent(new Event('dragleave')); } catch { /* 忽略 */ }
    onDrop(dragPaths(e));
  });
}

function pickVersion(versions, gameVersion, loader) {
  const arr = Array.isArray(versions) ? versions.slice() : [];
  if (!arr.length) return null;
  const score = (v) => {
    let s = 0;
    const gvs = Array.isArray(v.gameVersions) ? v.gameVersions : [];
    const lds = Array.isArray(v.loaders) ? v.loaders : [];
    if (gameVersion && gvs.length) s += gvs.includes(gameVersion) ? 4 : -4;
    if (loader && lds.length) s += lds.includes(loader) ? 2 : -2;
    return s;
  };
  arr.sort((a, b) => score(b) - score(a) || toTs(b.date) - toTs(a.date));
  return arr[0];
}

function likelihoodInfo(l) {
  let w = 1, label = '低';
  if (typeof l === 'number') {
    if (l > 0 && l < 1) { w = l; label = l >= 0.66 ? '高' : l >= 0.33 ? '中' : '低'; }
    else { w = l; label = l >= 3 ? '高' : l >= 2 ? '中' : '低'; }
  } else {
    const s = String(l || '').toLowerCase();
    if (['high', '高'].includes(s)) { w = 3; label = '高'; }
    else if (['medium', 'mid', '中'].includes(s)) { w = 2; label = '中'; }
    else if (['low', '低'].includes(s)) { w = 1; label = '低'; }
    else { w = 0; label = String(l || '') || '低'; }
  }
  const cls = w >= 2.9 ? 'err' : w >= 1.9 ? 'warn' : '';
  return { w, label, cls };
}
function likelihoodBadge(l) {
  const i = likelihoodInfo(l);
  return `<span class="badge ${i.cls}">可能性：${escapeHtml(i.label)}</span>`;
}

/* ---------- 页面私有样式 ---------- */
let styled = false;
function injectStyles() {
  if (styled) return;
  styled = true;
  const st = document.createElement('style');
  st.textContent = `
#drop-overlay { pointer-events: none !important; }
.inst-card { padding: 10px; }
.inst-cover { position: relative; aspect-ratio: 16 / 9; border-radius: 8px; overflow: hidden; background: var(--card-2); }
.inst-cover img, .row-img, .world-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
.cover-ph { width: 100%; height: 100%; display: grid; place-items: center; font-size: 34px; font-weight: 700; color: #fff;
  background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 45%, #9d5cff)); }
.cover-start { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  background: rgba(8,10,14,.45); opacity: 0; transition: opacity .15s; }
.inst-card:hover .cover-start { opacity: 1; }
.detail-banner { position: relative; height: 150px; border-radius: 12px; overflow: hidden; cursor: pointer; background: var(--card-2); }
.detail-banner .banner-ph { width: 100%; height: 100%; display: grid; place-items: center; font-size: 46px; font-weight: 700; color: #fff;
  background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 45%, #9d5cff)); }
.detail-banner .banner-mask { position: absolute; inset: 0; display: flex; align-items: flex-end; justify-content: flex-end;
  padding: 10px 14px; background: linear-gradient(180deg, transparent 55%, rgba(8,10,14,.55)); color: #fff; font-size: 12.5px; opacity: 0; transition: opacity .15s; }
.detail-banner:hover .banner-mask { opacity: 1; }
.detail-name { font-size: 20px; cursor: pointer; }
.detail-name:hover { color: var(--accent); }
.dropzone { border: 2px dashed var(--border-2); border-radius: var(--radius); padding: 18px; text-align: center; color: var(--fg-3); font-size: 13px;
  transition: border-color .15s, background .15s, color .15s; }
.dropzone.drag { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, transparent); color: var(--fg-2); }
.loader-pill { padding: 6px 14px; border-radius: 99px; border: 1px solid var(--border-2); background: var(--card-2); cursor: pointer;
  font: inherit; font-size: 13px; color: var(--fg-2); }
.loader-pill:hover { border-color: var(--fg-3); color: var(--fg); }
.loader-pill.active { background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--accent); border-color: var(--accent); font-weight: 600; }
.menu-pop { position: absolute; right: 0; top: calc(100% + 6px); z-index: 600; min-width: 190px; background: var(--card);
  border: 1px solid var(--border-2); border-radius: 10px; box-shadow: var(--shadow); padding: 5px; display: flex; flex-direction: column; gap: 1px; }
.menu-pop button { display: block; width: 100%; text-align: left; padding: 8px 12px; border: none; background: none; color: var(--fg);
  font: inherit; font-size: 13px; cursor: pointer; border-radius: 6px; white-space: nowrap; }
.menu-pop button:hover { background: var(--hover); }
.menu-pop button.danger { color: var(--err); }
.world-cover { aspect-ratio: 16 / 9; border-radius: 8px; overflow: hidden; display: grid; place-items: center; font-size: 34px;
  background: linear-gradient(135deg, color-mix(in srgb, var(--ok) 40%, var(--card-2)), var(--card-2)); }
.warn-card { border-color: color-mix(in srgb, var(--warn) 45%, transparent); background: color-mix(in srgb, var(--warn) 7%, var(--card)); }
.link { color: var(--accent); cursor: pointer; text-decoration: none; }
.link:hover { text-decoration: underline; }
`;
  document.head.appendChild(st);
}

/* ---------- 崩溃分析弹窗 ---------- */
async function showCrashDialog(instanceId, session) {
  await showDialog({
    title: '崩溃分析',
    wide: true,
    body: `<div class="col center" style="padding:34px 0; gap:12px"><div class="spinner"></div><div class="small muted">正在分析崩溃日志，请稍等…</div></div>`,
    actions: [{ label: '关闭', value: true }],
    onMount: async (mask) => {
      const body = $('.dialog-body', mask);
      let rep;
      try { rep = await api.crash.analyze({ instanceId, session }); } catch (e) {
        body.innerHTML = emptyState({ icon: '😵', title: '分析失败了', text: zhErr(e), actionsHtml: '<button class="btn primary cr-retry">重试</button>' });
        const b = body.querySelector('.cr-retry');
        if (b) b.onclick = () => showCrashDialog(instanceId, session);
        return;
      }
      if (!rep || rep.empty) {
        body.innerHTML = `<p>${escapeHtml((rep && rep.message) || '没有找到可以分析的崩溃记录。')}</p>
          <p class="small muted mt-2">如果游戏刚刚崩溃，等几秒钟再试一次。</p>
          ${rep && rep.logPath ? '<div class="mt-3"><button class="btn sm cr-folder">📂 打开日志文件夹</button></div>' : ''}`;
        const fb = body.querySelector('.cr-folder');
        if (fb) fb.onclick = () => api.shell.showInFolder({ path: rep.logPath }).catch((e) => toast(zhErr(e), 'error'));
        return;
      }
      const causes = (Array.isArray(rep.causes) ? rep.causes : []).slice()
        .sort((a, b) => likelihoodInfo(b.likelihood).w - likelihoodInfo(a.likelihood).w);
      const fixes = Array.isArray(rep.fixes) ? rep.fixes : [];
      body.innerHTML = `
        <div class="mb-3">
          <div class="bold" style="color:var(--fg)">发生了什么</div>
          <div class="mt-1">${escapeHtml(rep.what || '游戏在运行过程中意外退出了。')}</div>
        </div>
        ${causes.length ? `
        <div class="mb-3">
          <div class="bold" style="color:var(--fg)">可能的原因</div>
          <div class="col mt-1">${causes.map((c) => `
            <div class="list-row">
              <div class="row-icon">❓</div>
              <div class="col" style="gap:2px; flex:1">
                <div class="row" style="gap:8px"><span class="bold">${escapeHtml(c.title || '未知原因')}</span>${likelihoodBadge(c.likelihood)}</div>
                ${c.detail ? `<div class="tiny muted-3">${escapeHtml(c.detail)}</div>` : ''}
              </div>
            </div>`).join('')}</div>
        </div>` : ''}
        <div class="mb-3">
          <div class="bold" style="color:var(--fg)">怎么解决</div>
          <div class="col mt-1">${fixes.length ? fixes.map((f, i) => `
            <div class="list-row">
              <div class="row-icon">🛠</div>
              <div class="small" style="flex:1">${escapeHtml(f.text || '')}</div>
              ${f.action ? `<button class="btn sm primary cr-fix" data-fix="${i}">一键执行</button>` : ''}
            </div>`).join('') : '<div class="small muted">暂时没有自动修复方案，可以打开日志查找更多信息。</div>'}</div>
        </div>
        <div class="row wrap mt-3" style="gap:8px">
          <button class="btn sm cr-copy">📋 复制报告</button>
          ${rep.logPath ? '<button class="btn sm cr-folder">📂 打开日志文件夹</button>' : ''}
        </div>`;
      body.querySelectorAll('.cr-fix').forEach((btn) => {
        btn.onclick = async () => {
          const f = fixes[Number(btn.dataset.fix)];
          btn.disabled = true; btn.textContent = '执行中…';
          try {
            await api.crash.applyFix({ instanceId, fix: f });
            toast('已修复，可以重新启动游戏了', 'ok');
            btn.textContent = '已执行';
          } catch (e) {
            btn.disabled = false; btn.textContent = '一键执行';
            toast(zhErr(e), 'error', 5000);
          }
        };
      });
      const copyBtn = body.querySelector('.cr-copy');
      if (copyBtn) copyBtn.onclick = async () => {
        try { await api.clip.write(rep.reportText || ''); toast('报告已复制到剪贴板', 'ok'); } catch (e) { toast(zhErr(e), 'error', 5000); }
      };
      const folderBtn = body.querySelector('.cr-folder');
      if (folderBtn) folderBtn.onclick = () => api.shell.showInFolder({ path: rep.logPath }).catch((e) => toast(zhErr(e), 'error'));
    },
  });
}

/* ---------- 新建实例弹窗 ---------- */
async function openCreate(onDone) {
  let versions = [];
  let versionsOk = true;
  try { versions = await api.versions.listAll() || []; } catch { versionsOk = false; }
  versions = (Array.isArray(versions) ? versions : []).filter((v) => v && v.id)
    .sort((a, b) => String(b.releaseTime || '').localeCompare(String(a.releaseTime || '')));
  let showSnap = !!(SETTINGS && SETTINGS.showSnapshots);
  let loader = 'vanilla';
  let creating = false;
  let taskId = null;
  await showDialog({
    title: '新建实例',
    wide: true,
    body: `
      <label class="field"><span class="field-label">实例名称</span><input class="input" id="ni-name" value="我的世界"></label>
      <div class="field"><span class="field-label">游戏版本</span>
        <div class="row wrap" style="gap:8px">
          <select class="input" id="ni-version" style="flex:1; min-width:180px"></select>
          <span class="badge ok" id="ni-vtype">正式版</span>
          <label class="row tiny" style="gap:6px; flex:none"><span class="switch"><input type="checkbox" id="ni-snap" ${showSnap ? 'checked' : ''}><span class="track"></span></span>显示快照</label>
        </div>
        ${versionsOk ? '' : '<div class="small mt-1" style="color:var(--err)">版本列表没有加载成功，请关闭后重试。</div>'}
      </div>
      <div class="field"><span class="field-label">加载器</span>
        <div class="row wrap" style="gap:8px" id="ni-loaders">
          ${Object.entries(LOADERS).map(([k, l]) => `<button class="loader-pill ${k === 'vanilla' ? 'active' : ''}" data-v="${k}">${l}</button>`).join('')}
        </div>
        <div class="field-hint">启动器会自动下载所需的 Java 和游戏文件</div>
        <div id="ni-loader-rec" class="mt-1"></div>
      </div>
      <div id="ni-progress" style="display:none">
        <div class="row small muted mb-2" style="gap:8px"><div class="spinner sm"></div><span id="ni-stage">正在准备安装…</span></div>
        <div id="ni-bar">${progressBar(null)}</div>
      </div>
      <div id="ni-error" class="small mt-2" style="display:none; color:var(--err)"></div>`,
    actions: [{ label: '取消', value: false }, { label: '创建', value: true, primary: true }],
    onMount(mask, close) {
      // 创建期间挡住遮罩点击，避免误关
      const shield = document.createElement('div');
      shield.style.cssText = 'position:fixed;inset:0;z-index:20;display:none';
      mask.appendChild(shield);
      const sel = $('#ni-version', mask);
      const updateType = () => {
        const v = versions.find((x) => x.id === sel.value);
        const t = $('#ni-vtype', mask);
        if (t) {
          const snap = !!(v && v.type === 'snapshot');
          t.textContent = snap ? '快照' : '正式版';
          t.className = `badge ${snap ? 'warn' : 'ok'}`;
        }
      };
      const rebuild = () => {
        const pool = versions.filter((v) => showSnap || v.type !== 'snapshot');
        sel.innerHTML = pool.map((v) => `<option value="${escapeHtml(v.id)}">${escapeHtml(v.id)}（${v.type === 'snapshot' ? '快照' : '正式版'}）</option>`).join('');
        const first = pool.find((v) => v.type !== 'snapshot') || pool[0];
        if (first) sel.value = first.id;
        updateType();
        refreshRec();
      };
      // 加载器推荐：随所选游戏版本刷新（后台没接通时静默隐藏）
      const recBox = $('#ni-loader-rec', mask);
      let recToken = 0;
      async function refreshRec() {
        if (!recBox) return;
        const v = sel.value;
        if (!v) { recBox.innerHTML = ''; return; }
        const my = ++recToken;
        recBox.innerHTML = '<div class="row tiny muted" style="gap:6px"><div class="spinner sm"></div><span>正在获取这个版本的加载器建议…</span></div>';
        let r;
        try { r = await api.loader.recommend({ mc: v }); } catch { recBox.innerHTML = ''; return; }
        if (my !== recToken) return;
        const rec = r && r.recommendation;
        let recKey = '';
        let recReason = '';
        if (typeof rec === 'string') recKey = rec.trim();
        else if (rec && typeof rec === 'object') {
          recKey = String(rec.loader || rec.id || rec.name || '').trim();
          recReason = String(rec.reason || rec.desc || '');
        }
        const recLabel = LOADERS[recKey.toLowerCase()] || recKey;
        const inc = r && Array.isArray(r.incompat) ? r.incompat : (r && r.incompat != null && r.incompat !== '' ? [r.incompat] : []);
        const incLabels = inc.map((x) => LOADERS[String(x).toLowerCase()] || String(x));
        if (!recLabel && !incLabels.length) { recBox.innerHTML = ''; return; }
        recBox.innerHTML = `
          ${recLabel ? `<div class="row wrap small" style="gap:8px; align-items:center"><span class="badge accent" data-tip="启动器按版本兼容性给出的建议">推荐使用 ${escapeHtml(recLabel)}</span>${recReason ? `<span class="tiny muted-3">${escapeHtml(recReason)}</span>` : (r && r.basis ? `<span class="tiny muted-3">${escapeHtml(String(r.basis))}</span>` : '')}</div>` : ''}
          ${incLabels.length ? `<div class="tiny mt-1" style="color:var(--warn)">这个版本可能不适配：${escapeHtml(incLabels.join('、'))}，强行安装可能无法启动。</div>` : ''}`;
      }
      sel.onchange = () => { updateType(); refreshRec(); };
      rebuild();
      $('#ni-snap', mask).onchange = (e) => { showSnap = e.target.checked; rebuild(); };
      const pillWrap = $('#ni-loaders', mask);
      pillWrap.querySelectorAll('.loader-pill').forEach((p) => {
        p.onclick = () => {
          loader = p.dataset.v;
          pillWrap.querySelectorAll('.loader-pill').forEach((x) => x.classList.toggle('active', x === p));
        };
      });
      const errBox = $('#ni-error', mask);
      const showErr = (m) => { errBox.textContent = m; errBox.style.display = ''; };
      const btns = mask.querySelectorAll('.dialog-actions .btn');
      const cancelBtn = btns[0];
      const createBtn = btns[1];
      if (createBtn) createBtn.onclick = async () => {
        if (creating) return;
        const nameVal = $('#ni-name', mask).value.trim() || '我的世界';
        const versionId = sel.value;
        if (!versionId) { showErr('请先选择一个游戏版本；如果列表是空的，请关闭后重新打开。'); return; }
        creating = true;
        taskId = null;
        shield.style.display = 'block';
        createBtn.disabled = true; createBtn.textContent = '创建中…';
        if (cancelBtn) cancelBtn.disabled = true;
        $('#ni-progress', mask).style.display = '';
        errBox.style.display = 'none';
        sub('bb:install-progress', (d) => {
          if (!d) return;
          if (taskId == null) taskId = d.taskId;
          if (d.taskId !== taskId) return;
          const stg = $('#ni-stage', mask);
          if (stg) stg.textContent = d.text || d.stage || '正在下载游戏文件…';
          const bar = $('#ni-bar', mask);
          if (bar) bar.innerHTML = progressBar(d.total > 0 ? Math.round((d.received / d.total) * 100) : null);
        });
        try {
          const res = await api.instances.create({ name: nameVal, versionId, loader });
          const finalName = res && res.renamedTo ? res.renamedTo : (res && res.name && res.name !== nameVal ? res.name : null);
          if (finalName) toast(`已经有同名实例了，帮你改成了「${finalName}」`, 'info', 5000);
          toast('实例创建完成', 'ok');
          close(true);
          if (res && res.id) location.hash = `/instances/${encodeURIComponent(res.id)}`;
          else if (onDone) onDone();
        } catch (e) {
          creating = false;
          taskId = null;
          shield.style.display = 'none';
          createBtn.disabled = false; createBtn.textContent = '创建';
          if (cancelBtn) cancelBtn.disabled = false;
          $('#ni-progress', mask).style.display = 'none';
          showErr(`${zhErr(e)}。可以点击「创建」重试。`);
        }
      };
    },
  });
}

/* ---------- 实例列表页 ---------- */
async function quickLaunch(inst, btn) {
  if (!inst) return;
  if (btn) { btn.disabled = true; btn.textContent = '启动中…'; }
  try {
    const res = await api.instances.launch({ id: inst.id });
    activeLaunch = { id: inst.id, session: (res && res.session) || null };
    toast(`正在启动「${inst.name}」…`, 'ok', 4000);
  } catch (e) {
    toast(zhErr(e), 'error', 5000);
  }
  if (btn) { btn.disabled = false; btn.textContent = '▶ 启动'; }
}

/* ---------- 列表卡片右键菜单（模块级只注册一次） ---------- */
let IL_LIST = [];       // 列表页当前的实例数据，供右键菜单按卡片 data-id 查找
let IL_RELOAD = null;   // 列表页刷新函数
let instMenuBound = false;
function ensureInstCardMenu() {
  if (instMenuBound) return;
  instMenuBound = true;
  attachContextMenu('.grid .card', (cardEl) => {
    const inst = IL_LIST.find((x) => x.id === cardEl.dataset.id);
    if (!inst) return []; // 非实例卡片（如存档卡片）不弹菜单
    return [
      { label: '▶ 启动游戏', action: () => quickLaunch(inst, cardEl.querySelector('.il-start')) },
      { label: '✏️ 重命名', action: () => renameInstanceFromList(inst) },
      { label: '📂 打开文件夹', action: async () => { try { await api.instances.openFolder({ id: inst.id }); } catch (e) { toast(zhErr(e), 'error'); } } },
      { label: '📋 复制名称', action: async () => { try { await api.clip.write({ text: inst.name || '' }); toast('名称已复制', 'ok'); } catch (e) { toast(zhErr(e), 'error'); } } },
      { label: '🗑 删除实例', danger: true, action: () => removeInstanceFromList(inst) },
    ];
  });
}
async function renameInstanceFromList(inst) {
  let entered = '';
  await showDialog({
    title: '重命名实例',
    body: `<label class="field"><span class="field-label">实例名称</span><input class="input" id="il-rn-input"></label>`,
    actions: [{ label: '取消', value: false }, { label: '确定', value: true, primary: true }],
    onMount(mask, close) {
      const i = $('#il-rn-input', mask);
      i.value = inst.name || '';
      i.focus();
      i.select();
      i.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); const b = $('.dialog-actions .btn.primary', mask); if (b) b.click(); } });
      const ok = $('.dialog-actions .btn.primary', mask);
      if (ok) ok.onclick = () => { entered = i.value.trim(); close(true); };
    },
  });
  if (!entered || entered === inst.name) return;
  try {
    const res = await api.instances.rename({ id: inst.id, name: entered });
    const real = typeof res === 'string' ? res : ((res && (res.name || res.renamedTo)) || entered);
    if (real !== entered) toast(`这个名称已经被占用了，帮你改成了「${real}」`, 'info', 5000);
    else toast('已重命名', 'ok');
    if (IL_RELOAD) IL_RELOAD();
  } catch (e) { toast(zhErr(e), 'error', 5000); }
}
async function removeInstanceFromList(inst) {
  const ok = await confirmDialog('删除实例', `整个实例（模组/存档/配置）会移入回收站，可以在资源管理器中撤销。确定删除「${inst.name || '未命名实例'}」吗？`, { danger: true, okLabel: '删除' });
  if (!ok) return;
  try {
    await api.instances.remove({ id: inst.id });
    toast('已移入回收站，可以在资源管理器中撤销', 'ok');
    if (IL_RELOAD) IL_RELOAD();
  } catch (e) { toast(zhErr(e), 'error', 5000); }
}

async function renderList(el, ctx) {
  clearSubs();
  injectStyles();
  setBreadcrumb([{ label: '主页', onClick() { location.hash = '/'; } }, { label: '实例' }]);
  setDropText('松开鼠标，启动器会自动识别文件类型');
  el.innerHTML = `<div class="grid auto">${'<div class="skeleton skl-card"></div>'.repeat(8)}</div>`;
  let instances;
  try { instances = await api.instances.list() || []; } catch (e) {
    showRetryable(el, `实例列表加载失败：${zhErr(e)}`, () => renderList(el, ctx));
    return;
  }
  instances = (Array.isArray(instances) ? instances : []).slice().sort((a, b) => toTs(b.lastPlayed) - toTs(a.lastPlayed));
  IL_LIST = instances;
  IL_RELOAD = () => renderList(el, ctx);
  ensureInstCardMenu();
  let keyword = '';
  el.innerHTML = `
    <div class="row wrap mb-3">
      <div class="section-title" style="margin:0">我的实例</div>
      <span class="badge">${instances.length}</span>
      <div class="spacer"></div>
      <input class="input sm" id="il-search" placeholder="搜索实例…" style="width:200px">
      <button class="btn primary" id="il-new">＋ 新建实例</button>
    </div>
    <div class="grid auto" id="il-grid"></div>`;
  const grid = $('#il-grid', el);
  const cardHtml = (i) => `
    <div class="card hoverable inst-card" data-id="${escapeHtml(i.id || '')}">
      <div class="inst-cover">${i.cover ? `<img src="${bbimg(i.cover)}" alt="">` : `<div class="cover-ph">${escapeHtml(String(i.name || '?').slice(0, 1))}</div>`}
        <div class="cover-start"><button class="btn primary sm il-start">▶ 启动</button></div>
      </div>
      <div class="col mt-2" style="gap:5px">
        <div class="bold ellipsis" data-tip="${escapeHtml(i.name || '')}">${escapeHtml(i.name || '未命名实例')}</div>
        <div class="row wrap" style="gap:5px">
          ${i.versionId ? `<span class="badge accent">${escapeHtml(String(i.versionId))}</span>` : ''}
          ${loaderBadge(i.loader)}
          <span class="badge">${Number(i.modsCount || 0)} 个模组</span>
        </div>
        <div class="tiny muted-3">上次游玩：${fmtTime(i.lastPlayed)}</div>
      </div>
    </div>`;
  const renderGrid = () => {
    const shown = instances.filter((i) => !keyword || String(i.name || '').toLowerCase().includes(keyword));
    if (!instances.length) {
      grid.innerHTML = emptyState({
        icon: '🗂️', title: '还没有实例',
        text: '创建一个实例，选好版本和加载器，就能开始游玩了。',
        actionsHtml: '<button class="btn primary" id="il-empty-new">去创建第一个实例</button>',
      });
      const b = $('#il-empty-new', grid);
      if (b) b.onclick = () => openCreate(() => renderList(el, ctx));
      return;
    }
    if (!shown.length) {
      grid.innerHTML = emptyState({
        icon: '🔍', title: '没有匹配的实例',
        text: `没有找到名称包含「${keyword}」的实例，换个关键词试试。`,
        actionsHtml: '<button class="btn" id="il-clear-search">清除搜索</button>',
      });
      const cb = $('#il-clear-search', grid);
      if (cb) cb.onclick = () => { search.value = ''; keyword = ''; renderGrid(); };
      return;
    }
    grid.innerHTML = shown.map(cardHtml).join('');
    grid.querySelectorAll('.inst-card').forEach((card) => {
      const inst = instances.find((x) => x.id === card.dataset.id);
      card.onclick = () => { location.hash = `/instances/${encodeURIComponent(card.dataset.id)}`; };
      const sb = card.querySelector('.il-start');
      if (sb) sb.onclick = (e) => { e.stopPropagation(); quickLaunch(inst, sb); };
    });
  };
  const search = $('#il-search', el);
  search.oninput = () => { keyword = search.value.trim().toLowerCase(); renderGrid(); };
  $('#il-new', el).onclick = () => openCreate(() => renderList(el, ctx));
  sub('bb:launch-warning', (d) => { if (d && d.text) toast(String(d.text), 'warn', 6000); });
  renderGrid();
}

/* ---------- 实例详情页 ---------- */
let D = null; // 当前详情页上下文
let activeLaunch = null; // { id, session }

async function renderDetail(el, ctx) {
  clearSubs();
  injectStyles();
  const id = decodeURIComponent((ctx.params || [])[0] || '');
  const tab = (ctx.params || [])[1] || 'mods';
  el.innerHTML = `<div class="skeleton" style="height:150px;border-radius:12px"></div>
    <div class="skeleton skl-text mt-3" style="width:45%"></div>
    <div class="skeleton skl-card mt-3"></div>`;
  const [rList, rDetail, rAcc] = await Promise.allSettled([api.instances.list(), api.instances.detail(id), api.accounts.list()]);
  const list = rList.status === 'fulfilled' ? (rList.value || []) : null;
  const det = rDetail.status === 'fulfilled' ? rDetail.value : null;
  const accounts = rAcc.status === 'fulfilled' ? (rAcc.value || []) : [];
  const inst = list ? (list.find((i) => i.id === id) || null) : null;
  if (!inst && !det) {
    if (rList.status === 'rejected') {
      showRetryable(el, `实例信息加载失败：${zhErr(rList.reason)}`, () => renderDetail(el, ctx));
    } else {
      el.innerHTML = emptyState({
        icon: '🗂️', title: '没有找到这个实例', text: '它可能已经被删除了。',
        actionsHtml: '<button class="btn primary">返回实例列表</button>',
      });
      el.querySelector('.btn').onclick = () => { location.hash = '/instances'; };
    }
    return;
  }
  const name = (inst && inst.name) || (det && det.name) || '实例';
  const versionId = (inst && inst.versionId) || (det && det.versionId) || '';
  const loader = (inst && inst.loader) || (det && det.loader) || 'vanilla';
  const cover = (inst && inst.cover) || (det && det.cover) || null;
  const boundAccountId = (inst && inst.boundAccountId) ?? (det && det.boundAccountId) ?? (det && det.settings && det.settings.boundAccountId) ?? null;
  D = { el, ctx, id, tab, name, versionId, loader, cover, accounts, boundAccountId };
  D.reload = () => renderDetail(D.el, D.ctx);
  setBreadcrumb([
    { label: '主页', onClick() { location.hash = '/'; } },
    { label: '实例', onClick() { location.hash = '/instances'; } },
    { label: name },
  ]);
  const bindAcc = accounts.find((a) => a.id === boundAccountId) || null;
  let curSession = null;

  el.innerHTML = `
    <div class="detail-banner" id="d-banner" data-tip="点击更换封面图片">
      ${cover ? `<img class="banner-img" src="${bbimg(cover)}" alt="">` : `<div class="banner-ph">${escapeHtml(name.slice(0, 1))}</div>`}
      <div class="banner-mask"><span>🖼 更换封面</span></div>
    </div>
    <div class="row wrap mt-3" style="gap:12px">
      <div class="col" style="gap:6px; min-width:200px">
        <h2 class="detail-name" id="d-name" data-tip="点击修改实例名称">${escapeHtml(name)}</h2>
        <div class="row wrap" style="gap:6px">
          ${versionId ? `<span class="badge accent">${escapeHtml(String(versionId))}</span>` : ''}
          ${loaderBadge(loader)}
          <span class="tiny muted-3">上次游玩：${fmtTime((inst && inst.lastPlayed) ?? (det && det.lastPlayed))}</span>
        </div>
      </div>
      <div class="spacer"></div>
      <select class="input sm" id="d-temp-acc" style="width:auto" data-tip="本次启动临时使用的账户（不会被保存）">
        <option value="">使用默认账户</option>
        ${accounts.map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.displayName || a.name || '账户')}</option>`).join('')}
      </select>
      <button class="btn primary lg" id="d-launch">▶ 启动游戏</button>
      <div id="d-more-wrap" style="position:relative"><button class="btn lg" id="d-more" data-tip="更多操作">···</button></div>
    </div>
    <div id="d-launch-prog" class="mt-2" style="display:none">
      <div class="row small muted"><span id="d-launch-stage">正在准备启动…</span></div>
      <div id="d-launch-bar" class="mt-1"></div>
    </div>
    <div class="card mt-3">
      <div class="row wrap" style="gap:10px">
        <span>👤</span>
        <span class="bold">默认账户</span>
        <span id="d-bind-name">${escapeHtml(bindAcc ? (bindAcc.displayName || bindAcc.name || '已绑定') : '跟随全局当前账户')}</span>
        ${accTypeBadge(bindAcc && bindAcc.type)}
        <div class="spacer"></div>
        <select class="input sm" id="d-bind-select" style="width:auto">
          <option value="">跟随全局当前账户</option>
          ${accounts.map((a) => `<option value="${escapeHtml(a.id)}" ${a.id === boundAccountId ? 'selected' : ''}>${escapeHtml(a.displayName || a.name || '账户')}</option>`).join('')}
        </select>
      </div>
      <div class="tiny muted-3 mt-1">启动此实例时自动使用该账户，也可以在上方启动按钮旁临时切换，临时选择不会被保存。${accounts.length ? '' : ' 还没有任何账户，'}` +
    (accounts.length ? '' : '<a class="link" href="#/accounts">去添加账户</a>') + `</div>
    </div>
    <div class="tabs mt-4">
      ${TABS.map(([k, l]) => `<button class="tab ${k === tab ? 'active' : ''}" data-tab="${k}">${l}</button>`).join('')}
    </div>
    <div id="d-tab-body"></div>`;

  /* --- 启动 --- */
  const resetLaunchUI = () => {
    const btn = $('#d-launch', el);
    if (btn) { btn.disabled = false; btn.textContent = '▶ 启动游戏'; }
    const wrap = $('#d-launch-prog', el);
    if (wrap) wrap.style.display = 'none';
  };
  const showLaunchingUI = (session) => {
    curSession = session || null;
    const btn = $('#d-launch', el);
    if (btn) { btn.disabled = true; btn.textContent = '启动中…'; }
    const wrap = $('#d-launch-prog', el);
    if (wrap) {
      wrap.style.display = '';
      $('#d-launch-bar', el).innerHTML = progressBar(null);
      $('#d-launch-stage', el).textContent = '正在准备启动…';
    }
  };
  const doLaunch = async () => {
    if (curSession || (activeLaunch && activeLaunch.id === id)) { toast('游戏已经在启动中了', 'info'); return; }
    showLaunchingUI(null);
    activeLaunch = { id, session: null };
    const accSel = $('#d-temp-acc', el);
    const accountId = accSel && accSel.value ? accSel.value : undefined;
    try {
      const res = await api.instances.launch({ id, accountId });
      const session = (res && res.session) || null;
      if (activeLaunch && activeLaunch.id === id) activeLaunch.session = session;
      curSession = session;
      toast(`正在启动「${name}」…`, 'ok', 4000);
    } catch (e) {
      activeLaunch = null;
      curSession = null;
      resetLaunchUI();
      toast(zhErr(e), 'error', 5000);
    }
  };
  $('#d-launch', el).onclick = doLaunch;
  if (activeLaunch && activeLaunch.id === id) showLaunchingUI(activeLaunch.session);
  sub('bb:launch-progress', (d) => {
    if (!d || !curSession || d.session !== curSession) return;
    const stg = $('#d-launch-stage', el);
    if (stg) stg.textContent = d.text || d.stage || '正在启动…';
    const bar = $('#d-launch-bar', el);
    if (bar) bar.innerHTML = progressBar(d.percent ?? null);
  });
  sub('bb:launch-exit', (d) => {
    if (!d) return;
    if (d.instanceId && d.instanceId !== id) return;
    if (curSession && d.session && d.session !== curSession) return;
    const ours = !!curSession || d.instanceId === id;
    if (ours) {
      if (activeLaunch && activeLaunch.id === id) activeLaunch = null;
      curSession = null;
      resetLaunchUI();
      if (d.crashed) showCrashDialog(id, d.session);
      else {
        const life = Number(d.lifetimeMs) || 0;
        const dur = life >= 60000 ? `本次游玩 ${(life / 60000).toFixed(0)} 分钟` : '本次游玩不到 1 分钟';
        toast(`游戏已退出，${dur}`, 'info');
      }
    }
  });
  sub('bb:launch-warning', (d) => { if (d && d.text) toast(String(d.text), 'warn', 6000); });

  /* --- 头部操作 --- */
  $('#d-banner', el).onclick = async () => {
    let p;
    try { p = await api.pick.file({ title: '选择封面图片', filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }] }); } catch (e) { toast(zhErr(e), 'error'); return; }
    if (!p) return;
    try { await api.instances.setCover({ id, path: p }); toast('封面已更新', 'ok'); D.reload(); } catch (e) { toast(zhErr(e), 'error', 5000); }
  };
  $('#d-name', el).onclick = async () => {
    let entered = '';
    await showDialog({
      title: '重命名实例',
      body: `<label class="field"><span class="field-label">实例名称</span><input class="input" id="rn-input"></label>`,
      actions: [{ label: '取消', value: false }, { label: '确定', value: true, primary: true }],
      onMount(mask, close) {
        const i = $('#rn-input', mask);
        i.value = name;
        i.focus();
        i.select();
        i.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); const b = $('.dialog-actions .btn.primary', mask); if (b) b.click(); } });
        const ok = $('.dialog-actions .btn.primary', mask);
        if (ok) ok.onclick = () => { entered = i.value.trim(); close(true); };
      },
    });
    if (!entered || entered === name) return;
    try {
      const res = await api.instances.rename({ id, name: entered });
      const real = typeof res === 'string' ? res : ((res && (res.name || res.renamedTo)) || entered);
      if (real !== entered) toast(`这个名称已经被占用了，帮你改成了「${real}」`, 'info', 5000);
      else toast('已重命名', 'ok');
      D.name = real;
      D.reload();
    } catch (e) { toast(zhErr(e), 'error', 5000); }
  };
  const removeInstance = async () => {
    const ok = await confirmDialog('删除实例', `整个实例（模组/存档/配置）会移入回收站，可以在资源管理器中撤销。确定删除「${name}」吗？`, { danger: true, okLabel: '删除' });
    if (!ok) return;
    try {
      await api.instances.remove({ id });
      toast('已移入回收站，可以在资源管理器中撤销', 'ok');
      location.hash = '/instances';
    } catch (e) { toast(zhErr(e), 'error', 5000); }
  };
  $('#d-more', el).onclick = (e) => {
    e.stopPropagation();
    const old = el.querySelector('.menu-pop');
    if (old) { old.remove(); return; }
    const pop = document.createElement('div');
    pop.className = 'menu-pop';
    pop.innerHTML = `
      <button data-act="folder">📂 打开文件夹</button>
      <button data-act="crash">💥 查看上次崩溃分析</button>
      <button data-act="export">📤 导出 .mcinstance</button>
      <button data-act="migrate">📥 从其他启动器导入</button>
      <button data-act="remove" class="danger">🗑 删除实例</button>`;
    $('#d-more-wrap', el).appendChild(pop);
    pop.addEventListener('click', (ev) => ev.stopPropagation());
    pop.querySelector('[data-act="folder"]').onclick = async () => {
      pop.remove();
      try { await api.instances.openFolder({ id }); } catch (err) { toast(zhErr(err), 'error'); }
    };
    pop.querySelector('[data-act="crash"]').onclick = () => { pop.remove(); showCrashDialog(id); };
    pop.querySelector('[data-act="export"]').onclick = () => { pop.remove(); exportInstanceFlow(id, name); };
    pop.querySelector('[data-act="migrate"]').onclick = () => { pop.remove(); migrateFromLauncherFlow(id); };
    pop.querySelector('[data-act="remove"]').onclick = () => { pop.remove(); removeInstance(); };
  };
  const closePop = () => { const p = el.querySelector('.menu-pop'); if (p) p.remove(); };
  document.addEventListener('click', closePop);
  offFns.push(() => document.removeEventListener('click', closePop));

  /* --- 账户绑定 --- */
  $('#d-bind-select', el).onchange = async (e) => {
    const v = e.target.value;
    try {
      await api.instances.setBoundAccount({ id, accountId: v || null });
      toast(v ? '已更新此实例的默认账户' : '已改为跟随全局账户', 'ok');
    } catch (err) { toast(zhErr(err), 'error', 5000); }
  };

  /* --- 标签页 --- */
  el.querySelectorAll('.tab').forEach((t) => {
    t.onclick = () => {
      if (t.dataset.tab === tab) return;
      location.hash = `/instances/${encodeURIComponent(id)}/${t.dataset.tab}`;
    };
  });
  const body = $('#d-tab-body', el);
  const renderTab = async (box, key) => {
    box.innerHTML = skeletonRows(3);
    try {
      if (key === 'worlds') await worldsTab(box);
      else if (key === 'resourcepacks') await packsTab(box, 'resourcepacks', '资源包', '📦');
      else if (key === 'shaders') await shadersTab(box);
      else if (key === 'backups') await backupsTab(box);
      else await modsTab(box);
    } catch (e) {
      showRetryable(box, `这个标签页加载失败：${zhErr(e)}`, () => renderTab(box, key));
    }
  };
  await renderTab(body, TABS.some(([k]) => k === tab) ? tab : 'mods');
}

/* ---------- 模组冲突诊断 ---------- */
function issueRowHtml(it) {
  const lv = String(it.level || '').toLowerCase();
  const badge = lv === 'high' ? '<span class="badge err">高</span>'
    : lv === 'medium' ? '<span class="badge warn">中</span>'
      : lv === 'low' ? '<span class="badge">提示</span>'
        : `<span class="badge">${escapeHtml(String(it.level || '提示'))}</span>`;
  return `<div class="list-row">
    <div class="row-icon">${lv === 'high' ? '🛑' : '⚠️'}</div>
    <div class="col" style="gap:3px; flex:1; min-width:0">
      <div class="row" style="gap:8px"><span class="bold ellipsis">${escapeHtml((Array.isArray(it.mods) ? it.mods : []).join(' 与 ') || '未知模组')}</span>${badge}</div>
      <div class="small">${escapeHtml(it.reason || '')}</div>
      ${it.advice ? `<div class="small" style="color:var(--fg-2)">建议：${escapeHtml(it.advice)}</div>` : ''}
      ${it.basis ? `<div class="tiny muted-3">判断依据：${escapeHtml(it.basis)}</div>` : ''}
    </div>
  </div>`;
}

async function openConflicts(instanceId, onChange) {
  await showDialog({
    title: '模组冲突诊断',
    wide: true,
    body: `<div class="col center" style="padding:30px 0; gap:10px"><div class="spinner"></div><div class="small muted">正在逐个检查模组，模组多时需要一点时间…</div></div>`,
    actions: [{ label: '关闭', value: true }],
    onMount: async (mask) => {
      const body = $('.dialog-body', mask);
      let g;
      try { g = await api.modsdiag.graph({ instanceId }); } catch (e) {
        body.innerHTML = emptyState({ icon: '🩺', title: '诊断没有完成', text: diagErr(e), actionsHtml: '<button class="btn primary cf-retry">重试</button>' });
        const b = body.querySelector('.cf-retry');
        if (b) b.onclick = () => openConflicts(instanceId, onChange);
        return;
      }
      const issues = Array.isArray(g.issues) ? g.issues : [];
      if (!issues.length) {
        body.innerHTML = `<div class="empty-state"><div class="big">✅</div>
          <div class="title" style="color:var(--ok)">未发现已知冲突</div>
          <div class="small">当前启用的模组没有命中已知冲突组合，Mixin 注入点也没有重叠，可以放心启动游戏。</div></div>`;
        return;
      }
      body.innerHTML = `
        <div class="row wrap mb-2" style="gap:8px">
          <span class="badge warn">发现 ${issues.length} 个问题</span>
          <span class="tiny muted-3">等级「高」的问题很可能导致游戏无法启动，建议先处理。</span>
          <div class="spacer"></div>
          <button class="btn primary sm cf-fix">🔧 自动修复</button>
        </div>
        <div class="col">${issues.map((it) => issueRowHtml(it)).join('')}</div>
        <div class="cf-result mt-3"></div>`;
      const fixBtn = body.querySelector('.cf-fix');
      const resultBox = body.querySelector('.cf-result');
      fixBtn.onclick = async () => {
        fixBtn.disabled = true; fixBtn.textContent = '修复中…';
        resultBox.innerHTML = `<div class="row small muted" style="gap:8px"><div class="spinner sm"></div><span>正在逐条处理，可能需要下载前置模组，请稍等…</span></div>`;
        let r;
        try { r = await api.modsdiag.autoFix({ instanceId }); } catch (e) {
          resultBox.innerHTML = `<div class="small" style="color:var(--err)">自动修复失败：${escapeHtml(diagErr(e))}</div>`;
          fixBtn.disabled = false; fixBtn.textContent = '🔧 自动修复';
          return;
        }
        const acts = Array.isArray(r.actions) ? r.actions : [];
        const okN = Number(r.ok) || 0;
        const failN = Number(r.failed) || 0;
        resultBox.innerHTML = `
          <div class="card ${failN ? 'warn-card' : ''}" style="padding:10px">
            <div class="bold small">${failN ? `修复完成：成功 ${okN} 项，失败 ${failN} 项` : '修复完成，全部成功'}</div>
            <div class="col mt-1">${acts.length ? acts.map((a) => `<div class="small">· ${escapeHtml(a)}</div>`).join('') : '<div class="small muted">这次没有可自动处理的操作。</div>'}</div>
            ${failN ? '<div class="tiny mt-1" style="color:var(--err)">失败原因就写在上面每一条操作里，请按提示手动处理。</div>' : ''}
            <div class="mt-2"><button class="btn ghost sm cf-log">查看启动器为我做了什么</button></div>
            <div class="cf-log-body mt-1" style="display:none"></div>
          </div>`;
        fixBtn.textContent = '已执行';
        if (onChange) { try { onChange(); } catch { /* 忽略 */ } }
        const logBtn = resultBox.querySelector('.cf-log');
        const logBody = resultBox.querySelector('.cf-log-body');
        logBtn.onclick = () => {
          const open = logBody.style.display !== 'none';
          logBody.style.display = open ? 'none' : '';
          logBtn.textContent = open ? '查看启动器为我做了什么' : '收起操作记录';
          if (!logBody.dataset.filled) {
            const log = Array.isArray(r.log) ? r.log : [];
            logBody.innerHTML = log.length ? log.map((en) => `
              <div class="tiny muted-3 mt-1">${escapeHtml(fmtTime(en.time))} · ${escapeHtml(en.type || '操作')}${en.ok != null ? `（成功 ${Number(en.ok) || 0}，失败 ${Number(en.failed) || 0}）` : ''}</div>
              ${(Array.isArray(en.actions) ? en.actions : []).map((a) => `<div class="tiny" style="padding-left:14px">· ${escapeHtml(a)}</div>`).join('')}`).join('')
              : '<div class="tiny muted">暂无操作记录。</div>';
            logBody.dataset.filled = '1';
          }
        };
      };
    },
  });
}

/* ---------- 依赖关系图（两列简易布局：左=已安装模组，右=其依赖） ---------- */
function buildDepsSvg(g) {
  const nodes = Array.isArray(g.nodes) ? g.nodes : [];
  const edges = Array.isArray(g.edges) ? g.edges : [];
  const cycles = Array.isArray(g.cycles) ? g.cycles : [];
  const cycleIds = new Set();
  for (const c of cycles) (Array.isArray(c) ? c : []).forEach((x) => cycleIds.add(x));
  const depCount = new Map();
  for (const e of edges) depCount.set(e.to, (depCount.get(e.to) || 0) + 1);
  const left = nodes.slice().sort((a, b) => (a.deps || []).length - (b.deps || []).length);
  const leftIds = new Set(left.map((n) => n.id));
  const right = [...depCount.keys()]
    .map((id) => {
      const own = nodes.find((n) => n.id === id);
      return { id, name: own ? own.name : id, version: own ? own.version : null, missing: edges.some((e) => e.to === id && e.missing) };
    })
    .sort((a, b) => (depCount.get(b.id) || 0) - (depCount.get(a.id) || 0));
  const NW = 168, NH = 26, GAP = 9, PAD = 8, GAPX = 120;
  const rows = Math.max(left.length, right.length, 1);
  const H = PAD * 2 + rows * (NH + GAP) - GAP;
  const lx = PAD, rx = PAD + NW + GAPX;
  const yOf = (i) => PAD + i * (NH + GAP);
  const trunc = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  let svg = `<svg viewBox="0 0 ${PAD * 2 + NW * 2 + GAPX} ${Math.max(H, 40)}" style="width:100%;height:auto;display:block" role="img" aria-label="模组依赖关系图">`;
  for (const e of edges) {
    const li = left.findIndex((n) => n.id === e.from);
    const ri = right.findIndex((n) => n.id === e.to);
    if (li < 0 || ri < 0) continue;
    const y1 = yOf(li) + NH / 2, y2 = yOf(ri) + NH / 2;
    const cyc = cycleIds.has(e.from) && cycleIds.has(e.to);
    const color = e.missing ? 'var(--err)' : cyc ? 'var(--warn)' : 'var(--border-2)';
    svg += `<line x1="${lx + NW}" y1="${y1}" x2="${rx}" y2="${y2}" stroke="${color}" stroke-width="1.4" ${e.missing ? 'stroke-dasharray="4 3"' : ''} opacity="0.85"></line>`;
  }
  const nodeSvg = (n, x, i, isLeft) => {
    const miss = !isLeft && n.missing;
    const cyc = cycleIds.has(n.id);
    const stroke = miss ? 'var(--err)' : cyc ? 'var(--warn)' : 'var(--border-2)';
    const fill = !isLeft && miss ? 'color-mix(in srgb, var(--err) 10%, var(--card-2))' : 'var(--card-2)';
    const dim = isLeft && n.enabled === false;
    return `<g class="dg-node" data-id="${escapeHtml(n.id)}" style="cursor:pointer">
      <rect x="${x}" y="${yOf(i)}" width="${NW}" height="${NH}" rx="6" fill="${fill}" stroke="${stroke}"${dim ? ' opacity="0.55"' : ''}></rect>
      <text x="${x + 8}" y="${yOf(i) + 17}" font-size="11.5" fill="var(--fg)">${escapeHtml(trunc(n.name, 15))}</text>
      <text x="${x + NW - 8}" y="${yOf(i) + 17}" font-size="10" fill="var(--fg-3)" text-anchor="end">${escapeHtml(trunc(n.version || '', 8))}</text>
      ${miss ? `<text x="${x + NW - 4}" y="${yOf(i) - 3}" font-size="9.5" fill="var(--err)" text-anchor="end">缺失前置</text>` : ''}
      ${cyc ? `<text x="${x + 4}" y="${yOf(i) - 3}" font-size="9.5" fill="var(--warn)">循环依赖</text>` : ''}
      <title>${escapeHtml(n.name)}${n.version ? ' v' + escapeHtml(String(n.version)) : ''}${miss ? '（缺失前置）' : ''}${cyc ? '（循环依赖）' : ''}${dim ? '（已禁用）' : ''}</title>
    </g>`;
  };
  left.forEach((n, i) => { svg += nodeSvg(n, lx, i, true); });
  right.forEach((n, i) => { svg += nodeSvg(n, rx, i, false); });
  svg += '</svg>';
  return { svg, nodes, edges };
}

async function openDepsGraph(instanceId) {
  await showDialog({
    title: '依赖关系图',
    wide: true,
    body: `<div class="col center" style="padding:30px 0; gap:10px"><div class="spinner"></div><div class="small muted">正在整理模组依赖…</div></div>`,
    actions: [{ label: '关闭', value: true }],
    onMount: async (mask) => {
      const body = $('.dialog-body', mask);
      let g;
      try { g = await api.modsdiag.graph({ instanceId }); } catch {
        body.innerHTML = emptyState({
          icon: '🕸️', title: '依赖关系图暂时无法生成',
          text: '依赖关系图暂时无法生成。这通常是因为模组列表中有无法解析的文件。你可以先禁用可疑模组再试。',
          actionsHtml: '<button class="btn primary dg-retry">重试</button>',
        });
        const b = body.querySelector('.dg-retry');
        if (b) b.onclick = () => openDepsGraph(instanceId);
        return;
      }
      const nodes = Array.isArray(g.nodes) ? g.nodes : [];
      const edges = Array.isArray(g.edges) ? g.edges : [];
      if (!nodes.length) {
        body.innerHTML = emptyState({ icon: '🧩', title: '还没有安装模组', text: '先在「模组」标签里安装一些模组，再回来看它们之间的依赖关系。' });
        return;
      }
      const { svg } = buildDepsSvg(g);
      const missCount = edges.filter((e) => e.missing).length;
      const cycCount = Array.isArray(g.cycles) ? g.cycles.length : 0;
      body.innerHTML = `
        <div class="row wrap mb-2" style="gap:8px">
          <span class="badge">模组 ${nodes.length}</span>
          ${missCount ? `<span class="badge err">缺失前置 ${missCount}</span>` : ''}
          ${cycCount ? `<span class="badge warn">循环依赖 ${cycCount}</span>` : ''}
          <span class="tiny muted-3">左列是已安装的模组，右列是它们的前置依赖。点击方块查看详情。</span>
        </div>
        <div style="max-height:46vh; overflow:auto">${svg}</div>
        <div class="dg-detail mt-2"></div>`;
      const detailBox = body.querySelector('.dg-detail');
      body.querySelectorAll('.dg-node').forEach((nd) => {
        nd.addEventListener('click', () => {
          const nid = nd.dataset.id;
          const n = nodes.find((x) => x.id === nid) || null;
          const deps = n ? (n.deps || []) : [];
          const usedBy = edges.filter((e) => e.to === nid).map((e) => e.from);
          const nameOf = (id) => { const f = nodes.find((x) => x.id === id); return f ? f.name : id; };
          detailBox.innerHTML = `<div class="card" style="padding:10px">
            <div class="row" style="gap:8px"><span class="bold">${escapeHtml(n ? n.name : nid)}</span>
              ${n && n.enabled === false ? '<span class="badge warn">已禁用</span>' : ''}
              ${n && n.version ? `<span class="tiny muted-3">v${escapeHtml(String(n.version))}</span>` : ''}</div>
            <div class="small mt-1">依赖哪些：${deps.length ? escapeHtml(deps.map(nameOf).join('、')) : '<span class="muted">无</span>'}</div>
            <div class="small mt-1">被谁依赖：${usedBy.length ? escapeHtml(usedBy.map(nameOf).join('、')) : '<span class="muted">没有其他模组依赖它</span>'}</div>
          </div>`;
        });
      });
    },
  });
}

/* ---------- 模组更新检查 ---------- */
function updateRowHtml(u) {
  const safe = u.level === 'safe';
  return `<div class="list-row">
    <div class="row-icon">${safe ? '🟢' : '🟡'}</div>
    <div class="col" style="gap:2px; flex:1; min-width:0">
      <div class="row" style="gap:8px">
        <span class="bold ellipsis">${escapeHtml(u.name || '未命名模组')}</span>
        <span class="tiny muted-3" style="flex:0 0 auto">${escapeHtml(String(u.current || '?'))} → ${escapeHtml(String(u.latest || '?'))}</span>
      </div>
      ${u.basis ? `<div class="tiny muted-3">判断依据：${escapeHtml(u.basis)}</div>` : ''}
    </div>
    ${u.versionId ? `<button class="btn sm up-one" data-vid="${escapeHtml(u.versionId)}">安装</button>` : ''}
  </div>`;
}

async function openUpdates(instanceId, onChange) {
  await showDialog({
    title: '模组更新检查',
    wide: true,
    body: `<div class="col center" style="padding:30px 0; gap:10px"><div class="spinner"></div><div class="small muted">正在查询 Modrinth 的最新版本，可能需要十几秒…</div></div>`,
    actions: [{ label: '关闭', value: true }],
    onMount: async (mask) => {
      const body = $('.dialog-body', mask);
      let r;
      try { r = await api.modsdiag.updates({ instanceId }); } catch (e) {
        body.innerHTML = emptyState({ icon: '⬆️', title: '更新检查没有完成', text: diagErr(e), actionsHtml: '<button class="btn primary up-retry">重试</button>' });
        const b = body.querySelector('.up-retry');
        if (b) b.onclick = () => openUpdates(instanceId, onChange);
        return;
      }
      const updates = Array.isArray(r.updates) ? r.updates : [];
      const safe = updates.filter((u) => u.level === 'safe');
      const caution = updates.filter((u) => u.level !== 'safe');
      if (!updates.length) {
        body.innerHTML = `
          ${r.classifyNote ? `<div class="small muted mb-2" style="padding:8px 12px; border-radius:8px; background:var(--card-2)">${escapeHtml(String(r.classifyNote))}</div>` : ''}
          <div class="empty-state"><div class="big">🎉</div><div class="title" style="color:var(--ok)">所有检查过的模组都已是最新版本</div>
          <div class="small">启动器查询了已识别来源的模组，没有发现可更新项。</div></div>`;
        return;
      }
      body.innerHTML = `
        ${r.classifyNote ? `<div class="small muted mb-2" style="padding:8px 12px; border-radius:8px; background:var(--card-2)">${escapeHtml(String(r.classifyNote))}</div>` : ''}
        <div class="row wrap mb-2">
          <span class="tiny muted-3">更新会下载新版本文件；如果旧文件没有被自动移除，请到模组列表里删除旧版本。</span>
          <div class="spacer"></div>
          ${safe.length ? '<button class="btn primary sm up-all">全部安装安全更新</button>' : '<span class="tiny muted-3">没有可一键安装的安全更新</span>'}
        </div>
        <div class="bold small" style="color:var(--ok)">安全更新（${safe.length}）</div>
        <div class="col mt-1">${safe.length ? safe.map((u) => updateRowHtml(u)).join('') : '<div class="small muted">无</div>'}</div>
        <div class="bold small mt-3" style="color:var(--warn)">谨慎更新（${caution.length}）</div>
        <div class="col mt-1">${caution.length ? caution.map((u) => updateRowHtml(u)).join('') : '<div class="small muted">无</div>'}</div>
        <div class="up-status mt-2"></div>`;
      const statusBox = body.querySelector('.up-status');
      const installVids = async (vids, btn) => {
        if (!vids.length) return;
        btn.disabled = true;
        try {
          const results = await api.modsdiag.applyUpdates({ instanceId, versionIds: vids });
          const byVid = new Map((Array.isArray(results) ? results : []).map((x) => [x.versionId, x]));
          for (const vid of vids) {
            const u = updates.find((x) => x.versionId === vid) || {};
            const res = byVid.get(vid);
            if (res && res.ok) toast(`「${u.name || '模组'}」已更新到 ${u.latest || '最新版本'}`, 'ok', 4500);
            else toast(`「${u.name || '模组'}」更新失败：${(res && res.message) || '没有可用的文件'}`, 'error', 6000);
          }
          btn.textContent = '已完成';
          if (onChange) { try { onChange(); } catch { /* 忽略 */ } }
        } catch (e) {
          btn.disabled = false; btn.textContent = '重试安装';
          toast(`安装更新失败：${diagErr(e)}`, 'error', 6000);
        }
      };
      const allBtn = body.querySelector('.up-all');
      if (allBtn) allBtn.onclick = () => installVids(safe.map((u) => u.versionId).filter(Boolean), allBtn);
      body.querySelectorAll('.up-one').forEach((btn) => {
        btn.onclick = () => installVids([btn.dataset.vid], btn);
      });
    },
  });
}

/* ---------- 类型冲突 / 加载顺序 ---------- */
function classConflictRow(it, level) {
  const cls = String((it && it.class) || '未知类');
  const mods = Array.isArray(it && it.mods) ? it.mods : [];
  return `<div class="list-row">
    <div class="row-icon">${level === 'high' ? '🛑' : '⚠️'}</div>
    <div class="col" style="gap:3px; flex:1; min-width:0">
      <div class="row" style="gap:8px"><span class="bold ellipsis">${escapeHtml(cls)}</span>
        <span class="badge ${level === 'high' ? 'err' : ''}">${level === 'high' ? '高风险' : '低风险'}</span></div>
      <div class="small">同名类出现在：${escapeHtml(mods.join('、') || '未知模组')}</div>
    </div>
  </div>`;
}

async function openClassConflicts(instanceId, onChange) {
  await showDialog({
    title: '类型冲突检查',
    wide: true,
    body: `<div class="col center" style="padding:30px 0; gap:10px"><div class="spinner"></div><div class="small muted">正在比对模组内的类文件，模组多时需要一点时间…</div></div>`,
    actions: [{ label: '关闭', value: true }],
    onMount: async (mask) => {
      const body = $('.dialog-body', mask);
      let r;
      try { r = await api.loader.classConflicts({ instanceId }); } catch (e) {
        body.innerHTML = emptyState({ icon: '🔀', title: '检查没有完成', text: diagErr(e), actionsHtml: '<button class="btn primary cc-retry">重试</button>' });
        const b = body.querySelector('.cc-retry');
        if (b) b.onclick = () => openClassConflicts(instanceId, onChange);
        return;
      }
      const high = Array.isArray(r && r.high) ? r.high : [];
      const low = Array.isArray(r && r.low) ? r.low : [];
      if (!high.length && !low.length) {
        body.innerHTML = `<div class="empty-state"><div class="big">✅</div>
          <div class="title" style="color:var(--ok)">未发现类冲突</div>
          <div class="small">当前模组之间没有互相覆盖的类文件，可以放心启动游戏。</div></div>`;
        return;
      }
      body.innerHTML = `
        <div class="row wrap mb-2" style="gap:8px">
          ${high.length ? `<span class="badge err">高风险 ${high.length}</span>` : ''}
          ${low.length ? `<span class="badge">低风险 ${low.length}</span>` : ''}
          <span class="tiny muted-3">高风险通常意味着两个模组带了同一个类，运行时可能直接崩溃，建议先处理。</span>
        </div>
        ${r && r.highNote ? `<div class="small muted mb-2" style="padding:8px 12px; border-radius:8px; background:var(--card-2)">${escapeHtml(String(r.highNote))}</div>` : ''}
        ${high.length ? `<div class="col">${high.map((it) => classConflictRow(it, 'high')).join('')}</div>`
          : '<div class="small" style="color:var(--ok)">未发现高风险类冲突。</div>'}
        ${low.length ? `
        <div class="mt-3">
          <button class="btn ghost sm cc-low-toggle">展开低风险列表（${low.length}）</button>
          <div class="cc-low col mt-2" style="display:none"></div>
          ${r && r.lowNote ? `<div class="tiny muted-3 mt-1 cc-low-note" style="display:none">${escapeHtml(String(r.lowNote))}</div>` : ''}
        </div>` : ''}
        ${r && r.basis ? `<div class="tiny muted-3 mt-3">判断依据：${escapeHtml(String(r.basis))}</div>` : ''}`;
      const lowWrap = body.querySelector('.cc-low');
      const lowNote = body.querySelector('.cc-low-note');
      const lowBtn = body.querySelector('.cc-low-toggle');
      if (lowBtn && lowWrap) {
        lowBtn.onclick = () => {
          const open = lowWrap.style.display !== 'none';
          lowWrap.style.display = open ? 'none' : '';
          if (lowNote) lowNote.style.display = open ? 'none' : '';
          lowBtn.textContent = open ? `展开低风险列表（${low.length}）` : '收起低风险列表';
          if (!lowWrap.dataset.filled) {
            lowWrap.innerHTML = low.map((it) => classConflictRow(it, 'low')).join('');
            lowWrap.dataset.filled = '1';
          }
        };
      }
    },
  });
}

async function openLoadOrder(instanceId) {
  await showDialog({
    title: '模组加载顺序',
    wide: true,
    body: `<div class="col center" style="padding:30px 0; gap:10px"><div class="spinner"></div><div class="small muted">正在整理模组的相对优先级…</div></div>`,
    actions: [{ label: '关闭', value: true }],
    onMount: async (mask) => {
      const body = $('.dialog-body', mask);
      let r;
      try { r = await api.loader.loadOrder({ instanceId }); } catch (e) {
        body.innerHTML = emptyState({ icon: '🔢', title: '加载顺序没有生成', text: diagErr(e), actionsHtml: '<button class="btn primary lo-retry">重试</button>' });
        const b = body.querySelector('.lo-retry');
        if (b) b.onclick = () => openLoadOrder(instanceId);
        return;
      }
      const list = Array.isArray(r && r.recommended) ? r.recommended : [];
      const nameOf = (it) => {
        if (typeof it === 'string') return it;
        if (it && typeof it === 'object') return String(it.name || it.mod || it.file || it.id || '未知模组');
        return '未知模组';
      };
      const reasonOf = (it) => (it && typeof it === 'object' ? String(it.reason || it.desc || '') : '');
      if (!list.length) {
        body.innerHTML = `<div class="empty-state"><div class="big">🔢</div>
          <div class="title">暂时没有顺序建议</div>
          <div class="small">当前模组对加载顺序没有特殊要求，保持默认即可。</div></div>`;
        return;
      }
      body.innerHTML = `
        <div class="small muted mb-2" style="padding:8px 12px; border-radius:8px; background:var(--card-2)">Fabric 实际按文件名排序，可通过重命名 jar 文件调整；以下为相对优先级建议。</div>
        <div class="col">${list.map((it, i) => `
          <div class="list-row">
            <div class="row-icon" style="font-weight:700">${i + 1}.</div>
            <div class="col" style="gap:2px; flex:1; min-width:0">
              <div class="bold ellipsis">${escapeHtml(nameOf(it))}</div>
              ${reasonOf(it) ? `<div class="tiny muted-3">${escapeHtml(reasonOf(it))}</div>` : ''}
            </div>
          </div>`).join('')}</div>
        <div class="tiny muted-3 mt-3">这里不做拖拽调整——真实的加载顺序由游戏加载器按自己的规则决定，启动器改不了它；需要调整时重命名 jar 文件即可。</div>
        ${r && r.basis ? `<div class="tiny muted-3 mt-1">判断依据：${escapeHtml(String(r.basis))}</div>` : ''}`;
    },
  });
}

/* ---------- 安装前预检提示（文件已装上，只做提醒） ---------- */
function precheckWarnHtml(w) {
  const lv = String(w.level || '').toLowerCase();
  const badge = lv === 'high' ? '<span class="badge err">高</span>'
    : lv === 'medium' ? '<span class="badge warn">中</span>'
      : '<span class="badge">提示</span>';
  return `<div class="list-row">
    <div class="row-icon">${lv === 'high' ? '🛑' : '⚠️'}</div>
    <div class="col" style="gap:3px; flex:1; min-width:0">
      <div class="row" style="gap:8px"><span class="bold ellipsis">${escapeHtml(w.mod || '未知模组')}</span>${badge}</div>
      <div class="small">${escapeHtml(w.reason || '')}</div>
      ${w.advice ? `<div class="small" style="color:var(--fg-2)">建议：${escapeHtml(w.advice)}</div>` : ''}
      ${w.basis ? `<div class="tiny muted-3">判断依据：${escapeHtml(w.basis)}</div>` : ''}
    </div>
  </div>`;
}

function showPrecheckWarns(warnings) {
  const high = warnings.some((w) => String(w.level || '').toLowerCase() === 'high');
  showDialog({
    title: '安装前预检发现了一些值得注意的问题',
    wide: true,
    body: `
      <p class="small">这些文件已经安装完成${high ? '，其中包含<b>高风险</b>问题，很可能影响游戏启动' : ''}。不用急着删除，建议到模组页先禁用对应模组，确认没有问题后再启用。</p>
      <div class="col mt-2">${warnings.map((w) => precheckWarnHtml(w)).join('')}</div>`,
    actions: [{ label: '知道了', value: true }],
  });
}

/* ---------- 模组标签 ---------- */
async function modsTab(box) {
  const gv = D.versionId || null;
  const ld = D.loader && D.loader !== 'vanilla' ? D.loader : null;
  box.innerHTML = `
    <div class="row wrap mb-3">
      <button class="btn" id="m-add">📥 安装模组</button>
      <button class="btn" id="m-search">🌐 在线搜索安装</button>
      <button class="btn" id="m-scan">🩺 检查缺失前置</button>
      <button class="btn" id="m-diag" data-tip="扫描已知冲突组合与可疑注入点">🧭 冲突诊断</button>
      <button class="btn" id="m-classconf" data-tip="检查不同模组携带同名类文件的冲突">🔀 类型冲突</button>
      <button class="btn" id="m-loadorder" data-tip="查看模组相对加载顺序建议">🔢 加载顺序</button>
      <button class="btn" id="m-graph" data-tip="查看模组之间的前置依赖">🕸 依赖关系图</button>
      <button class="btn" id="m-updates" data-tip="查询 Modrinth 上的新版本">⬆️ 检查更新</button>
      <div class="spacer"></div>
      <span class="tiny muted-3">拖拽 .jar 模组文件到下方区域即可安装</span>
    </div>
    <div class="dropzone mb-3" id="m-drop">把模组文件（.jar / .zip）拖到这里，松手自动安装</div>
    <div id="m-list"></div>`;
  setDropText(`松手后将安装到「${D.name}」的「模组」中`);
  const listWrap = $('#m-list', box);

  const loadMods = async () => {
    listWrap.innerHTML = skeletonRows(3);
    let mods;
    try { mods = await api.mods.list({ instanceId: D.id }) || []; } catch (e) {
      showRetryable(listWrap, `模组列表加载失败：${zhErr(e)}`, loadMods);
      return;
    }
    if (!mods.length) {
      listWrap.innerHTML = emptyState({
        icon: '🧩', title: '还没有安装模组',
        text: '把 .jar 模组文件拖到上方虚线框里，或点击下面的按钮从社区下载。',
        actionsHtml: '<button class="btn primary" id="m-empty-search">在线搜索安装</button>',
      });
      const b = $('#m-empty-search', listWrap);
      if (b) b.onclick = () => openSearch();
      return;
    }
    listWrap.innerHTML = mods.map((m) => `
      <div class="list-row" data-file="${escapeHtml(m.file || '')}">
        <div class="row-icon">${m.icon ? `<img class="row-img" src="${bbimg(m.icon)}" alt="">` : '🧩'}</div>
        <div class="col" style="gap:2px; flex:1; min-width:0">
          <div class="bold ellipsis" data-tip="${escapeHtml(m.name || m.file || '')}">${escapeHtml(m.name || m.file || '未命名模组')}</div>
          <div class="tiny muted-3 row" style="gap:8px">
            ${m.version ? `<span>v${escapeHtml(String(m.version))}</span>` : ''}
            ${m.loader && m.loader !== 'vanilla' ? loaderBadge(m.loader) : ''}
            ${m.enabled === false ? '<span class="badge warn">已禁用</span>' : ''}
          </div>
        </div>
        <label class="switch" data-tip="${m.enabled === false ? '已禁用，点击启用' : '已启用，点击禁用'}">
          <input type="checkbox" class="m-toggle" ${m.enabled === false ? '' : 'checked'}><span class="track"></span>
        </label>
        <button class="btn ghost sm m-del" data-tip="删除这个模组">🗑</button>
      </div>`).join('');
    listWrap.querySelectorAll('.list-row').forEach((row) => {
      const file = row.dataset.file;
      const mod = mods.find((x) => x.file === file);
      row.querySelector('.m-toggle').addEventListener('change', async (ev) => {
        const enabled = ev.target.checked;
        try {
          await api.mods.toggle({ instanceId: D.id, file, enabled });
          toast(enabled ? `已启用「${(mod && mod.name) || file}」` : `已禁用「${(mod && mod.name) || file}」`, 'ok');
        } catch (e) { ev.target.checked = !enabled; toast(zhErr(e), 'error', 5000); }
      });
      row.querySelector('.m-del').onclick = async () => {
        const ok = await confirmDialog('删除模组', `「${(mod && mod.name) || file}」会移入回收站，确定删除吗？`, { danger: true, okLabel: '删除' });
        if (!ok) return;
        try {
          await api.mods.remove({ instanceId: D.id, files: [file] });
          toast('已删除', 'ok');
          loadMods();
        } catch (e) { toast(zhErr(e), 'error', 5000); }
      };
    });
  };

  const addModFiles = async (paths) => {
    if (!paths || !paths.length) return;
    toast(`正在安装 ${paths.length} 个文件…`, 'info');
    try {
      const r = (await api.mods.addFiles({ instanceId: D.id, paths })) || {};
      const okCount = (r.installed || []).length;
      const failed = r.failed || [];
      if (okCount) toast(`成功安装 ${okCount} 个模组`, 'ok');
      for (const f of failed) toast(`${baseName(f.path)}：${f.message || '不是有效的模组文件'}`, 'error', 5000);
      if (!okCount && !failed.length) toast('没有识别出可以安装的模组', 'warn');
      loadMods();
      // 安装成功后做一次安装前预检（新增一次 API 调用，失败静默跳过）
      if (okCount) {
        const failedSet = new Set(failed.map((f) => f.path));
        const targets = paths.filter((p) => !failedSet.has(p));
        try {
          const warns = await api.modsdiag.precheck({ instanceId: D.id, paths: targets });
          if (Array.isArray(warns) && warns.length) showPrecheckWarns(warns);
        } catch { /* 预检失败静默跳过 */ }
      }
    } catch (e) { toast(zhErr(e), 'error', 5000); }
  };

  $('#m-add', box).onclick = async () => {
    try {
      const paths = await api.pick.files({ title: '选择模组文件', filters: [{ name: '模组文件', extensions: ['jar', 'zip', 'litemod'] }] });
      await addModFiles(paths);
    } catch (e) { toast(zhErr(e), 'error', 5000); }
  };
  $('#m-search', box).onclick = () => openSearch();
  $('#m-scan', box).onclick = () => openScan();
  $('#m-diag', box).onclick = () => openConflicts(D.id, loadMods);
  $('#m-classconf', box).onclick = () => openClassConflicts(D.id, loadMods);
  $('#m-loadorder', box).onclick = () => openLoadOrder(D.id);
  $('#m-graph', box).onclick = () => openDepsGraph(D.id);
  $('#m-updates', box).onclick = () => openUpdates(D.id, loadMods);
  wireDrop($('#m-drop', box), addModFiles);

  async function openScan() {
    let missing;
    try { missing = await api.mods.scanMissing({ instanceId: D.id }) || []; } catch (e) { toast(zhErr(e), 'error', 5000); return; }
    if (!missing.length) {
      await showDialog({ title: '检查完成', body: '<p>很好，没有发现缺失的前置模组。</p>' });
      return;
    }
    const go = await showDialog({
      title: `发现 ${missing.length} 个缺失的前置`,
      body: `<p>这些前置模组没有安装，可能导致游戏无法启动：</p>
        <div class="col mt-2">${missing.map((m) => `
          <div class="list-row">
            <div class="row-icon">🧩</div>
            <div class="col" style="flex:1; gap:2px">
              <div class="bold">${escapeHtml(m.name || '未知模组')}</div>
              ${m.reason ? `<div class="tiny muted-3">${escapeHtml(m.reason)}</div>` : ''}
            </div>
          </div>`).join('')}</div>`,
      actions: [{ label: '取消', value: false }, { label: '一键下载全部前置', value: true, primary: true }],
    });
    if (!go) return;
    const fails = [];
    let okCount = 0;
    for (let i = 0; i < missing.length; i += 1) {
      const m = missing[i];
      toast(`正在下载前置（${i + 1}/${missing.length}）：${m.name || ''}`, 'info');
      try {
        const payload = { query: m.name, source: 'modrinth', limit: 1 };
        if (gv) payload.gameVersion = gv;
        if (ld) payload.loader = ld;
        const rs = (await api.mods.search(payload)) || [];
        if (!rs.length) { fails.push(`${m.name}：没有搜索到匹配的模组`); continue; }
        const vs = (await api.mods.versions({ projectId: rs[0].projectId, gameVersion: gv || undefined, loader: ld || undefined })) || [];
        const v = pickVersion(vs, gv, ld);
        if (!v) { fails.push(`${m.name}：没有适配当前实例的版本`); continue; }
        await api.mods.install({ instanceId: D.id, projectId: rs[0].projectId, versionId: v.id });
        okCount += 1;
      } catch (e) { fails.push(`${m.name}：${zhErr(e)}`); }
    }
    if (okCount) toast(`已安装 ${okCount} 个前置模组`, 'ok');
    for (const f of fails) toast(f, 'error', 5000);
    loadMods();
  }

  function openSearch() {
    let source = 'modrinth';
    let showAll = false;
    showDialog({
      title: '在线搜索安装模组',
      wide: true,
      body: `
        <div class="row wrap mb-2" style="gap:10px">
          <input class="input" id="ms-q" placeholder="输入模组名称，例如：JEI、Create、钠" style="flex:1; min-width:180px">
          <select class="input sm" id="ms-source" style="width:auto">
            <option value="modrinth">Modrinth（简体中文优先）</option>
            <option value="curseforge">CurseForge</option>
          </select>
          <label class="row tiny" style="gap:6px; flex:none" data-tip="关闭时只显示适配当前实例的结果">
            <span class="switch"><input type="checkbox" id="ms-all"><span class="track"></span></span>显示所有版本
          </label>
        </div>
        <div class="tiny muted-3 mb-2">当前实例：${escapeHtml(gv || '未知版本')} · ${escapeHtml(loaderLabel(D.loader))}（默认只显示适配的结果）</div>
        <div id="ms-results"><div class="center muted small" style="padding:26px 0">输入关键词，按回车开始搜索</div></div>`,
      actions: [{ label: '关闭', value: true }],
      onMount(mask) {
        const q = $('#ms-q', mask);
        const src = $('#ms-source', mask);
        const all = $('#ms-all', mask);
        const resBox = $('#ms-results', mask);
        src.onchange = () => { source = src.value; };
        all.onchange = () => { showAll = all.checked; };
        const doSearch = async () => {
          const kw = q.value.trim();
          if (!kw) { toast('先输入要搜索的模组名称', 'warn'); return; }
          resBox.innerHTML = '<div class="col center" style="padding:26px 0; gap:10px"><div class="spinner"></div><div class="small muted">正在搜索…</div></div>';
          let results;
          try {
            const payload = { query: kw, source, limit: 20 };
            if (!showAll) {
              if (gv) payload.gameVersion = gv;
              if (ld) payload.loader = ld;
            }
            results = (await api.mods.search(payload)) || [];
          } catch (e) {
            showRetryable(resBox, `搜索失败：${zhErr(e)}`, doSearch);
            return;
          }
          if (!results.length) {
            resBox.innerHTML = `<div class="empty-state" style="padding:30px 10px"><div class="big">🔍</div>
              <div class="title">没有找到匹配的模组</div>
              <div class="small">没有找到匹配的模组。试试换一个关键词，或者检查"显示所有版本"是否关闭了。</div></div>`;
            return;
          }
          resBox.innerHTML = results.map((r, idx) => `
            <div class="list-row" data-idx="${idx}">
              <div class="row-icon">${r.iconUrl ? `<img class="row-img" src="${escapeHtml(r.iconUrl)}" alt="">` : '📦'}</div>
              <div class="col" style="gap:2px; flex:1; min-width:0">
                <div class="row" style="gap:8px">
                  <span class="bold ellipsis" data-tip="${escapeHtml(r.title || r.slug || '')}">${escapeHtml(r.title || r.slug || '未命名')}</span>
                  ${!showAll && Array.isArray(r.versions) && gv && r.versions.includes(gv) ? `<span class="badge ok">${escapeHtml(gv)}</span>` : ''}
                </div>
                <div class="tiny muted-3">${escapeHtml(r.author || '未知作者')} · ${fmtNum(r.downloads)} 次下载</div>
              </div>
              <button class="btn sm primary ms-install">安装</button>
            </div>`).join('');
          resBox.querySelectorAll('.list-row').forEach((row) => {
            const r = results[Number(row.dataset.idx)];
            const btn = row.querySelector('.ms-install');
            btn.onclick = () => installFlow(r, btn);
          });
        };
        const installFlow = async (r, btn) => {
          btn.disabled = true; btn.textContent = '获取版本…';
          let v = null;
          try {
            const vs = (await api.mods.versions({ projectId: r.projectId, gameVersion: gv || undefined, loader: ld || undefined })) || [];
            v = pickVersion(vs, gv, ld);
          } catch (e) { toast(zhErr(e), 'error', 5000); }
          if (!v) {
            btn.disabled = false; btn.textContent = '安装';
            toast('没有找到适配当前版本的文件，可以打开「显示所有版本」再试', 'warn', 5000);
            return;
          }
          await doInstall(r, v, btn);
        };
        const doInstall = async (r, v, btn) => {
          btn.disabled = true; btn.textContent = '安装中…';
          let res;
          try {
            res = await api.mods.install({ instanceId: D.id, projectId: r.projectId, versionId: v.id });
          } catch (e) {
            const msg = zhErr(e);
            if (msg.includes('中断')) {
              const go = await showDialog({
                title: '下载中断了',
                body: `<p>${escapeHtml(msg)}</p><p class="mt-2">已下载的部分还在，点击「继续下载」可以从断点继续。</p>`,
                actions: [{ label: '稍后再说', value: false }, { label: '继续下载', value: true, primary: true }],
              });
              if (go) return doInstall(r, v, btn);
              btn.disabled = false; btn.textContent = '继续下载';
              btn.onclick = () => doInstall(r, v, btn);
              return;
            }
            toast(msg, 'error', 5000);
            btn.disabled = false; btn.textContent = '安装';
            return;
          }
          if (res && Array.isArray(res.needsDeps) && res.needsDeps.length) {
            await offerDeps(r, v, res.needsDeps, btn);
            return;
          }
          finishInstall(res, btn);
        };
        const offerDeps = async (r, v, deps, btn) => {
          const norm = deps.map((d) => (typeof d === 'string'
            ? { key: d, label: d }
            : { key: d.projectId || d.slug || d.id || '', label: d.title || d.name || d.slug || d.projectId || String(d.id || d) }));
          const go = await showDialog({
            title: '需要一并安装的前置模组',
            body: `<p>「${escapeHtml(r.title || r.slug || '这个模组')}」需要下面的前置模组才能正常运行：</p>
              <div class="col mt-2">${norm.map((d) => `
                <div class="list-row"><div class="row-icon">🧩</div><div class="bold">${escapeHtml(d.label)}</div></div>`).join('')}</div>
              <p class="small muted mt-2">点击「全部安装」，启动器会把这些前置和主模组一起装好。</p>`,
            actions: [{ label: '取消', value: false }, { label: '全部安装', value: true, primary: true }],
          });
          if (!go) { btn.disabled = false; btn.textContent = '安装'; return; }
          btn.disabled = true; btn.textContent = '安装前置中…';
          const depIds = norm.map((d) => d.key).filter(Boolean);
          let res;
          try {
            try {
              res = await api.mods.install({ instanceId: D.id, projectId: r.projectId, versionId: v.id, extraVersionIds: depIds });
            } catch {
              res = await installDepsThenMain(depIds, r, v);
            }
            finishInstall(res, btn);
          } catch (e) {
            toast(zhErr(e), 'error', 5000);
            btn.disabled = false; btn.textContent = '安装';
          }
        };
        const installDepsThenMain = async (depIds, r, v) => {
          let i = 0;
          for (const depId of depIds) {
            i += 1;
            toast(`正在安装前置（${i}/${depIds.length}）…`, 'info');
            try {
              const vs = (await api.mods.versions({ projectId: depId, gameVersion: gv || undefined, loader: ld || undefined })) || [];
              const dv = pickVersion(vs, gv, ld);
              if (dv) await api.mods.install({ instanceId: D.id, projectId: depId, versionId: dv.id });
            } catch { /* 单个前置失败继续装其余的 */ }
          }
          toast('前置处理完成，继续安装主模组…', 'info');
          return api.mods.install({ instanceId: D.id, projectId: r.projectId, versionId: v.id });
        };
        const finishInstall = (res, btn) => {
          btn.disabled = true; btn.textContent = '已安装';
          const warns = res && Array.isArray(res.warnings) ? res.warnings : [];
          const after = () => { toast('模组安装完成', 'ok'); loadMods(); };
          if (warns.length) {
            showDialog({
              title: '兼容性提示',
              body: `<p>这个模组标注的适配信息和当前实例不完全一致：</p>
                <div class="col mt-2">${warns.map((w) => `
                  <div class="list-row"><div class="row-icon">⚠️</div><div class="small">${escapeHtml(String(w))}</div></div>`).join('')}</div>
                <p class="mt-2 small muted">要继续吗？也可以稍后在模组列表里禁用或删除它。</p>`,
              actions: [{ label: '取消', value: false }, { label: '继续', value: true, primary: true }],
            }).then((go) => {
              if (go) after();
              else { toast('已安装。如果游戏运行异常，可以在模组列表里禁用它。', 'info', 5000); loadMods(); }
            });
          } else after();
        };
        q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });
      },
    });
  }
  await loadMods();
}

/* ---------- 存档标签 ---------- */
async function worldsTab(box) {
  box.innerHTML = `
    <div class="row wrap mb-3">
      <button class="btn" id="w-import">📁 导入存档文件</button>
      <button class="btn" id="w-import-dir">🗂 导入存档文件夹</button>
      <div class="spacer"></div>
      <span class="tiny muted-3">支持 .zip 压缩包或整个存档文件夹</span>
    </div>
    <div class="dropzone mb-3" id="w-drop">把存档文件夹或 .zip 压缩包拖到这里导入</div>
    <div id="w-list"></div>`;
  setDropText(`松手后将导入到「${D.name}」的「存档」中`);
  const listWrap = $('#w-list', box);

  const loadWorlds = async () => {
    listWrap.innerHTML = `<div class="grid auto">${'<div class="skeleton skl-card"></div>'.repeat(4)}</div>`;
    let worlds;
    try { worlds = await api.worlds.list({ instanceId: D.id }) || []; } catch (e) {
      showRetryable(listWrap, `存档列表加载失败：${zhErr(e)}`, loadWorlds);
      return;
    }
    if (!worlds.length) {
      listWrap.innerHTML = emptyState({
        icon: '🌍', title: '还没有存档',
        text: '在游戏里创建一个世界，或把存档文件夹/zip 拖到这里。',
        actionsHtml: '<button class="btn primary" id="w-empty-import">导入存档</button>',
      });
      const b = $('#w-empty-import', listWrap);
      if (b) b.onclick = () => { const t = $('#w-import', box); if (t) t.click(); };
      return;
    }
    listWrap.innerHTML = `<div class="grid auto">${worlds.map((w) => `
      <div class="card world-card" data-dir="${escapeHtml(w.dir || '')}">
        <div class="world-cover">${w.icon ? `<img src="${bbimg(w.icon)}" alt="">` : '<span>🌍</span>'}</div>
        <div class="col mt-2" style="gap:5px">
          <div class="bold ellipsis" data-tip="${escapeHtml(w.name || w.dir || '')}">${escapeHtml(w.name || w.dir || '未命名存档')}</div>
          <div class="row wrap" style="gap:6px">
            ${w.version ? `<span class="badge">${escapeHtml(String(w.version))}</span>` : ''}
            <span class="tiny muted-3">${fmtTime(w.lastPlayed)}</span>
          </div>
          <div class="row mt-1" style="gap:6px">
            <button class="btn sm w-export">导出</button>
            <button class="btn sm danger w-del">删除</button>
          </div>
        </div>
      </div>`).join('')}</div>`;
    listWrap.querySelectorAll('.world-card').forEach((card) => {
      const w = worlds.find((x) => (x.dir || '') === card.dataset.dir) || {};
      card.querySelector('.w-export').onclick = async () => {
        let dest;
        try {
          dest = await api.pick.save({ title: '导出存档', defaultName: `${w.name || w.dir || 'world'}.zip`, filters: [{ name: 'Zip 压缩包', extensions: ['zip'] }] });
        } catch (e) { toast(zhErr(e), 'error'); return; }
        if (!dest) return;
        try { await api.worlds.export({ instanceId: D.id, worldDir: w.dir, destZip: dest }); toast('存档已导出', 'ok'); } catch (e) { toast(zhErr(e), 'error', 5000); }
      };
      card.querySelector('.w-del').onclick = async () => {
        const ok = await confirmDialog('删除存档', `「${w.name || w.dir}」会移入回收站，确定删除吗？`, { danger: true, okLabel: '删除' });
        if (!ok) return;
        try {
          await api.worlds.remove({ instanceId: D.id, worldDir: w.dir });
          toast('存档已删除', 'ok');
          loadWorlds();
        } catch (e) { toast(zhErr(e), 'error', 5000); }
      };
    });
  };

  const importWorlds = async (paths) => {
    if (!paths || !paths.length) return;
    toast(`正在导入 ${paths.length} 个存档…`, 'info');
    try {
      const r = (await api.worlds.importFiles({ instanceId: D.id, paths })) || {};
      const okCount = (r.imported || []).length;
      const failed = r.failed || [];
      if (okCount) toast(`成功导入 ${okCount} 个存档`, 'ok');
      for (const f of failed) toast(`${baseName(f.path)}：${f.message || '导入失败，请确认这是有效的存档'}`, 'error', 5000);
      if (!okCount && !failed.length) toast('没有识别出可以导入的存档', 'warn');
      loadWorlds();
    } catch (e) { toast(zhErr(e), 'error', 5000); }
  };
  $('#w-import', box).onclick = async () => {
    try {
      const p = await api.pick.files({ title: '选择存档压缩包', filters: [{ name: '存档压缩包', extensions: ['zip'] }] });
      await importWorlds(p);
    } catch (e) { toast(zhErr(e), 'error', 5000); }
  };
  $('#w-import-dir', box).onclick = async () => {
    try {
      const p = await api.pick.dir({ title: '选择存档文件夹' });
      if (p) await importWorlds([p]);
    } catch (e) { toast(zhErr(e), 'error', 5000); }
  };
  wireDrop($('#w-drop', box), importWorlds);
  await loadWorlds();
}

/* ---------- 资源包 / 光影包标签 ---------- */
async function packsTab(box, kind, label, emoji) {
  let items = [];
  box.innerHTML = `
    <div class="row wrap mb-3">
      <button class="btn" id="p-add">📥 添加${label}</button>
      <div class="spacer"></div>
      <span class="tiny muted-3">靠上的优先加载，可用 ▲▼ 调整顺序</span>
    </div>
    <div class="dropzone mb-3" id="p-drop">把 .zip ${label}文件拖到这里</div>
    <div id="p-list"></div>`;
  setDropText(`松手后将安装到「${D.name}」的「${label}」中`);
  const listWrap = $('#p-list', box);

  const loadPacks = async () => {
    listWrap.innerHTML = skeletonRows(3);
    try { items = await api.packs.list({ instanceId: D.id, kind }) || []; } catch (e) {
      showRetryable(listWrap, `${label}列表加载失败：${zhErr(e)}`, loadPacks);
      return;
    }
    if (!items.length) {
      listWrap.innerHTML = emptyState({
        icon: emoji, title: `还没有${label}`,
        text: `把 .zip ${label}文件拖到上方虚线框，或点击下面的按钮选择文件。`,
        actionsHtml: `<button class="btn primary" id="p-empty-add">添加${label}</button>`,
      });
      const b = $('#p-empty-add', listWrap);
      if (b) b.onclick = () => pickAdd();
      return;
    }
    listWrap.innerHTML = items.map((p, idx) => `
      <div class="list-row" data-idx="${idx}">
        <div class="row-icon">${emoji}</div>
        <div class="col" style="gap:2px; flex:1; min-width:0">
          <div class="bold ellipsis" data-tip="${escapeHtml(p.file || '')}">${escapeHtml(baseName(p.file))}</div>
          <div class="tiny muted-3">${fmtSize(p.size)}${p.enabled === false ? ' · 已禁用' : ''}</div>
        </div>
        <button class="btn ghost sm p-up" data-tip="上移（靠上的优先加载）">▲</button>
        <button class="btn ghost sm p-down" data-tip="下移">▼</button>
        <label class="switch"><input type="checkbox" class="p-toggle" ${p.enabled === false ? '' : 'checked'}><span class="track"></span></label>
        <button class="btn ghost sm p-del" data-tip="删除">🗑</button>
      </div>`).join('');
    listWrap.querySelectorAll('.list-row').forEach((row) => {
      const idx = Number(row.dataset.idx);
      const item = items[idx] || {};
      row.querySelector('.p-up').onclick = () => move(idx, -1);
      row.querySelector('.p-down').onclick = () => move(idx, 1);
      row.querySelector('.p-toggle').addEventListener('change', async (ev) => {
        const enabled = ev.target.checked;
        try {
          await api.packs.toggle({ instanceId: D.id, kind, file: item.file, enabled });
          toast(enabled ? '已启用' : '已禁用', 'ok');
        } catch (e) { ev.target.checked = !enabled; toast(zhErr(e), 'error', 5000); }
      });
      row.querySelector('.p-del').onclick = async () => {
        const ok = await confirmDialog(`删除${label}`, `「${baseName(item.file)}」会移入回收站，确定删除吗？`, { danger: true, okLabel: '删除' });
        if (!ok) return;
        try {
          await api.packs.remove({ instanceId: D.id, kind, file: item.file });
          toast('已删除', 'ok');
          loadPacks();
        } catch (e) { toast(zhErr(e), 'error', 5000); }
      };
    });
  };
  const move = async (idx, dir) => {
    const order = items.map((x) => x.file);
    const j = idx + dir;
    if (j < 0 || j >= order.length) return;
    [order[idx], order[j]] = [order[j], order[idx]];
    try {
      await api.packs.reorder({ instanceId: D.id, kind, files: order });
      toast('顺序已更新', 'ok');
      loadPacks();
    } catch (e) { toast(zhErr(e), 'error', 5000); }
  };
  const addPacks = async (paths) => {
    if (!paths || !paths.length) return;
    try {
      await api.packs.addFiles({ instanceId: D.id, kind, paths });
      toast(`已添加 ${paths.length} 个文件`, 'ok');
      loadPacks();
    } catch (e) { toast(zhErr(e), 'error', 5000); }
  };
  const pickAdd = async () => {
    try {
      const p = await api.pick.files({ title: `选择${label}文件`, filters: [{ name: label, extensions: ['zip'] }] });
      await addPacks(p);
    } catch (e) { toast(zhErr(e), 'error', 5000); }
  };
  $('#p-add', box).onclick = pickAdd;
  wireDrop($('#p-drop', box), addPacks);
  await loadPacks();
}

async function shadersTab(box) {
  let det = null;
  try { det = await api.shaders.detect({ instanceId: D.id }) || null; } catch { /* 检测失败时仍然显示列表 */ }
  box.innerHTML = `
    ${det && det.loader == null ? `
    <div class="card mb-3 warn-card">
      <div class="row wrap">
        <span>⚠️</span>
        <div class="col" style="flex:1; min-width:200px; gap:2px">
          <div class="bold">使用光影需要先安装 Iris 或 OptiFine，要现在安装吗？</div>
          ${det.suggestion ? `<div class="tiny muted">${escapeHtml(det.suggestion)}</div>` : ''}
        </div>
        <button class="btn primary" id="sh-iris">一键安装 Iris</button>
      </div>
    </div>` : ''}
    <div id="sh-packs"></div>`;
  setDropText(`松手后将安装到「${D.name}」的「光影包」中`);
  if (det && det.loader == null) {
    const btn = $('#sh-iris', box);
    btn.onclick = async () => {
      btn.disabled = true; btn.textContent = '安装中…';
      try {
        await api.shaders.install({ instanceId: D.id });
        toast('Iris 安装完成，现在可以添加光影包了', 'ok');
        await shadersTab(box);
      } catch (e) {
        btn.disabled = false; btn.textContent = '一键安装 Iris';
        toast(`${zhErr(e)}。你也可以在「模组 → 在线搜索安装」里手动下载 Iris。`, 'warn', 6000);
      }
    };
  }
  const sub2 = document.createElement('div');
  $('#sh-packs', box).appendChild(sub2);
  await packsTab(sub2, 'shaderpacks', '光影包', '✨');
}

/* ---------- 备份标签 ---------- */
async function backupsTab(box) {
  box.innerHTML = `
    <div class="card mb-3">
      <div class="row wrap">
        <div class="col" style="flex:1; min-width:220px; gap:2px">
          <div class="bold">自动备份</div>
          <div class="small muted">每次启动前自动创建轻量备份（仅配置），每 7 天自动创建一次完整备份。</div>
        </div>
        <button class="btn primary" id="bk-new">💾 立即备份</button>
      </div>
    </div>
    <div id="bk-list"></div>`;
  setDropText('松开鼠标，启动器会自动识别文件类型');
  const listWrap = $('#bk-list', box);

  const loadBackups = async () => {
    listWrap.innerHTML = skeletonRows(3);
    let items;
    try { items = await api.backups.list({ instanceId: D.id }) || []; } catch (e) {
      showRetryable(listWrap, `备份列表加载失败：${zhErr(e)}`, loadBackups);
      return;
    }
    if (!items.length) {
      listWrap.innerHTML = emptyState({
        icon: '🛟', title: '还没有备份',
        text: '点击「立即备份」创建第一个备份，启动游戏前也会自动创建。',
        actionsHtml: '<button class="btn primary" id="bk-empty-new">立即备份</button>',
      });
      const b = $('#bk-empty-new', listWrap);
      if (b) b.onclick = () => openNewBackup(loadBackups);
      return;
    }
    listWrap.innerHTML = items.map((b, idx) => `
      <div class="list-row" data-idx="${idx}">
        <div class="row-icon">🛟</div>
        <div class="col" style="gap:2px; flex:1; min-width:0">
          <div class="row" style="gap:8px">
            <span class="bold ellipsis" data-tip="${escapeHtml(b.name || b.file || '')}">${escapeHtml(b.name || b.file || '备份')}</span>
            <span class="badge ${b.kind === 'full' ? 'accent' : ''}">${b.kind === 'full' ? '完整' : '轻量'}</span>
          </div>
          <div class="tiny muted-3">${fmtTime(b.time)} · ${fmtSize(b.size)}</div>
        </div>
        <button class="btn sm bk-restore">恢复</button>
        <button class="btn sm danger bk-del">删除</button>
      </div>`).join('');
    listWrap.querySelectorAll('.list-row').forEach((row) => {
      const b = items[Number(row.dataset.idx)] || {};
      row.querySelector('.bk-restore').onclick = async () => {
        const ok = await confirmDialog('恢复备份', `恢复会覆盖当前模组、存档和配置，当前状态会先自动备份一份。确定恢复「${b.name || b.file}」吗？`, { danger: true, okLabel: '恢复' });
        if (!ok) return;
        try {
          await api.backups.restore({ instanceId: D.id, file: b.file });
          toast('备份已恢复，重新启动游戏后生效', 'ok');
          loadBackups();
        } catch (e) { toast(zhErr(e), 'error', 5000); }
      };
      row.querySelector('.bk-del').onclick = async () => {
        const ok = await confirmDialog('删除备份', `「${b.name || b.file}」删除后无法恢复，确定删除吗？`, { danger: true, okLabel: '删除' });
        if (!ok) return;
        try {
          await api.backups.remove({ instanceId: D.id, file: b.file });
          toast('备份已删除', 'ok');
          loadBackups();
        } catch (e) { toast(zhErr(e), 'error', 5000); }
      };
    });
  };
  $('#bk-new', box).onclick = () => openNewBackup(loadBackups);
  await loadBackups();
}

async function openNewBackup(done) {
  let kind = 'full';
  await showDialog({
    title: '创建备份',
    body: `
      <label class="field"><span class="field-label">备份名称（可选，留空自动命名）</span><input class="input" id="bk-name" placeholder="例如：装整合包之前"></label>
      <div class="field"><span class="field-label">备份类型</span>
        <div class="row" style="gap:8px">
          <button class="loader-pill active" data-k="full">完整备份</button>
          <button class="loader-pill" data-k="light">轻量备份</button>
        </div>
        <div class="field-hint">完整备份包含模组、存档和配置；轻量备份只备份配置，速度更快、占用更小。</div>
      </div>`,
    actions: [{ label: '取消', value: false }, { label: '开始备份', value: true, primary: true }],
    onMount(mask, close) {
      mask.querySelectorAll('.loader-pill').forEach((p) => {
        p.onclick = () => {
          kind = p.dataset.k;
          mask.querySelectorAll('.loader-pill').forEach((x) => x.classList.toggle('active', x === p));
        };
      });
      const okBtn = $('.dialog-actions .btn.primary', mask);
      if (okBtn) okBtn.onclick = async () => {
        const nameVal = $('#bk-name', mask).value.trim();
        okBtn.disabled = true; okBtn.textContent = '备份中…';
        try {
          await api.backups.create({ instanceId: D.id, name: nameVal || undefined, kind });
          toast('备份完成', 'ok');
          close(true);
          if (done) done();
        } catch (e) {
          okBtn.disabled = false; okBtn.textContent = '开始备份';
          toast(zhErr(e), 'error', 5000);
        }
      };
    },
  });
}

/* ---------- 导出 .mcinstance / 从其他启动器导入 ---------- */
async function exportInstanceFlow(instanceId, instName) {
  let includeMods = false;
  const go = await showDialog({
    title: '导出 .mcinstance',
    body: `
      <p class="small" style="margin-top:0">把当前实例导出为方块盒子的 .mcinstance 文件，其他玩家双击或在启动器里选择它，就能还原出一个一样的实例。</p>
      <label class="row" style="gap:10px; cursor:pointer; width:fit-content">
        <span class="switch"><input type="checkbox" id="ex-mods"><span class="track"></span></span>
        <span class="small bold">包含模组文件</span>
      </label>
      <div class="field-hint">默认不包含模组（只导出配置与记录），勾选后文件会大很多；分享前请确认模组作者允许再分发。</div>`,
    actions: [{ label: '取消', value: false }, { label: '选择保存位置', value: true, primary: true }],
    onMount(mask) {
      const cb = mask.querySelector('#ex-mods');
      if (cb) cb.addEventListener('change', () => { includeMods = cb.checked; });
    },
  });
  if (!go) return;
  let dest = null;
  try {
    dest = await api.pick.save({
      title: '导出实例',
      defaultName: `${instName || '我的实例'}.mcinstance`,
      filters: [{ name: '方块盒子实例包', extensions: ['mcinstance'] }],
    });
  } catch (e) { toast(zhErr(e), 'error', 5000); return; }
  if (!dest) return;
  toast('正在导出实例，文件较大时需要一点时间…', 'info', 5000);
  try {
    const r = await api.export.mcinstance({ instanceId, dest, includeMods });
    toast(String((r && (r.estimateNote || r.message)) || '导出完成，可以把文件分享给朋友了'), 'ok', 6000);
  } catch (e) { toast(`导出失败：${zhErr(e)}`, 'error', 6000); }
}

async function migrateFromLauncherFlow(instanceId) {
  let dir = null;
  try { dir = await api.pick.dir({ title: '选择其他启动器的实例文件夹' }); }
  catch (e) { toast(zhErr(e), 'error', 5000); return; }
  if (!dir) return;
  await showDialog({
    title: '从其他启动器导入',
    wide: true,
    body: `<div class="col center" style="padding:30px 0; gap:10px"><div class="spinner"></div><div class="small muted">正在扫描所选文件夹里的实例，文件多时需要一点时间…</div></div>`,
    actions: [{ label: '关闭', value: true }],
    onMount: async (mask) => {
      const body = $('.dialog-body', mask);
      let r;
      try { r = await api.migrate.crossLauncher({ srcDir: dir, instanceId }); } catch (e) {
        body.innerHTML = emptyState({ icon: '📥', title: '扫描没有完成', text: zhErr(e), actionsHtml: '<button class="btn primary mg-retry">重试</button>' });
        const b = body.querySelector('.mg-retry');
        if (b) b.onclick = () => migrateFromLauncherFlow(instanceId);
        return;
      }
      const found = Array.isArray(r && r.found) ? r.found : [];
      const foundLabel = (f) => {
        if (typeof f === 'string') return f;
        if (f && typeof f === 'object') {
          return [f.name || f.instanceName, f.versionId || f.version, loaderLabel(f.loader)]
            .filter(Boolean).join(' · ') || '未知实例';
        }
        return '未知实例';
      };
      const report = r ? r.report : null;
      let reportHtml = '';
      if (Array.isArray(report) && report.length) {
        reportHtml = report.map((x) => `<div class="small">· ${escapeHtml(typeof x === 'string' ? x : JSON.stringify(x))}</div>`).join('');
      } else if (report && typeof report === 'object') {
        reportHtml = `<div class="small">${escapeHtml(String(report.message || report.text || JSON.stringify(report)))}</div>`;
      } else if (report) {
        reportHtml = `<div class="small">${escapeHtml(String(report))}</div>`;
      }
      body.innerHTML = `
        <div class="tiny muted-3 ellipsis mb-2" data-tip="${escapeHtml(dir)}">已扫描：${escapeHtml(dir)}</div>
        ${found.length ? `
          <div class="row wrap" style="gap:8px"><span class="badge accent">找到 ${found.length} 个实例</span></div>
          <div class="col mt-2">${found.map((f) => `
            <div class="list-row">
              <div class="row-icon">🗂️</div>
              <div class="small bold" style="flex:1; min-width:0">${escapeHtml(foundLabel(f))}</div>
              ${f && typeof f === 'object' && f.imported != null ? `<span class="badge ${f.imported ? 'ok' : ''}">${f.imported ? '已导入' : '未导入'}</span>` : ''}
            </div>`).join('')}</div>`
          : '<div class="small muted mt-2">没有在这个文件夹里认出可以导入的实例。请确认选择的是 HMCL、PCL 等启动器的实例目录（.minecraft 或 versions 文件夹所在位置）。</div>'}
        ${reportHtml ? `<div class="card mt-3" style="padding:10px 12px"><div class="bold small">处理结果</div><div class="col mt-1">${reportHtml}</div></div>` : ''}
        ${r && r.note ? `<div class="tiny muted-3 mt-2">${escapeHtml(String(r.note))}</div>` : ''}`;
    },
  });
}

/* ---------- 页面对象导出 ---------- */
const instancesPage = {
  id: 'instances',
  title: '实例',
  icon: '🗂️',
  routes: ['/instances'],
  order: 2,
  async render(el, ctx) {
    SETTINGS = (ctx && ctx.settings) || SETTINGS;
    // main.mjs 的前缀匹配会把 /instances/<id> 落到本页（routes '/instances'），此时直接渲染详情
    if (ctx && ctx.params && ctx.params.length) return renderDetail(el, ctx);
    return renderList(el, ctx);
  },
};

const instanceDetailPage = {
  id: 'instance-detail',
  title: '实例详情',
  icon: '🗂️',
  routes: ['/instances/'],
  hiddenNav: true,
  async render(el, ctx) {
    SETTINGS = (ctx && ctx.settings) || SETTINGS;
    if (!ctx || !ctx.params || !ctx.params.length) {
      // #/instances/ 不带 id，回到列表
      location.hash = '/instances';
      return;
    }
    return renderDetail(el, ctx);
  },
};

export default [instancesPage, instanceDetailPage];
