// 联机页：局域网直连 + 跨网络联机房间
import { api, on } from '../api.js';
import { toast, confirmDialog, setBreadcrumb, escapeHtml } from '../ui.js';

let cleanups = [];
function addCleanup(fn) { cleanups.push(fn); }
function runCleanups() { for (const f of cleanups) { try { f(); } catch { /* 忽略 */ } } cleanups = []; }
function sub(ch, cb) { try { const off = on(ch, cb); if (typeof off === 'function') addCleanup(off); } catch { /* 忽略 */ } }

function errMsg(e) { const m = e && e.message ? String(e.message) : String(e || ''); return m || '未知错误'; }

async function copyText(text) {
  try { await api.clip.write(text); return true; }
  catch { try { await navigator.clipboard.writeText(text); return true; } catch { return false; } }
}

function ensureStyle() {
  if (document.getElementById('mp-style')) return;
  const s = document.createElement('style');
  s.id = 'mp-style';
  s.textContent = `
    .mp-opt { display: flex; gap: 12px; align-items: center; flex: 1 1 280px; text-align: left; font: inherit; color: inherit; }
    .mp-opt .tile-icon { font-size: 24px; line-height: 1.2; }
    .mp-opt.active { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--card)); }
    .room-code { font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 34px; font-weight: 700; letter-spacing: 10px; color: var(--accent); user-select: all; }
    .p2p-bar { padding: 10px 14px; border-radius: var(--radius-sm); border: 1px solid var(--border-2); background: var(--card); }
    .p2p-bar.info { color: var(--fg-2); }
    .p2p-bar.ok { border-color: color-mix(in srgb, var(--ok) 55%, transparent); color: var(--ok); font-weight: 600; }
    .p2p-bar.err { border-color: color-mix(in srgb, var(--err) 55%, transparent); }
    .ok-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--ok); display: inline-block; flex: 0 0 auto; }
  `;
  document.head.appendChild(s);
}

