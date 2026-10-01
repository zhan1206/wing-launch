// 资源管理器：全盘扫描资源 + 筛选/搜索/排序 + 批量删除/撤销/导出/移动 + 清理未使用资源
import { api, on } from '../api.js';
import { toast, confirmDialog, showDialog, emptyState, skeletonRows, setBreadcrumb, escapeHtml } from '../ui.js';

let cleanups = [];
function addCleanup(fn) { cleanups.push(fn); }
function runCleanups() { for (const f of cleanups) { try { f(); } catch { /* 忽略 */ } } cleanups = []; }
function sub(ch, cb) { try { const off = on(ch, cb); if (typeof off === 'function') addCleanup(off); } catch { /* 忽略 */ } }
function errMsg(e) { const m = e && e.message ? String(e.message) : String(e || ''); return m || '未知错误'; }

const KIND_META = {
  mod: { label: '模组', icon: '🧩' },
  resourcepack: { label: '资源包', icon: '🎨' },
  shaderpack: { label: '光影包', icon: '✨' },
  world: { label: '存档', icon: '🗺️' },
  skin: { label: '皮肤', icon: '🧑‍🎤' },
};
function kindMeta(k) { return KIND_META[k] || { label: String(k || '其他'), icon: '📄' }; }
const TOGGLE_KINDS = ['mod', 'resourcepack', 'shaderpack'];

