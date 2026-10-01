// 下载中心：任务列表 + 实时进度（按行更新） + 暂停/继续/重试/取消
import { api, on } from '../api.js';
import { toast, confirmDialog, emptyState, skeletonRows, progressBar, setBreadcrumb, escapeHtml } from '../ui.js';

let cleanups = [];
function addCleanup(fn) { cleanups.push(fn); }
function runCleanups() { for (const f of cleanups) { try { f(); } catch { /* 忽略 */ } } cleanups = []; }
function sub(ch, cb) { try { const off = on(ch, cb); if (typeof off === 'function') addCleanup(off); } catch { /* 忽略 */ } }
function errMsg(e) { const m = e && e.message ? String(e.message) : String(e || ''); return m || '未知错误'; }

function typeIcon(t) {
  const s = String(t || '').toLowerCase();
  if (s.includes('java')) return '☕';
  if (s.includes('modpack') || s.includes('整合')) return '📦';
  if (s.includes('shader') || s.includes('光影')) return '✨';
  if (s.includes('resource') || s.includes('texture') || s.includes('资源包')) return '🎨';
  if (s.includes('mod') || s.includes('模组')) return '🧩';
  if (s.includes('skin') || s.includes('皮肤')) return '🧑‍🎤';
  if (s.includes('world') || s.includes('map') || s.includes('地图') || s.includes('存档')) return '🗺️';
  if (s.includes('game') || s.includes('version') || s.includes('vanilla') || s.includes('client') || s.includes('server') || s.includes('游戏')) return '🎮';
  return '📄';
}

const STATE_META = {
  downloading: { label: '下载中', cls: 'accent' },
  paused: { label: '已暂停', cls: 'warn' },
  pending: { label: '排队中', cls: '' },
  done: { label: '已完成 · 已自动放到对应位置', cls: 'ok' },
  error: { label: '失败', cls: 'err' },
};
function stateMeta(s) { return STATE_META[s] || { label: String(s || '未知状态'), cls: '' }; }

function fmtSize(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, x = v;
  while (x >= 1024 && i < units.length - 1) { x /= 1024; i++; }
  return `${i === 0 || x >= 100 ? Math.round(x) : x.toFixed(1)} ${units[i]}`;
}
function fmtSpeed(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '';
  if (v >= 1024 * 1024) return `${(v / 1048576).toFixed(2)} MB/s`;
  if (v >= 1024) return `${(v / 1024).toFixed(1)} KB/s`;
  return `${Math.round(v)} B/s`;
}

function ensureStyle() {
  if (document.getElementById('dl-style')) return;
  const s = document.createElement('style');
  s.id = 'dl-style';
  s.textContent = `
    .dl-task { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px 14px; margin-bottom: 8px; }
    .dl-task .dl-meta { font-size: 12px; color: var(--fg-3); }
    .dl-err-detail { display: none; margin-top: 9px; padding: 8px 12px; border-radius: var(--radius-sm);
      background: color-mix(in srgb, var(--err) 10%, transparent); border: 1px solid color-mix(in srgb, var(--err) 30%, transparent);
      color: var(--err); font-size: 12.5px; user-select: text; cursor: text; }
    .dl-task.expanded .dl-err-detail { display: block; }
  `;
  document.head.appendChild(s);
}