export default {
  id: 'multiplayer',
  title: '联机',
  icon: '🌐',
  routes: ['/multiplayer'],
  order: 6,
  async render(el) {
    runCleanups();
    ensureStyle();
    setBreadcrumb([{ label: '主页', onClick() { location.hash = '/'; } }, { label: '联机' }]);
    el.innerHTML = `
      <div class="small muted mb-3">和朋友一起玩：同一 WiFi 下用局域网直连，不在同一网络就开一间联机房间。</div>
      <div class="row wrap mb-3" style="gap:14px;align-items:stretch">
        <button class="card hoverable mp-opt active" data-m="lan">
          <span class="tile-icon">📶</span>
          <span class="col" style="gap:2px;text-align:left;min-width:0">
            <span class="bold">方式一：局域网直连（零配置）</span>
            <span class="small muted">同一 WiFi 下的好友</span>
          </span>
        </button>
        <button class="card hoverable mp-opt" data-m="room">
          <span class="tile-icon">🌍</span>
          <span class="col" style="gap:2px;text-align:left;min-width:0">
            <span class="bold">方式二：联机房间（跨网络）</span>
            <span class="small muted">不在同一 WiFi 也能连</span>
          </span>
        </button>
      </div>
      <div id="mp-body"></div>`;
    const body = el.querySelector('#mp-body');
    let mode = 'lan';
    let roomCode = null;
    let joinedPort = null;
    let lastStatus = null;

    el.querySelectorAll('.mp-opt').forEach((b) => {
      b.onclick = () => {
        el.querySelectorAll('.mp-opt').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        if (b.dataset.m === 'lan') showLan();
        else showRoom();
      };
    });

    /* ---------- 局域网直连 ---------- */
    function showLan() {
      mode = 'lan';
      body.innerHTML = `
        <div class="card mb-3">
          <div class="row">
            <div>
              <div class="bold">网络环境</div>
              <div class="small muted mt-1">确认你和好友是不是在同一个网络里。</div>
            </div>
            <div class="spacer"></div>
            <button class="btn" id="lan-check">检查网络环境</button>
          </div>
          <div id="lan-info" class="mt-2"><div class="small muted-3">点「检查网络环境」查看本机 IP 和子网信息。</div></div>
        </div>
        <div class="card mb-3">
          <div class="bold mb-2">局域网世界</div>
          <div id="lan-worlds"><div class="small muted">正在查找局域网世界…</div></div>
        </div>
        <div class="card">
          <div class="bold mb-2">怎么联</div>
          <div class="col small muted" style="gap:6px">
            <div>1. 玩家 A 打开自己的单人世界，按 Esc 选择「对局域网开放」并确认。</div>
            <div>2. 玩家 B 启动游戏，打开「多人游戏」，稍等几秒就能在列表里看到 A 的世界。</div>
            <div>3. 如果列表里没出现，先点上面的「检查网络环境」，确认两人 IP 前三段一致。</div>
          </div>
        </div>`;
      body.querySelector('#lan-check').onclick = checkLan;
      loadWorlds();
    }

    async function checkLan() {
      const info = body.querySelector('#lan-info');
      if (!info) return;
      info.innerHTML = '<div class="row small muted"><div class="spinner sm"></div>正在检查…</div>';
      let r;
      try { r = await api.net.lanCheck(); }
      catch (e) {
        info.innerHTML = `<div class="small" style="color:var(--err)">检查失败：${escapeHtml(errMsg(e))}。稍等一下再试一次。</div>
          <button class="btn sm mt-2" id="lan-retry">重试</button>`;
        const b = info.querySelector('#lan-retry');
        if (b) b.onclick = checkLan;
        return;
      }
      const prefix = String(r.ip || '').split('.').slice(0, 3).join('.');
      info.innerHTML = `
        <div class="row wrap" style="gap:8px">
          <span class="badge accent">本机 IP：${escapeHtml(r.ip || '未知')}</span>
          ${r.subnet ? `<span class="badge">子网：${escapeHtml(r.subnet)}</span>` : ''}
          ${r.ssid ? `<span class="badge">WiFi：${escapeHtml(r.ssid)}</span>` : ''}
          <span class="badge ${r.gatewayReachable ? 'ok' : 'warn'}">${r.gatewayReachable ? '网关可达' : '网关不可达'}</span>
        </div>
        <div class="small muted mt-2">你和好友的 IP 前三段一致就说明在同一网络${prefix ? `（你的是 ${escapeHtml(prefix)}.x.x）` : ''}。一致的话，让对方在游戏里「对局域网开放」就行。</div>`;
    }

    async function loadWorlds() {
      const elw = body.querySelector('#lan-worlds');
      if (!elw) return;
      let list;
      try { list = await api.net.lanWorlds(); }
      catch (e) {
        elw.innerHTML = `<div class="small" style="color:var(--err)">暂时拿不到局域网世界列表：${escapeHtml(errMsg(e))}</div>`;
        return;
      }
      list = Array.isArray(list) ? list : [];
      if (!list.length) {
        elw.innerHTML = '<div class="small muted">还没有发现局域网世界。让好友先在游戏里「对局域网开放」，发现后会自动出现在这里。</div>';
        return;
      }
      elw.innerHTML = list.map((w, i) => `
        <div class="list-row" style="padding-left:0">
          <div class="row-icon">🗺️</div>
          <div class="col" style="gap:2px;min-width:0">
            <div class="bold ellipsis">${escapeHtml(w.motd || '未知世界')}</div>
            <div class="small muted-3">${escapeHtml(w.host || '未知主机')}:${escapeHtml(String(w.port ?? ''))}</div>
          </div>
          <div class="spacer"></div>
          <button class="btn sm" data-wi="${i}">进入</button>
        </div>`).join('');
      elw.querySelectorAll('[data-wi]').forEach((b) => {
        b.onclick = async () => {
          const w = list[Number(b.dataset.wi)];
          if (!w) return;
          const addr = `${w.host}:${w.port}`;
          const ok = await copyText(addr);
          toast(ok
            ? `地址 ${addr} 已复制。启动游戏后，在游戏内「多人游戏」列表中即可看到这个世界并直接加入。`
            : `记住地址 ${addr}。启动游戏后，在游戏内「多人游戏」列表中即可看到这个世界。`, 'info', 5000);
        };
      });
    }

    /* ---------- 联机房间 ---------- */
    function showRoom() {
      mode = 'room';
      body.innerHTML = `
        <div class="grid cols-2">
          <div class="card">
            <div class="bold">创建联机房间</div>
            <div class="small muted mt-1">你是房主。创建后把房间码发给好友，对方在启动器里输入就能连上来。</div>
            <button class="btn primary mt-3" id="room-create">创建联机房间</button>
          </div>
          <div class="card">
            <div class="bold">加入房间</div>
            <div class="small muted mt-1">输入好友发给你的 6 位数字房间码。</div>
            <div class="row mt-3">
              <input class="input" id="room-code" inputmode="numeric" maxlength="6" placeholder="6 位数字，如 483920" style="letter-spacing:4px">
              <button class="btn primary" id="room-join" style="flex:0 0 auto">加入</button>
            </div>
            <div id="join-err" class="small mt-2" style="color:var(--err);display:none"></div>
          </div>
        </div>
        <div id="p2p-status" class="mt-3"></div>
        <div id="p2p-panel" class="mt-3"></div>`;
      body.querySelector('#room-create').onclick = createRoom;
      const codeInput = body.querySelector('#room-code');
      codeInput.addEventListener('input', () => { codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 6); });
      codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
      body.querySelector('#room-join').onclick = joinRoom;
      renderStatus();
      if (roomCode) showHostPanel();
      else if (joinedPort) showJoinedPanel();
    }

    async function createRoom() {
      const btn = body.querySelector('#room-create');
      if (!btn) return;
      btn.disabled = true; btn.textContent = '正在创建…';
      let r;
      try { r = await api.p2p.createRoom({}); }
      catch (e) {
        btn.disabled = false; btn.textContent = '创建联机房间';
        toast(`房间创建失败：${errMsg(e)}`, 'error');
        return;
      }
      roomCode = r && r.code;
      if (!roomCode) {
        btn.disabled = false; btn.textContent = '创建联机房间';
        toast('房间创建失败：没有拿到房间码，请重试', 'error');
        return;
      }
      showHostPanel();
      loadPlayers();
      toast('房间已创建，把房间码发给好友吧', 'ok');
    }

    function showHostPanel() {
      const panel = body.querySelector('#p2p-panel');
      if (!panel) return;
      panel.innerHTML = `
        <div class="card">
          <div class="row wrap">
            <div>
              <div class="small muted">房间码</div>
              <div class="room-code mt-1">${escapeHtml(String(roomCode))}</div>
            </div>
            <div class="spacer"></div>
            <button class="btn primary" id="copy-code">复制房间码</button>
          </div>
          <div class="small muted mt-2">房间已创建。把房间码发给好友，他们在启动器中输入就能加入。这个房间会在 30 分钟无人加入后自动关闭。</div>
          <div class="bold small mt-3 mb-2">已连接玩家</div>
          <div id="p2p-players"><div class="small muted">还没有玩家连接，等好友输入房间码加入吧。</div></div>
          <div class="row mt-3"><div class="spacer"></div><button class="btn danger" id="room-close">关闭房间</button></div>
        </div>`;
      panel.querySelector('#copy-code').onclick = async () => {
        (await copyText(String(roomCode))) ? toast('房间码已复制，发给好友吧', 'ok') : toast('复制失败，请手动记下房间码', 'warn');
      };
      panel.querySelector('#room-close').onclick = async () => {
        const ok = await confirmDialog('关闭房间', '关闭后所有玩家都会断开连接，好友需要等你重新创建房间。确定关闭吗？', { danger: true, okLabel: '关闭房间' });
        if (!ok) return;
        try {
          await api.p2p.closeRoom();
          roomCode = null;
          showRoom();
          toast('房间已关闭', 'ok');
        } catch (e) { toast(`关闭失败：${errMsg(e)}`, 'error'); }
      };
    }

    async function loadPlayers() {
      const elp = body.querySelector('#p2p-players');
      if (!elp) return;
      let list;
      try { list = await api.p2p.players(); }
      catch { elp.innerHTML = '<div class="small muted">暂时拿不到玩家列表，有玩家加入时会自动刷新。</div>'; return; }
      list = Array.isArray(list) ? list : [];
      if (!list.length) { elp.innerHTML = '<div class="small muted">还没有玩家连接，等好友输入房间码加入吧。</div>'; return; }
      elp.innerHTML = list.map((p) => `
        <div class="list-row" style="padding-left:0">
          <div class="row-icon">${p.role === 'host' ? '🏠' : '🧑'}</div>
          <div class="col" style="gap:2px;min-width:0">
            <div class="bold ellipsis">${escapeHtml(p.name || '未知玩家')}</div>
            <div class="tiny muted-3 ellipsis">${escapeHtml(p.addr || '')}</div>
          </div>
          <div class="spacer"></div>
          ${p.role === 'host' ? '<span class="badge accent">房主（你）</span>' : '<span class="badge ok">已连接</span>'}
        </div>`).join('');
    }

    async function joinRoom() {
      const codeInput = body.querySelector('#room-code');
      const errEl = body.querySelector('#join-err');
      if (!codeInput || !errEl) return;
      const code = codeInput.value.trim();
      if (!/^\d{6}$/.test(code)) {
        errEl.style.display = '';
        errEl.textContent = '请输入好友发给你的 6 位数字房间码';
        return;
      }
      const btn = body.querySelector('#room-join');
      btn.disabled = true; btn.textContent = '连接中…';
      errEl.style.display = 'none';
      let r;
      try { r = await api.p2p.joinRoom(code); }
      catch (e) {
        btn.disabled = false; btn.textContent = '加入';
        const msg = errMsg(e);
        errEl.style.display = '';
        errEl.textContent = msg.includes('不存在')
          ? '这个房间码不存在或已过期。确认一下好友发给你的号码是不是完整的 6 位数字。'
          : msg;
        return;
      }
      joinedPort = r && r.localPort;
      if (!joinedPort) {
        btn.disabled = false; btn.textContent = '加入';
        errEl.style.display = '';
        errEl.textContent = '连接没有返回本地端口，请重试一次。';
        return;
      }
      showJoinedPanel();
      const addr = `127.0.0.1:${joinedPort}`;
      const ok = await copyText(addr);
      toast(ok ? '已连接！游戏内地址已自动复制，去粘贴吧' : '已连接！复制一下下面的游戏内地址', 'ok', 4500);
    }

    function showJoinedPanel() {
      const panel = body.querySelector('#p2p-panel');
      if (!panel) return;
      const addr = `127.0.0.1:${joinedPort}`;
      panel.innerHTML = `
        <div class="card">
          <div class="row"><span class="ok-dot"></span><div class="bold" style="color:var(--ok)">已连接！</div></div>
          <div class="small muted mt-1">在游戏内 多人游戏 → 直接连接 输入下面的地址：</div>
          <div class="row mt-2"><code class="conn-addr">${escapeHtml(addr)}</code><button class="btn sm" id="copy-addr">复制地址</button></div>
          <div class="row mt-3"><div class="spacer"></div><button class="btn" id="leave-room">断开连接</button></div>
        </div>`;
      panel.querySelector('#copy-addr').onclick = async () => {
        (await copyText(addr)) ? toast('地址已复制', 'ok') : toast('复制失败，请手动选择地址复制', 'warn');
      };
      panel.querySelector('#leave-room').onclick = async () => {
        try {
          await api.p2p.leave();
          joinedPort = null;
          showRoom();
          toast('已断开连接', 'info');
        } catch (e) { toast(`断开失败：${errMsg(e)}`, 'error'); }
      };
      const ci = body.querySelector('#room-code');
      const jb = body.querySelector('#room-join');
      if (ci) ci.disabled = true;
      if (jb) { jb.disabled = true; jb.textContent = '已连接'; }
    }

    /* ---------- 连接状态条 ---------- */
    function adviceFor(reason) {
      const r = String(reason || '');
      if (r.includes('防火墙')) return '请在"系统设置-网络-防火墙"中允许方块盒子联网';
      if (r.includes('NAT') || r.includes('网络限制')) return '当前网络限制较严，试试换一个网络（比如手机热点）';
      if (r.includes('离线')) return '对方可能已经下线或房间已关闭，让对方重新创建一个房间';
      return '';
    }

    function statusHtml(s) {
      if (!s || !s.state) return '';
      if (s.state === 'signaling') return '<div class="p2p-bar info">⏳ 正在建立连接…</div>';
      if (s.state === 'connecting') return '<div class="p2p-bar info">📡 正在打洞连接…可能需要 30 秒</div>';
      if (s.state === 'connected') return '<div class="p2p-bar ok">🟢 连接已建立</div>';
      if (s.state === 'error') {
        const reason = String(s.reason || '连接出了问题，再试一次');
        const advice = adviceFor(reason);
        return `<div class="p2p-bar err">
          <div class="bold">连接出错了</div>
          <div class="small mt-1">${escapeHtml(reason)}</div>
          ${advice ? `<div class="small mt-1">💡 ${escapeHtml(advice)}</div>` : ''}
        </div>`;
      }
      return '';
    }

    function renderStatus() {
      const els = body.querySelector('#p2p-status');
      if (els) els.innerHTML = statusHtml(lastStatus);
    }

    sub('bb:p2p-status', (s) => { lastStatus = s; renderStatus(); });
    sub('bb:p2p-players', () => { if (mode === 'room' && roomCode) loadPlayers(); });
    sub('bb:lan-worlds', () => { if (mode === 'lan') loadWorlds(); });

    showLan();
  },
};