function fmtSize(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, x = v;
  while (x >= 1024 && i < units.length - 1) { x /= 1024; i++; }
  return `${i === 0 || x >= 100 ? Math.round(x) : x.toFixed(1)} ${units[i]}`;
}
function fmtTime(ts) {
  let v = Number(ts);
  if (!Number.isFinite(v) || v <= 0) return '—';
  if (v < 1e12) v *= 1000;
  const d = new Date(v);
  if (isNaN(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function baseName(p) { return String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || String(p || ''); }

function ensureStyle() {
  if (document.getElementById('res-style')) return;
  const s = document.createElement('style');
  s.id = 'res-style';
  s.textContent = `
    .res-batchbar { position: sticky; top: 10px; z-index: 20;
      border-color: color-mix(in srgb, var(--accent) 45%, transparent); box-shadow: var(--shadow); }
    .res-row input[type="checkbox"], .res-batchbar input[type="checkbox"],
    .cl-check { accent-color: var(--accent); width: 15px; height: 15px; flex: 0 0 auto; cursor: pointer; }
    #res-list .list-row { border: 1px solid transparent; border-radius: var(--radius-sm); cursor: pointer; }
    #res-list .list-row:hover { background: var(--hover); }
  `;
  document.head.appendChild(s);
}

export default {
  id: 'resources',
  title: '资源管理器',
  icon: '🗃️',
  routes: ['/resources'],
  order: 7,
  async render(el) {
    runCleanups();
    ensureStyle();
    setBreadcrumb([{ label: '主页', onClick() { location.hash = '/'; } }, { label: '资源管理器' }]);

    const items = [];
    const selected = new Set();
    let filterKind = 'all';
    let query = '';
    let sortBy = 'time-desc';

    el.innerHTML = `
      <div class="row wrap mb-3" style="gap:10px">
        <div class="tabs" style="border-bottom:none;margin-bottom:0;gap:4px" id="res-tabs">
          ${['all', 'mod', 'resourcepack', 'shaderpack', 'world', 'skin'].map((k) =>
            `<button class="tab ${k === 'all' ? 'active' : ''}" data-k="${k}">${k === 'all' ? '全部' : KIND_META[k].label}</button>`).join('')}
        </div>
        <div class="spacer"></div>
        <input class="input" id="res-search" placeholder="搜索资源名称…" style="width:200px;flex:0 1 200px">
        <select class="input" id="res-sort" style="width:auto;flex:0 0 auto">
          <option value="time-desc">时间（新→旧）</option>
          <option value="time-asc">时间（旧→新）</option>
          <option value="size-desc">大小（大→小）</option>
          <option value="size-asc">大小（小→大）</option>
        </select>
        <button class="btn" id="res-clean">🧹 清理未使用资源</button>
      </div>
      <div id="res-batch" class="mb-3"></div>
      <div id="res-list">${skeletonRows(6)}</div>
      <div class="small muted-3 mt-3">回收站中的文件保留 7 天，之后自动清理。</div>`;

    el.querySelector('#res-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('.tab');
      if (!b) return;
      filterKind = b.dataset.k;
      el.querySelectorAll('#res-tabs .tab').forEach((x) => x.classList.toggle('active', x === b));
      renderList();
    });
    el.querySelector('#res-search').addEventListener('input', (e) => {
      query = e.target.value.trim().toLowerCase();
      renderList();
    });
    el.querySelector('#res-sort').addEventListener('change', (e) => { sortBy = e.target.value; renderList(); });
    el.querySelector('#res-clean').onclick = cleanUnused;

    async function load() {
      if (!el.isConnected) return;
      const listBox = el.querySelector('#res-list');
      if (!listBox) return;
      let list;
      try { list = await api.resources.scan(); }
      catch (e) {
        listBox.innerHTML = `<div class="card"><div class="bold">资源列表加载失败</div>
          <div class="small muted mt-1">发生了什么：${escapeHtml(errMsg(e))}</div>
          <div class="small muted mt-1">可能是后台服务暂时没有响应，稍等一下再试。</div>
          <button class="btn mt-3" id="res-retry">重试</button></div>`;
        const b = listBox.querySelector('#res-retry');
        if (b) b.onclick = () => { listBox.innerHTML = skeletonRows(6); load(); };
        return;
      }
      items.length = 0;
      for (const it of (Array.isArray(list) ? list : [])) items.push(it);
      const valid = new Set(items.map((i) => i.path));
      for (const p of [...selected]) if (!valid.has(p)) selected.delete(p);
      renderList();
      renderBatch();
    }

    function visibleItems() {
      let arr = items.filter((it) => filterKind === 'all' || it.kind === filterKind);
      if (query) {
        arr = arr.filter((it) =>
          String(it.name || '').toLowerCase().includes(query) || String(it.path || '').toLowerCase().includes(query));
      }
      const dir = sortBy.endsWith('asc') ? 1 : -1;
      const key = sortBy.startsWith('time') ? 'mtime' : 'size';
      return [...arr].sort((a, b) => ((Number(a[key]) || 0) - (Number(b[key]) || 0)) * dir);
    }

    function renderList() {
      const listBox = el.querySelector('#res-list');
      if (!listBox) return;
      if (!items.length) {
        listBox.innerHTML = emptyState({
          icon: '🗃️',
          title: '没有找到任何资源',
          text: '安装模组、资源包、光影或存档后，它们会自动出现在这里统一管理。',
          actionsHtml: '<button class="btn primary" id="res-go-inst">去实例页看看</button>',
        });
        const b = listBox.querySelector('#res-go-inst');
        if (b) b.onclick = () => { location.hash = '/instances'; };
        return;
      }
      const arr = visibleItems();
      if (!arr.length) {
        listBox.innerHTML = emptyState({
          icon: '🔍',
          title: '没有符合条件的资源',
          text: '换个筛选类型或搜索关键词试试。',
          actionsHtml: '<button class="btn" id="res-clear-filter">清除筛选</button>',
        });
        const b = listBox.querySelector('#res-clear-filter');
        if (b) b.onclick = () => {
          filterKind = 'all'; query = '';
          const si = el.querySelector('#res-search'); if (si) si.value = '';
          el.querySelectorAll('#res-tabs .tab').forEach((x) => x.classList.toggle('active', x.dataset.k === 'all'));
          renderList();
        };
        return;
      }
      listBox.innerHTML = arr.map((it) => {
        const km = kindMeta(it.kind);
        const badges = [
          `<span class="badge" style="flex:0 0 auto">${km.label}</span>`,
          it.instanceName ? `<span class="badge accent ellipsis" style="flex:0 0 auto;max-width:150px">🏠 ${escapeHtml(it.instanceName)}</span>` : '',
          TOGGLE_KINDS.includes(it.kind) ? `<span class="badge ${it.enabled ? 'ok' : ''}" style="flex:0 0 auto">${it.enabled ? '已启用' : '已停用'}</span>` : '',
        ].join('');
        const checked = selected.has(it.path) ? 'checked' : '';
        return `<label class="list-row res-row" data-path="${escapeHtml(it.path)}">
          <input type="checkbox" class="res-check" ${checked}>
          <div class="row-icon">${km.icon}</div>
          <div class="col" style="gap:1px;min-width:0;flex:1">
            <div class="row" style="gap:8px"><span class="bold ellipsis">${escapeHtml(it.name || baseName(it.path))}</span>${badges}</div>
            <span class="tiny muted-3 ellipsis">${escapeHtml(it.path)}</span>
          </div>
          <span class="small muted-3" style="flex:0 0 auto;width:76px;text-align:right">${fmtSize(it.size)}</span>
          <span class="small muted-3" style="flex:0 0 auto;width:118px;text-align:right">${fmtTime(it.mtime)}</span>
        </label>`;
      }).join('');
      listBox.querySelectorAll('.res-check').forEach((cb) => {
        cb.addEventListener('change', () => {
          const row = cb.closest('.res-row');
          if (!row) return;
          if (cb.checked) selected.add(row.dataset.path);
          else selected.delete(row.dataset.path);
          renderBatch();
        });
      });
    }

    function renderBatch() {
      const box = el.querySelector('#res-batch');
      if (!box) return;
      const n = selected.size;
      if (!n) { box.innerHTML = ''; return; }
      box.innerHTML = `<div class="card res-batchbar row wrap" style="gap:8px">
        <span class="bold">已选中 ${n} 项</span>
        <div class="spacer"></div>
        <button class="btn sm danger" id="rb-del">批量删除</button>
        <button class="btn sm" id="rb-undo">撤销删除</button>
        <button class="btn sm" id="rb-export">批量导出</button>
        <button class="btn sm" id="rb-move">批量移动到实例</button>
        <button class="btn ghost sm" id="rb-clear">取消选择</button>
      </div>`;
      box.querySelector('#rb-del').onclick = batchDelete;
      box.querySelector('#rb-undo').onclick = undoDelete;
      box.querySelector('#rb-export').onclick = batchExport;
      box.querySelector('#rb-move').onclick = batchMove;
      box.querySelector('#rb-clear').onclick = () => { selected.clear(); renderList(); renderBatch(); };
    }

    async function batchDelete() {
      const paths = [...selected];
      const ok = await confirmDialog('删除所选资源',
        `将删除选中的 ${paths.length} 项资源。删除的资源会移入启动器回收站，可以撤销。确定删除吗？`,
        { danger: true, okLabel: '删除' });
      if (!ok) return;
      try {
        await api.resources.delete({ paths });
        toast(`已删除 ${paths.length} 项资源，误删可点「撤销删除」找回`, 'ok');
        selected.clear();
        await load();
      } catch (e) {
        toast(`删除失败：${errMsg(e)}`, 'error');
      }
    }

    async function undoDelete() {
      try {
        await api.resources.undoDelete();
        toast('已撤销上一次删除', 'ok');
        await load();
      } catch (e) {
        toast(`撤销失败：${errMsg(e)}`, 'error');
      }
    }

    async function batchExport() {
      const paths = [...selected];
      let dir;
      try { dir = await api.pick.dir({ title: '选择导出到哪个文件夹' }); }
      catch (e) { toast(`无法打开文件夹选择器：${errMsg(e)}`, 'error'); return; }
      if (!dir) return;
      try {
        await api.resources.export({ paths, destDir: dir });
        toast(`已把 ${paths.length} 项资源导出到所选文件夹`, 'ok');
      } catch (e) {
        toast(`导出失败：${errMsg(e)}`, 'error');
      }
    }

    async function batchMove() {
      const paths = [...selected];
      let instances;
      try { instances = await api.instances.list(); }
      catch (e) { toast(`实例列表加载失败：${errMsg(e)}`, 'error'); return; }
      instances = Array.isArray(instances) ? instances : [];
      if (!instances.length) {
        toast('还没有游戏实例。先去「实例」页创建一个，再来移动资源。', 'warn', 4500);
        return;
      }
      const counts = {};
      for (const p of paths) {
        const it = items.find((x) => x.path === p);
        if (it && KIND_META[it.kind]) counts[it.kind] = (counts[it.kind] || 0) + 1;
      }
      const defKind = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'mod';
      const kindOpts = ['mod', 'resourcepack', 'shaderpack', 'world', 'skin'];
      let instSel = null, kindSel = null;
      const ok = await showDialog({
        title: '批量移动到实例',
        body: `
          <label class="field"><span class="field-label">目标实例</span>
            <select class="input" id="mv-inst">${instances.map((i) =>
              `<option value="${escapeHtml(i.id)}">${escapeHtml(i.name || i.id)}${i.versionId ? `（${escapeHtml(String(i.versionId))}）` : ''}</option>`).join('')}</select>
          </label>
          <label class="field"><span class="field-label">放入实例的哪个目录</span>
            <select class="input" id="mv-kind">${kindOpts.map((k) =>
              `<option value="${k}" ${k === defKind ? 'selected' : ''}>${KIND_META[k].label}</option>`).join('')}</select>
          </label>
          <div class="field-hint">移动后这些文件会出现在所选实例的对应文件夹中，同名文件会被覆盖。</div>`,
        actions: [{ label: '取消', value: false }, { label: '移动', value: true, primary: true }],
        onMount(mask) {
          instSel = mask.querySelector('#mv-inst');
          kindSel = mask.querySelector('#mv-kind');
        },
      });
      if (!ok || !instSel || !kindSel) return;
      try {
        await api.resources.moveToInstance({ paths, instanceId: instSel.value, kind: kindSel.value });
        const inst = instances.find((i) => i.id === instSel.value);
        toast(`已把 ${paths.length} 项资源移动到实例「${inst?.name || '所选实例'}」`, 'ok');
        selected.clear();
        await load();
      } catch (e) {
        toast(`移动失败：${errMsg(e)}`, 'error');
      }
    }

    async function cleanUnused() {
      const btn = el.querySelector('#res-clean');
      if (btn) btn.disabled = true;
      let list;
      try { list = await api.resources.cleanScan(); }
      catch (e) {
        if (btn) btn.disabled = false;
        toast(`扫描未使用资源失败：${errMsg(e)}`, 'error');
        return;
      }
      if (btn) btn.disabled = false;
      list = Array.isArray(list) ? list : [];
      if (!list.length) {
        toast('检查完了：所有资源都在被使用，没有需要清理的文件', 'ok');
        return;
      }
      const picked = new Set(list.map((x) => x.path));
      await showDialog({
        title: '清理未使用资源',
        wide: true,
        body: `
          <div class="small muted mb-2">扫描到 ${list.length} 个文件，这些文件没有被任何实例使用。勾选你想删除的文件：</div>
          <div class="row mb-2" style="gap:8px">
            <button class="btn sm" id="cl-all">全选</button>
            <button class="btn sm" id="cl-invert">反选</button>
            <span class="small muted-3" id="cl-count"></span>
          </div>
          <div class="col" id="cl-list" style="gap:2px;max-height:46vh;overflow:auto">
            ${list.map((it) => `<label class="list-row" style="padding:6px 8px">
                <input type="checkbox" class="cl-check" data-path="${escapeHtml(it.path)}" checked>
                <div class="row-icon">${kindMeta(it.kind).icon}</div>
                <div class="col" style="gap:1px;min-width:0;flex:1">
                  <span class="small bold ellipsis">${escapeHtml(it.name || baseName(it.path))}</span>
                  <span class="tiny muted-3 ellipsis">${escapeHtml(it.path)}</span>
                </div>
                <span class="tiny muted-3" style="flex:0 0 auto">${fmtSize(it.size)}</span>
              </label>`).join('')}
          </div>`,
        actions: [{ label: '取消', value: false }],
        onMount(mask, close) {
          const listBox = mask.querySelector('#cl-list');
          const count = mask.querySelector('#cl-count');
          const upd = () => { count.textContent = `已选 ${picked.size} / ${list.length} 项`; };
          listBox.addEventListener('change', (e) => {
            const cb = e.target.closest('.cl-check');
            if (!cb) return;
            if (cb.checked) picked.add(cb.dataset.path); else picked.delete(cb.dataset.path);
            upd();
          });
          mask.querySelector('#cl-all').onclick = () => {
            listBox.querySelectorAll('.cl-check').forEach((cb) => { cb.checked = true; picked.add(cb.dataset.path); });
            upd();
          };
          mask.querySelector('#cl-invert').onclick = () => {
            listBox.querySelectorAll('.cl-check').forEach((cb) => {
              cb.checked = !cb.checked;
              if (cb.checked) picked.add(cb.dataset.path); else picked.delete(cb.dataset.path);
            });
            upd();
          };
          const del = document.createElement('button');
          del.className = 'btn danger';
          del.textContent = '删除所选';
          del.onclick = async () => {
            if (!picked.size) { toast('请先勾选要删除的文件', 'warn'); return; }
            const yes = await confirmDialog('删除未使用资源',
              `将删除选中的 ${picked.size} 个文件。删除的资源会移入启动器回收站，可以撤销。`,
              { danger: true, okLabel: '删除' });
            if (!yes) return;
            try {
              await api.resources.delete({ paths: [...picked] });
              toast(`已删除 ${picked.size} 个未使用文件，误删可撤销`, 'ok');
              close(true);
              load();
            } catch (e) {
              toast(`删除失败：${errMsg(e)}`, 'error');
            }
          };
          mask.querySelector('.dialog-actions').prepend(del);
          upd();
        },
      });
    }

    await load();
  },
};
