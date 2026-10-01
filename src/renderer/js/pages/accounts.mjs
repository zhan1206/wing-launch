// 账户页：离线 / 微软正版 / 皮肤站账户管理
import { api, on } from '../api.js';
import { toast, confirmDialog, showDialog, emptyState, skeletonRows, setBreadcrumb, escapeHtml } from '../ui.js';

let cleanups = [];
function addCleanup(fn) { cleanups.push(fn); }
function runCleanups() { for (const f of cleanups) { try { f(); } catch { /* 忽略 */ } } cleanups = []; }
function sub(ch, cb) { try { const off = on(ch, cb); if (typeof off === 'function') addCleanup(off); } catch { /* 忽略 */ } }

const TYPE_LABEL = { offline: '离线', microsoft: '微软正版', yggdrasil: '皮肤站' };

function errMsg(e) { const m = e && e.message ? String(e.message) : String(e || ''); return m || '未知错误'; }

async function copyText(text) {
  try { await api.clip.write(text); return true; }
  catch { try { await navigator.clipboard.writeText(text); return true; } catch { return false; } }
}

function ensureStyle() {
  if (document.getElementById('acc-style')) return;
  const s = document.createElement('style');
  s.id = 'acc-style';
  s.textContent = `
    .acc-head { width: 40px; height: 40px; border-radius: 9px; background: var(--card-2); display: grid; place-items: center; font-size: 17px; font-weight: 700; color: var(--fg-2); overflow: hidden; flex: 0 0 auto; }
    .acc-head img { width: 100%; height: 100%; image-rendering: pixelated; }
    .acc-row.current { background: color-mix(in srgb, var(--accent) 8%, transparent); border-color: color-mix(in srgb, var(--accent) 35%, transparent); }
    .add-tile { display: flex; gap: 12px; align-items: flex-start; width: 100%; text-align: left; font: inherit; color: inherit; }
    .add-tile .tile-icon { font-size: 26px; line-height: 1.2; }
    .ms-code { font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 30px; letter-spacing: 4px; font-weight: 700; color: var(--accent); background: var(--card-2); border-radius: 10px; padding: 10px 18px; text-align: center; user-select: all; }
  `;
  document.head.appendChild(s);
}