export default {
  id: 'downloads',
  title: '下载中心',
  icon: '⬇️',
  routes: ['/downloads'],
  order: 3,
  async render(el, ctx) {
    runCleanups();
    ensureStyle();
    setBreadcrumb([{ label: '主页', onClick() { location.hash = '/'; } }, { label: '下载中心' }]);

    el.innerHTML = `
      <div class="row mb-3">
        <div class="col" style="gap:2px">
          <div class="bold" style="font-size:17px">下载中心</div>
          <div class="small muted">安装模组、下载整合包或 Java 的任务都会出现在这里，随时可以暂停、继续或重试。</div>
        </div>
        <div class="spacer"></div>
        <label class="row" style="gap:6px;align-items:center;flex:0 0 auto" data-tip="同时下载的任务数">
          <span class="small muted-3">并发数</span>
          <select class="input sm" id="dl-concurrency" style="width:auto">
            <option value="2">2</option>
            <option value="4">4</option>
            <option value="8">8</option>
          </select>
        </label>
        <button class="btn sm" id="dl-pauseall">全部暂停</button>
        <button class="btn sm" id="dl-resumeall">全部继续</button>
      </div>
      <div id="dl-body">${skeletonRows(5)}</div>`;

    const tasks = [];
    const byId = new Map();
    const rowMap = new Map();
    const expanded = new Set();

    el.querySelector('#dl-pauseall').onclick = () => doAll('pauseAll', '已暂停全部下载任务');
    el.querySelector('#dl-resumeall').onclick = () => doAll('resumeAll', '已继续全部下载任务');

    // 并发数（同时下载的任务数）
    const concSel = el.querySelector('#dl-concurrency');
    let curConc = Number(ctx && ctx.settings && ctx.settings.maxConcurrentDownloads);
    if (!Number.isFinite(curConc) || curConc <= 0) {
      try { const s = await api.settings.get(); curConc = Number(s && s.maxConcurrentDownloads) || 4; }
      catch { curConc = 4; }
    }
    concSel.value = String([2, 4, 8].includes(curConc) ? curConc : 4);
    concSel.dataset.prev = concSel.value;
    concSel.onchange = async () => {
      const v = Number(concSel.value) || 4;
      try {
        await api.settings.set({ maxConcurrentDownloads: v });
        concSel.dataset.prev = concSel.value;
        toast(`同时下载的任务数已改为 ${v}`, 'ok');
      } catch (e) {
        concSel.value = concSel.dataset.prev || '4';
        toast(/接通中|__unimplemented/.test(errMsg(e)) ? '该功能需要较新版本支持' : `保存设置失败：${errMsg(e)}`, 'error', 5000);
      }
    };

    let loadTimer = null;
    function scheduleLoad(ms = 300) {
      clearTimeout(loadTimer);
      loadTimer = setTimeout(() => { loadTimer = null; load(); }, ms);
    }
    addCleanup(() => clearTimeout(loadTimer));

    async function load() {
      if (!el.isConnected) return;
      const body = el.querySelector('#dl-body');
      if (!body) return;
      let list;
      try { list = await api.downloads.list(); }
      catch (e) {
        body.innerHTML = `<div class="card"><div class="bold">下载列表加载失败</div>
          <div class="small muted mt-1">发生了什么：${escapeHtml(errMsg(e))}</div>
          <div class="small muted mt-1">可能是后台服务暂时没有响应，稍等一下再试。</div>
          <button class="btn mt-3" id="dl-retry">重试</button></div>`;
        const b = body.querySelector('#dl-retry');
        if (b) b.onclick = () => { body.innerHTML = skeletonRows(5); load(); };
        return;
      }
      tasks.length = 0;
      for (const t of (Array.isArray(list) ? list : [])) tasks.push(t);
      byId.clear();
      for (const t of tasks) byId.set(String(t.id), t);
      renderList();
    }

    function renderList() {
      const body = el.querySelector('#dl-body');
      if (!body) return;
      rowMap.clear();
      if (!tasks.length) {
        body.innerHTML = emptyState({
          icon: '📭',
          title: '没有下载任务',
          text: '安装模组、创建实例或下载 Java 时，任务会出现在这里。',
        });
        return;
      }
      body.innerHTML = '';
      const frag = document.createDocumentFragment();
      for (const t of tasks) {
        const node = taskEl(t);
        rowMap.set(String(t.id), node);
        frag.appendChild(node);
      }
      body.appendChild(frag);
    }

    function taskEl(t) {
      const id = String(t.id);
      const meta = stateMeta(t.state);
      const total = Number(t.total) || 0;
      const received = Number(t.received) || 0;
      const p = t.state === 'done' ? 100 : total > 0 ? Math.min(100, Math.round((received / total) * 100)) : null;
      const speedTxt = t.state === 'downloading' ? fmtSpeed(t.speed) : '';
      const etaTxt = t.state === 'downloading' && t.etaText ? `剩余 ${escapeHtml(String(t.etaText))}` : '';

      const wrap = document.createElement('div');
      wrap.className = 'dl-task';
      wrap.dataset.dlId = id;
      wrap.innerHTML = `
        <div class="row" style="gap:12px">
          <div class="row-icon">${typeIcon(t.type)}</div>
          <div class="col" style="gap:5px;flex:1;min-width:0">
            <div class="row" style="gap:8px">
              <span class="bold ellipsis" style="max-width:100%">${escapeHtml(t.name || '未命名任务')}</span>
              <span class="badge ${meta.cls}" style="flex:0 0 auto">${escapeHtml(meta.label)}</span>
            </div>
            <div class="row" style="gap:10px">
              <div style="flex:1;min-width:60px">${progressBar(p, { thin: true })}</div>
              <span class="dl-meta" style="flex:0 0 auto">${p == null ? '—' : p + '%'}</span>
            </div>
            <div class="row dl-meta" style="gap:14px">
              <span>${fmtSize(received)}${total > 0 ? ` / ${fmtSize(total)}` : ''}</span>
              ${speedTxt ? `<span>${escapeHtml(speedTxt)}</span>` : ''}
              ${etaTxt ? `<span>${etaTxt}</span>` : ''}
            </div>
          </div>
          <div class="row dl-acts" style="gap:6px;flex:0 0 auto"></div>
        </div>
        <div class="dl-err-detail"></div>`;
      const errBox = wrap.querySelector('.dl-err-detail');
      if (t.state === 'error' && t.error) {
        errBox.textContent = `失败原因：${t.error}。可以点「重试」再试一次，取消后任务会被移除。`;
        if (expanded.has(id)) wrap.classList.add('expanded');
        wrap.style.cursor = 'pointer';
        wrap.addEventListener('click', (e) => {
          if (e.target.closest('button')) return;
          const on = wrap.classList.toggle('expanded');
          if (on) expanded.add(id); else expanded.delete(id);
        });
      } else {
        errBox.remove();
      }

      const acts = wrap.querySelector('.dl-acts');
      const mk = (label, cls, fn) => {
        const b = document.createElement('button');
        b.className = cls;
        b.textContent = label;
        b.onclick = (e) => { e.stopPropagation(); fn(); };
        acts.appendChild(b);
      };
      if (t.state === 'downloading') mk('暂停', 'btn sm', () => act('pause', t));
      else if (t.state === 'paused') mk('继续', 'btn sm primary', () => act('resume', t));
      else if (t.state === 'error') {
        mk('重试', 'btn sm primary', () => act('retry', t));
        if (t.error) {
          mk('复制错误信息', 'btn sm', async () => {
            const text = String(t.error);
            try {
              await api.clip.write({ text });
              toast('错误信息已复制', 'ok');
            } catch (e) {
              try { await navigator.clipboard.writeText(text); toast('错误信息已复制', 'ok'); }
              catch {
                toast(/接通中|__unimplemented/.test(errMsg(e))
                  ? '当前版本暂不支持自动复制，可以在错误详情里选中文字手动复制'
                  : `复制失败：${errMsg(e)}`, 'warn', 5000);
              }
            }
          });
          mk('查看日志说明', 'btn sm ghost', () => { location.hash = '#/help'; });
        }
      }
      if (t.state !== 'done') mk('取消', 'btn sm ghost', () => cancelTask(t));
      return wrap;
    }

    async function act(action, t) {
      const labels = { pause: '已暂停', resume: '已继续', retry: '已重新排队' };
      try {
        await api.downloads[action]({ id: t.id });
        toast(`${labels[action] || '操作成功'}：${t.name || '任务'}`, 'ok');
        scheduleLoad(150);
      } catch (e) {
        toast(`操作失败：${errMsg(e)}`, 'error');
      }
    }

    async function cancelTask(t) {
      const ok = await confirmDialog('取消下载任务',
        `确定取消「${t.name || '未命名任务'}」吗？已下载的内容会被清理，之后需要重新下载。`,
        { danger: true, okLabel: '取消任务' });
      if (!ok) return;
      try {
        await api.downloads.cancel({ id: t.id });
        toast('任务已取消', 'ok');
        scheduleLoad(150);
      } catch (e) {
        toast(`取消失败：${errMsg(e)}`, 'error');
      }
    }

    async function doAll(method, okText) {
      try {
        await api.downloads[method]({});
        toast(okText, 'ok');
        scheduleLoad(150);
      } catch (e) {
        toast(`操作失败：${errMsg(e)}`, 'error');
      }
    }

    function onProgress(d) {
      if (!d || d.id == null) return;
      const id = String(d.id);
      const cur = byId.get(id);
      if (!cur) { scheduleLoad(); return; }
      const merged = { ...cur, ...d };
      if (merged.state !== 'error') expanded.delete(id);
      const idx = tasks.findIndex((x) => String(x.id) === id);
      if (idx >= 0) tasks[idx] = merged;
      byId.set(id, merged);
      const old = rowMap.get(id);
      if (old && old.isConnected) {
        const neu = taskEl(merged);
        old.replaceWith(neu);
        rowMap.set(id, neu);
      } else {
        scheduleLoad();
      }
    }

    sub('bb:download-progress', onProgress);
    sub('bb:downloads-changed', () => scheduleLoad());

    await load();
  },
};