export default {
  id: 'accounts',
  title: '账户',
  icon: '👤',
  routes: ['/accounts'],
  order: 4,
  async render(el) {
    runCleanups();
    ensureStyle();
    setBreadcrumb([{ label: '主页', onClick() { location.hash = '/'; } }, { label: '账户' }]);
    el.innerHTML = `
      <div class="row mb-3">
        <div>
          <div class="section-title" style="margin:0">账户</div>
          <div class="small muted mt-1">支持离线、微软正版和第三方皮肤站账户，启动游戏时使用「当前使用」的账户。</div>
        </div>
        <div class="spacer"></div>
        <button class="btn primary" id="acc-add-btn">＋ 添加账户</button>
      </div>
      <div id="acc-list"></div>`;
    const listEl = el.querySelector('#acc-list');
    let accountsCache = [];

    async function load() {
      listEl.innerHTML = skeletonRows(3);
      let accounts = [], currentId = null, listErr = null;
      try {
        const res = await Promise.all([api.accounts.list(), api.accounts.currentId().catch(() => null)]);
        accounts = Array.isArray(res[0]) ? res[0] : [];
        currentId = res[1];
      } catch (e) { listErr = errMsg(e); }
      if (listErr) {
        listEl.innerHTML = `<div class="empty-state"><div class="big">⚠️</div><div class="title">账户列表加载失败</div>
          <div class="small">${escapeHtml(listErr)}</div>
          <div class="mt-3"><button class="btn" id="acc-retry">重试</button></div></div>`;
        const r = listEl.querySelector('#acc-retry');
        if (r) r.onclick = load;
        return;
      }
      accountsCache = accounts;
      if (!accounts.length) {
        listEl.innerHTML = emptyState({
          icon: '👤',
          title: '还没有账户。',
          text: '添加一个离线账户只要 10 秒。',
          actionsHtml: '<button class="btn primary" id="acc-empty-add">＋ 添加账户</button>',
        });
        listEl.querySelector('#acc-empty-add').onclick = openAddDialog;
        return;
      }
      listEl.innerHTML = accounts.map((a) => rowHtml(a, currentId)).join('');
    }

    function rowHtml(a, currentId) {
      const isCur = String(a.id) === String(currentId);
      const typeText = (TYPE_LABEL[a.type] || a.type || '未知') + (a.type === 'yggdrasil' && a.serverName ? ' · ' + a.serverName : '');
      const typeBadge = `<span class="badge ${a.type === 'microsoft' ? 'accent' : a.type === 'yggdrasil' ? 'ok' : ''}">${escapeHtml(typeText)}</span>`;
      const sub = a.displayName && a.displayName !== a.name
        ? `<div class="small muted">显示名：${escapeHtml(a.displayName)}</div>` : '';
      const head = a.headUrl
        ? `<div class="acc-head"><img src="${escapeHtml(a.headUrl)}" alt=""></div>`
        : `<div class="acc-head">${escapeHtml(String(a.name || '？').slice(0, 1).toUpperCase())}</div>`;
      return `<div class="list-row acc-row ${isCur ? 'current' : ''}" data-id="${escapeHtml(a.id)}">
        ${head}
        <div class="col" style="gap:2px;min-width:0">
          <div class="row" style="gap:8px">
            <span class="bold ellipsis">${escapeHtml(a.name || '未命名账户')}</span>
            ${typeBadge}
            ${isCur ? '<span class="badge accent">当前使用</span>' : ''}
          </div>
          ${sub}
        </div>
        <div class="spacer"></div>
        ${isCur ? '' : '<button class="btn sm" data-act="switch">切换为当前</button>'}
        <button class="btn sm ghost" data-act="rename">改名</button>
        <button class="btn sm ghost danger" data-act="del">删除</button>
      </div>`;
    }

    listEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const row = btn.closest('[data-id]');
      const acc = accountsCache.find((a) => String(a.id) === String(row && row.dataset.id));
      if (!acc) return;
      if (btn.dataset.act === 'switch') switchTo(acc);
      else if (btn.dataset.act === 'rename') renameAcc(acc);
      else if (btn.dataset.act === 'del') removeAcc(acc);
    });

    async function switchTo(acc) {
      try {
        await api.accounts.setCurrent(acc.id);
        toast(`已切换为当前账户：${acc.name}`, 'ok');
        load();
      } catch (e) { toast(`切换失败：${errMsg(e)}`, 'error'); }
    }

    async function renameAcc(acc) {
      let inp = null;
      const v = await showDialog({
        title: '修改显示名',
        body: `<label class="field"><span class="field-label">显示名</span>
            <input class="input" id="rn-inp" maxlength="32" value="${escapeHtml(acc.displayName || acc.name || '')}"></label>
          <div class="field-hint">仅在本启动器内显示，不影响游戏内昵称。</div>`,
        actions: [{ label: '取消', value: false }, { label: '保存', value: true, primary: true }],
        onMount(mask) { inp = mask.querySelector('#rn-inp'); if (inp) { inp.focus(); inp.select(); } },
      });
      if (!v || !inp) return;
      const val = inp.value.trim();
      if (!val) { toast('显示名不能为空', 'warn'); return; }
      if (val === (acc.displayName || '')) return;
      try {
        await api.accounts.setDisplayName(acc.id, val);
        toast('显示名已更新', 'ok');
        load();
      } catch (e) { toast(`修改失败：${errMsg(e)}`, 'error'); }
    }

    async function removeAcc(acc) {
      const ok = await confirmDialog('删除账户', `确定删除账户「${acc.name}」吗？删除后重新添加需要再次登录。`, { danger: true, okLabel: '删除' });
      if (!ok) return;
      try {
        await api.accounts.remove(acc.id);
        toast(`账户「${acc.name}」已删除`, 'ok');
        load();
      } catch (e) { toast(`删除失败：${errMsg(e)}`, 'error'); }
    }

    function openAddDialog() {
      let stopped = false;
      let epoch = 0;
      const timers = new Set();
      function later(fn, ms, myEpoch) {
        const t = setTimeout(() => { timers.delete(t); if (!stopped && epoch === myEpoch) fn(); }, ms);
        timers.add(t);
      }
      function clearTimers() { for (const t of timers) clearTimeout(t); timers.clear(); }
      showDialog({
        title: '添加账户',
        body: '<div id="acc-add-host"></div>',
        actions: [],
        onMount(mask, close) {
          const host = mask.querySelector('#acc-add-host');
          const obs = new MutationObserver(() => {
            if (!mask.isConnected) { stopped = true; clearTimers(); obs.disconnect(); }
          });
          obs.observe(document.getElementById('modal-holder'), { childList: true });
          addCleanup(() => { stopped = true; clearTimers(); obs.disconnect(); });

          function showMenu() {
            epoch++; clearTimers();
            host.innerHTML = `
              <div class="col" style="gap:10px">
                <button class="card hoverable add-tile" data-t="offline">
                  <span class="tile-icon">🎮</span>
                  <span class="col" style="gap:2px;text-align:left;min-width:0">
                    <span class="bold">离线账户</span>
                    <span class="small muted">最简单，输入昵称即可，无需任何验证</span>
                  </span>
                </button>
                <button class="card hoverable add-tile" data-t="ms">
                  <span class="tile-icon">🪪</span>
                  <span class="col" style="gap:2px;text-align:left;min-width:0">
                    <span class="bold">微软正版账户</span>
                    <span class="small muted">用你的微软账号登录，可进入正版验证服务器</span>
                  </span>
                </button>
                <button class="card hoverable add-tile" data-t="ygg">
                  <span class="tile-icon">🌍</span>
                  <span class="col" style="gap:2px;text-align:left;min-width:0">
                    <span class="bold">第三方皮肤站账户</span>
                    <span class="small muted">LittleSkin、Ely.by 等正版验证皮肤站</span>
                  </span>
                </button>
              </div>`;
            host.querySelectorAll('[data-t]').forEach((b) => {
              b.onclick = () => {
                const t = b.dataset.t;
                if (t === 'offline') showOffline();
                else if (t === 'ms') showMs();
                else showYgg();
              };
            });
          }

          function showOffline() {
            epoch++; clearTimers();
            host.innerHTML = `
              <label class="field"><span class="field-label">游戏昵称</span>
                <input class="input" id="off-name" maxlength="16" placeholder="例如：Steve"></label>
              <div class="field-hint">4-16 个字符，进游戏后别人看到的就是这个名字。</div>
              <div class="row mt-4"><button class="btn ghost" id="off-back">返回</button><div class="spacer"></div><button class="btn primary" id="off-ok">创建账户</button></div>`;
            const inp = host.querySelector('#off-name');
            inp.focus();
            host.querySelector('#off-back').onclick = showMenu;
            const submit = async () => {
              const name = inp.value.trim();
              if (name.length < 4 || name.length > 16) { toast('昵称需要 4-16 个字符，改一下再试试', 'warn'); inp.focus(); return; }
              const btn = host.querySelector('#off-ok');
              btn.disabled = true; btn.textContent = '创建中…';
              try {
                const acc = await api.accounts.addOffline(name);
                stopped = true; clearTimers(); close(true);
                toast(`离线账户「${(acc && acc.name) || name}」已添加`, 'ok');
                load();
              } catch (e) {
                btn.disabled = false; btn.textContent = '创建账户';
                toast(errMsg(e), 'error');
              }
            };
            host.querySelector('#off-ok').onclick = submit;
            inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
          }

          function showMs() {
            epoch++; clearTimers();
            const my = epoch;
            host.innerHTML = `
              <div class="col" style="gap:12px">
                <div class="small muted">正在向微软请求登录码…</div>
                <div class="row" style="justify-content:center"><div class="spinner"></div></div>
              </div>`;
            (async () => {
              let r;
              try { r = await api.accounts.msStart(); } catch (e) {
                if (stopped || epoch !== my) return;
                host.innerHTML = `
                  <div class="small" style="color:var(--err)">没能开始微软登录：${escapeHtml(errMsg(e))}。检查网络后可以重试。</div>
                  <div class="row mt-3"><button class="btn ghost" id="ms-back">返回</button><div class="spacer"></div><button class="btn" id="ms-retry">重试</button></div>`;
                host.querySelector('#ms-back').onclick = showMenu;
                host.querySelector('#ms-retry').onclick = showMs;
                return;
              }
              if (stopped || epoch !== my) return;
              const url = escapeHtml(r.verifyUrl || '');
              host.innerHTML = `
                <div class="small muted">第一步：复制下面的登录码；第二步：打开授权页面并粘贴登录。全程在微软官方页面完成，启动器不会看到你的密码。</div>
                <div class="ms-code">${escapeHtml(r.userCode || '')}</div>
                <div class="row" style="justify-content:center;gap:8px">
                  <button class="btn" id="ms-copy">复制代码</button>
                  <a class="btn primary" href="${url}" target="_blank" rel="noopener noreferrer">打开授权页面</a>
                </div>
                <div class="small muted-3 center" style="user-select:all;word-break:break-all">${url}</div>
                <div class="row mt-2" id="ms-status" style="gap:8px"><div class="spinner sm"></div><span class="small muted">等待你在浏览器中完成授权…</span></div>
                <div class="row mt-2"><button class="btn ghost" id="ms-back">返回</button></div>`;
              host.querySelector('#ms-copy').onclick = async () => {
                (await copyText(r.userCode || '')) ? toast('代码已复制，去授权页面粘贴即可', 'ok') : toast('复制失败，请手动选择登录码复制', 'warn');
              };
              host.querySelector('#ms-back').onclick = showMenu;
              const statusEl = host.querySelector('#ms-status');
              const finish = (name) => { stopped = true; clearTimers(); close(true); toast(`欢迎，${name}！`, 'ok'); load(); };
              const poll = async () => {
                if (stopped || epoch !== my) return;
                let p;
                try { p = await api.accounts.msPoll(r.deviceId); } catch (e) {
                  if (stopped || epoch !== my) return;
                  statusEl.innerHTML = `<span class="small" style="color:var(--err)">检查授权状态失败：${escapeHtml(errMsg(e))}</span><button class="btn sm" id="ms-repoll">重试</button>`;
                  const b = statusEl.querySelector('#ms-repoll');
                  if (b) b.onclick = () => {
                    if (stopped || epoch !== my) return;
                    statusEl.innerHTML = '<div class="spinner sm"></div><span class="small muted">等待你在浏览器中完成授权…</span>';
                    later(poll, 1500, my);
                  };
                  return;
                }
                if (stopped || epoch !== my) return;
                if (p && p.status === 'done') {
                  const acc = p.account || {};
                  finish(acc.displayName || acc.name || '玩家');
                  return;
                }
                later(poll, Math.max(2, Number(r.interval) || 5) * 1000, my);
              };
              later(poll, Math.max(2, Number(r.interval) || 5) * 1000, my);
            })();
          }

          function showYgg() {
            epoch++; clearTimers();
            host.innerHTML = `
              <label class="field"><span class="field-label">皮肤站</span>
                <select class="input" id="yg-preset">
                  <option value="littleskin">LittleSkin</option>
                  <option value="elyby">Ely.by</option>
                  <option value="custom">自定义服务器</option>
                </select></label>
              <div id="yg-server-wrap" style="display:none">
                <label class="field"><span class="field-label">认证服务器地址</span>
                  <input class="input" id="yg-server" placeholder="https://example.com/api/yggdrasil"></label>
              </div>
              <label class="field"><span class="field-label">账号</span>
                <input class="input" id="yg-user" placeholder="邮箱或用户名"></label>
              <label class="field"><span class="field-label">密码</span>
                <input class="input" id="yg-pass" type="password" placeholder="皮肤站账号的密码"></label>
              <div id="yg-err" class="small" style="color:var(--err);display:none"></div>
              <div class="row mt-2"><button class="btn ghost" id="yg-back">返回</button><div class="spacer"></div><button class="btn primary" id="yg-ok">登录并添加</button></div>`;
            const preset = host.querySelector('#yg-preset');
            const wrap = host.querySelector('#yg-server-wrap');
            preset.onchange = () => { wrap.style.display = preset.value === 'custom' ? '' : 'none'; };
            host.querySelector('#yg-back').onclick = showMenu;
            host.querySelector('#yg-ok').onclick = async () => {
              const errEl = host.querySelector('#yg-err');
              const btn = host.querySelector('#yg-ok');
              const showErr = (m) => { errEl.style.display = ''; errEl.textContent = m; };
              errEl.style.display = 'none';
              const username = host.querySelector('#yg-user').value.trim();
              const password = host.querySelector('#yg-pass').value;
              const serverUrl = host.querySelector('#yg-server').value.trim();
              if (preset.value === 'custom' && !/^https?:\/\//.test(serverUrl)) { showErr('请填写以 http:// 或 https:// 开头的认证服务器地址'); return; }
              if (!username || !password) { showErr('账号和密码都要填上'); return; }
              btn.disabled = true; btn.textContent = '登录中…';
              try {
                const acc = await api.accounts.addYggdrasil({
                  preset: preset.value,
                  serverUrl: preset.value === 'custom' ? serverUrl : undefined,
                  username,
                  password,
                });
                stopped = true; clearTimers(); close(true);
                toast(`皮肤站账户「${(acc && acc.name) || username}」已添加`, 'ok');
                load();
              } catch (e) {
                btn.disabled = false; btn.textContent = '登录并添加';
                showErr(errMsg(e));
              }
            };
          }

          showMenu();
        },
      });
    }

    el.querySelector('#acc-add-btn').onclick = openAddDialog;
    sub('bb:accounts-changed', () => load());
    await load();
  },
};
