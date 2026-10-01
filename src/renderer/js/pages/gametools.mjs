// 游戏工具：截图 / 实时日志 / 快捷指令（内部三个标签页）
import { api, on } from '../api.js';
import { toast, confirmDialog, showDialog, emptyState, skeletonRows, setBreadcrumb, escapeHtml } from '../ui.js';

let pageCleanups = [];
let tabCleanups = [];
function addPageCleanup(fn) { pageCleanups.push(fn); }
function addTabCleanup(fn) { tabCleanups.push(fn); }
function runPageCleanups() { for (const f of pageCleanups) { try { f(); } catch { /* 忽略 */ } } pageCleanups = []; }
function runTabCleanups() { for (const f of tabCleanups) { try { f(); } catch { /* 忽略 */ } } tabCleanups = []; }
function sub(ch, cb, tabLevel = false) {
  try {
    const off = on(ch, cb);
    if (typeof off === 'function') (tabLevel ? addTabCleanup : addPageCleanup)(off);
  } catch { /* 忽略 */ }
}
function errMsg(e) { const m = e && e.message ? String(e.message) : String(e || ''); return m || '未知错误'; }
function fmtTime(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return '未知时间';
  try { return new Date(n).toLocaleString('zh-CN'); } catch { return '未知时间'; }
}
function fmtSize(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '';
  if (v >= 1024 * 1024) return (v / 1048576).toFixed(1) + ' MB';
  if (v >= 1024) return Math.round(v / 1024) + ' KB';
  return v + ' B';
}
function sortByRecent(list) {
  return (Array.isArray(list) ? list : []).slice().sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
}
function instLabel(i) {
  const loader = i.loader && i.loader !== 'vanilla' ? ` · ${i.loader}` : '';
  return `${i.name}（${i.versionId || '未知版本'}${loader}）`;
}

function ensureStyle() {
  if (document.getElementById('gt-style')) return;
  const s = document.createElement('style');
  s.id = 'gt-style';
  s.textContent = `
    .gt-shot-grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap:12px; }
    .gt-shot { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; cursor: pointer; transition: transform .12s, border-color .12s; }
    .gt-shot:hover { transform: translateY(-2px); border-color: var(--fg-3); }
    .gt-shot img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; display: block; background: var(--card-2); }
    .gt-shot .meta { padding: 8px 10px; display: flex; flex-direction: column; gap: 2px; }
    .gt-bigimg { max-width: 100%; max-height: 58vh; object-fit: contain; border-radius: 8px; display: block; margin: 0 auto; background: var(--card-2); }
    .gt-logbox { height: 52vh; overflow: auto; background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 10px 12px; }
    .gt-cmd-row { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--card); }
  `;
  document.head.appendChild(s);
}

export default [
  {
    id: 'gametools',
    title: '游戏工具',
    icon: '📸',
    routes: ['/gametools'],
    order: 10,
    async render(el, ctx) {
      runPageCleanups();
      runTabCleanups();
      ensureStyle();
      setBreadcrumb([{ label: '主页', onClick() { location.hash = '/'; } }, { label: '游戏工具' }]);

      const TABS = [
        { id: 'screenshots', label: '截图' },
        { id: 'logs', label: '实时日志' },
        { id: 'commands', label: '快捷指令' },
      ];
      const state = {
        tab: ['screenshots', 'logs', 'commands'].includes(ctx?.params?.[0]) ? ctx.params[0] : 'screenshots',
        instances: null,   // null = 加载失败
      };

      el.innerHTML = `
        <div class="col mb-3" style="gap:2px">
          <div class="bold" style="font-size:17px">游戏工具</div>
          <div class="small muted">截图管理、运行日志和常用指令，玩游戏的顺手小工具都在这里。</div>
        </div>
        <div class="tabs mt-3" role="tablist">
          ${TABS.map((t) => `<button class="tab" role="tab" data-tab="${t.id}" aria-selected="false">${escapeHtml(t.label)}</button>`).join('')}
        </div>
        <div id="gt-tab-body">${skeletonRows(3)}</div>`;

      const $ = (sel) => el.querySelector(sel);

      function paintTabs() {
        for (const b of el.querySelectorAll('[data-tab]')) {
          const active = b.dataset.tab === state.tab;
          b.classList.toggle('active', active);
          b.setAttribute('aria-selected', active ? 'true' : 'false');
        }
      }

      async function reloadInstances() {
        try {
          const list = await api.instances.list();
          state.instances = sortByRecent(list);
        } catch (e) {
          state.instances = null;
        }
      }

      async function renderTab() {
        runTabCleanups();
        paintTabs();
        const body = $('#gt-tab-body');
        if (!body) return;
        if (state.instances === null) {
          body.innerHTML = `<div class="card"><div class="bold">实例列表加载失败</div>
            <div class="small muted mt-1">发生了什么：获取实例列表时出错了，可能是后台暂时没有响应。</div>
            <div class="small muted mt-1">可以点「重试」再试一次。</div>
            <button class="btn mt-3" id="gt-inst-retry">重试</button></div>`;
          const b = body.querySelector('#gt-inst-retry');
          if (b) b.onclick = async () => { body.innerHTML = skeletonRows(3); await reloadInstances(); renderTab(); };
          return;
        }
        if (state.tab === 'screenshots') await tabScreenshots(body);
        else if (state.tab === 'logs') await tabLogs(body);
        else await tabCommands(body);
      }

      for (const b of el.querySelectorAll('[data-tab]')) {
        b.onclick = () => { if (state.tab !== b.dataset.tab) { state.tab = b.dataset.tab; renderTab(); } };
      }

      /* ================= 截图 ================= */
      async function tabScreenshots(body) {
        const filterId = body.dataset.ssFilter || '';
        body.innerHTML = `
          <div class="row mb-3">
            <select class="input sm" id="gt-ss-filter" style="width:auto;min-width:180px" aria-label="按实例筛选截图">
              <option value="">全部实例</option>
              ${state.instances.map((i) => `<option value="${escapeHtml(i.id)}">${escapeHtml(i.name)}</option>`).join('')}
            </select>
            <span class="spacer"></span>
            <button class="btn sm" id="gt-ss-refresh">刷新</button>
          </div>
          <div id="gt-ss-grid">${skeletonRows(3)}</div>`;
        const filterSel = body.querySelector('#gt-ss-filter');
        filterSel.value = filterId;
        filterSel.onchange = () => { body.dataset.ssFilter = filterSel.value; load(); };
        body.querySelector('#gt-ss-refresh').onclick = () => load();

        async function load() {
          const grid = body.querySelector('#gt-ss-grid');
          if (!grid) return;
          grid.innerHTML = skeletonRows(3);
          const instanceId = (body.dataset.ssFilter || '').trim();
          let shots = null, err = null;
          try { shots = await api.gametools.screenshots(instanceId ? { instanceId } : {}); }
          catch (e) { err = e; }
          if (!grid.isConnected) return;
          if (shots === null) {
            grid.innerHTML = `<div class="card"><div class="bold">截图列表加载失败</div>
              <div class="small muted mt-1">发生了什么：${escapeHtml(errMsg(err))}</div>
              <button class="btn mt-3" id="gt-ss-retry">重试</button></div>`;
            const b = grid.querySelector('#gt-ss-retry');
            if (b) b.onclick = () => load();
            return;
          }
          if (!shots.length) {
            grid.innerHTML = emptyState({
              icon: '📷',
              title: '还没有截图',
              text: instanceId
                ? '这个实例还没有截图。在游戏里按 F2 截图，就会出现在这里。'
                : '在游戏里按 F2 截图，就会出现在这里。',
              actionsHtml: '<button class="btn" id="gt-ss-empty-refresh">刷新看看</button>',
            });
            const b = grid.querySelector('#gt-ss-empty-refresh');
            if (b) b.onclick = () => load();
            return;
          }
          grid.innerHTML = `<div class="gt-shot-grid">${shots.map((s, idx) => `
            <div class="gt-shot" data-idx="${idx}" role="button" tabindex="0" aria-label="查看截图 ${escapeHtml(s.file || '')}">
              <img src="${escapeHtml(s.url || '')}" alt="截图：${escapeHtml(s.file || '')}" loading="lazy">
              <div class="meta">
                <span class="tiny bold ellipsis">${escapeHtml(s.file || '未命名截图')}</span>
                <span class="tiny muted-3 ellipsis">${escapeHtml(s.instanceName || '未知实例')}${s.size ? ' · ' + escapeHtml(fmtSize(s.size)) : ''}</span>
                <span class="tiny muted-3">${escapeHtml(fmtTime(s.time))}</span>
              </div>
            </div>`).join('')}</div>`;
          const openShot = (s) => openScreenshotDialog(s, () => load());
          for (const card of grid.querySelectorAll('.gt-shot')) {
            const s = shots[Number(card.dataset.idx)];
            card.onclick = () => openShot(s);
            card.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openShot(s); } };
          }
        }
        await load();
      }

      async function openScreenshotDialog(shot, refresh) {
        if (!shot) return;
        const meta = `<div class="small muted mt-2">${escapeHtml(shot.file || '')} · ${escapeHtml(shot.instanceName || '未知实例')}${shot.size ? ' · ' + escapeHtml(fmtSize(shot.size)) : ''} · ${escapeHtml(fmtTime(shot.time))}</div>`;
        const act = await showDialog({
          title: '截图详情',
          wide: true,
          body: `<img class="gt-bigimg" src="${escapeHtml(shot.url || '')}" alt="截图大图：${escapeHtml(shot.file || '')}">${meta}`,
          actions: [
            { label: '设为实例封面', value: 'cover' },
            { label: '导出到文件夹…', value: 'export', primary: true },
            { label: '关闭', value: null },
          ],
        });
        if (act === 'export') {
          let dir = null;
          try { dir = await api.pick.dir({ title: '选择截图导出到哪个文件夹' }); }
          catch (e) { toast(`打开文件夹选择器失败：${errMsg(e)}`, 'error'); return; }
          if (!dir) return;
          try {
            const r = await api.gametools.exportScreenshots({ paths: [shot.path], destDir: dir });
            toast(`已导出 ${r && r.count != null ? r.count : 1} 张截图到所选文件夹`, 'ok');
          } catch (e) {
            toast(`导出失败：${errMsg(e)}`, 'error', 5000);
          }
        } else if (act === 'cover') {
          if (!shot.instanceId) { toast('这张截图没有关联到实例，无法设为封面', 'warn'); return; }
          const inst = state.instances.find((i) => i.id === shot.instanceId);
          const ok = await confirmDialog('设为实例封面',
            `把「${shot.file || '这张截图'}」设为「${inst ? inst.name : '当前实例'}」的封面，会替换原有封面（如有）。`,
            { okLabel: '设为封面' });
          if (!ok) return;
          try {
            await api.gametools.setCover({ instanceId: shot.instanceId, path: shot.path });
            toast('已设为封面', 'ok');
            if (refresh) refresh();
          } catch (e) {
            toast(`设置封面失败：${errMsg(e)}`, 'error', 5000);
          }
        }
      }

      /* ================= 实时日志 ================= */
      async function tabLogs(body) {
        let devMode = null;
        try { const s = await api.settings.get(); devMode = !!(s && s.devMode); }
        catch (e) { devMode = null; }

        if (devMode === null) {
          body.innerHTML = `<div class="card"><div class="bold">设置读取失败</div>
            <div class="small muted mt-1">发生了什么：读取设置时出错了，暂时无法判断开发者模式是否开启。</div>
            <button class="btn mt-3" id="gt-log-retry0">重试</button></div>`;
          const b = body.querySelector('#gt-log-retry0');
          if (b) b.onclick = () => renderTab();
          return;
        }
        if (!devMode) {
          body.innerHTML = emptyState({
            icon: '🧪',
            title: '实时日志需要开启开发者模式',
            text: '实时日志需要开启开发者模式（设置→高级）。开启后这里会显示游戏最近一次运行的日志，方便排查卡顿和报错。',
            actionsHtml: `<button class="btn primary" id="gt-log-enable">一键开启开发者模式</button>
              <button class="btn" id="gt-log-goset">前往设置看看</button>`,
          });
          const en = body.querySelector('#gt-log-enable');
          if (en) en.onclick = async () => {
            en.disabled = true;
            try {
              await api.settings.set({ devMode: true });
              toast('已开启开发者模式，正在加载日志…', 'ok');
              renderTab();
            } catch (e) {
              en.disabled = false;
              toast(`开启失败：${errMsg(e)}。也可以到 设置→高级 里手动打开。`, 'error', 6000);
            }
          };
          const go = body.querySelector('#gt-log-goset');
          if (go) go.onclick = () => { location.hash = '/settings'; };
          return;
        }
        if (!state.instances.length) {
          body.innerHTML = emptyState({
            icon: '🗂️',
            title: '还没有实例',
            text: '创建一个游戏实例并启动一次后，日志就会出现在这里。',
            actionsHtml: '<button class="btn primary" id="gt-log-gocreate">去创建第一个实例</button>',
          });
          const b = body.querySelector('#gt-log-gocreate');
          if (b) b.onclick = () => { location.hash = '/instances'; };
          return;
        }

        const keepId = body.dataset.logInst || '';
        const defaultId = state.instances.some((i) => i.id === keepId) ? keepId : (state.instances[0] ? state.instances[0].id : '');
        body.innerHTML = `
          <div class="row mb-3" style="flex-wrap:wrap">
            <select class="input sm" id="gt-log-inst" style="width:auto;min-width:180px" aria-label="选择要查看日志的实例">
              ${state.instances.map((i) => `<option value="${escapeHtml(i.id)}">${escapeHtml(instLabel(i))}</option>`).join('')}
            </select>
            <input class="input sm" id="gt-log-search" type="search" placeholder="搜索日志关键词，如 ERROR" style="width:220px" aria-label="搜索日志">
            <span class="spacer"></span>
            <span class="tiny muted-3">每 4 秒自动刷新</span>
            <button class="btn sm" id="gt-log-refresh">立即刷新</button>
          </div>
          <div id="gt-log-meta" class="tiny muted mb-2"></div>
          <div class="gt-logbox console" id="gt-log-box" aria-live="off"><div class="small muted">正在读取日志…</div></div>`;

        const instSel = body.querySelector('#gt-log-inst');
        instSel.value = defaultId;
        body.dataset.logInst = defaultId;
        instSel.onchange = () => { body.dataset.logInst = instSel.value; load(); };
        body.querySelector('#gt-log-refresh').onclick = () => load();
        const searchInput = body.querySelector('#gt-log-search');
        let rawLines = [];
        searchInput.oninput = () => paintLines();

        function levelOf(line) {
          if (line.includes('ERROR')) return 'lv-error';
          if (line.includes('WARN')) return 'lv-warn';
          return 'lv-info';
        }
        function paintLines() {
          const box = body.querySelector('#gt-log-box');
          const meta = body.querySelector('#gt-log-meta');
          if (!box || !box.isConnected) return;
          const kw = (searchInput.value || '').trim().toLowerCase();
          const last200 = rawLines.slice(-200);
          const shown = kw ? last200.filter((l) => l.toLowerCase().includes(kw)) : last200;
          meta.textContent = kw
            ? `按「${searchInput.value.trim()}」过滤：${shown.length} 行（原始日志最后 ${last200.length} 行，全文 ${rawLines.length} 行）`
            : `显示最后 ${last200.length} 行（全文共 ${rawLines.length} 行）`;
          if (!rawLines.length) {
            box.innerHTML = `<div class="small muted" style="padding:20px;text-align:center">还没有日志。启动一次游戏，日志就会出现在这里。</div>`;
            return;
          }
          if (!shown.length) {
            box.innerHTML = `<div class="small muted" style="padding:20px;text-align:center">没有包含「${escapeHtml(searchInput.value.trim())}」的日志行。</div>`;
            return;
          }
          const nearBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 40;
          box.innerHTML = shown.map((l) => `<div class="${levelOf(l)}">${escapeHtml(l) || '&nbsp;'}</div>`).join('');
          if (nearBottom) box.scrollTop = box.scrollHeight;
        }

        async function load() {
          const box = body.querySelector('#gt-log-box');
          if (!box || !box.isConnected) return;
          const instanceId = body.dataset.logInst;
          let r = null, err = null;
          try { r = await api.dev.fullDiagnose({ instanceId }); }
          catch (e) { err = e; }
          if (!box.isConnected) return;
          if (r === null) {
            if (err && /开发者模式/.test(errMsg(err))) {
              box.innerHTML = `<div class="small" style="padding:20px;text-align:center">开发者模式刚刚被关闭了。到 设置→高级 重新打开即可继续查看。</div>`;
            } else {
              box.innerHTML = `<div style="padding:20px;text-align:center">
                <div class="small" style="color:var(--err)">日志读取失败：${escapeHtml(errMsg(err))}</div>
                <button class="btn sm mt-3" id="gt-log-retry">重试</button></div>`;
              const b = box.querySelector('#gt-log-retry');
              if (b) b.onclick = () => load();
            }
            return;
          }
          const logs = String((r && r.logs) || '');
          rawLines = logs ? logs.split(/\r?\n/) : [];
          paintLines();
        }

        await load();
        const timer = setInterval(() => {
          if (!body.isConnected) return;
          if (document.activeElement === searchInput) return; // 正在输入时不打扰
          load();
        }, 4000);
        addTabCleanup(() => clearInterval(timer));
      }

      /* ================= 快捷指令 ================= */
      const COMMAND_DESC = '保存常用的游戏内指令（如 /give、/tp），游戏运行时点一下即可复制到剪贴板，在游戏聊天框粘贴使用。';
      function normalizeCmd(it) {
        return {
          cmd: String((it && (it.cmd ?? it.command ?? it.text)) || '').trim(),
          note: String((it && (it.note ?? it.remark ?? it.desc)) || '').trim(),
        };
      }

      async function tabCommands(body) {
        if (!state.instances.length) {
          body.innerHTML = emptyState({
            icon: '🗂️',
            title: '还没有实例',
            text: '快捷指令保存在每个实例里，先创建一个实例吧。',
            actionsHtml: '<button class="btn primary" id="gt-cmd-gocreate">去创建第一个实例</button>',
          });
          const b = body.querySelector('#gt-cmd-gocreate');
          if (b) b.onclick = () => { location.hash = '/instances'; };
          return;
        }
        const keepId = body.dataset.cmdInst || '';
        const defaultId = state.instances.some((i) => i.id === keepId) ? keepId : (state.instances[0] ? state.instances[0].id : '');
        body.innerHTML = `
          <div class="small muted mb-3">${escapeHtml(COMMAND_DESC)}</div>
          <div class="row mb-3" style="flex-wrap:wrap">
            <select class="input sm" id="gt-cmd-inst" style="width:auto;min-width:180px" aria-label="选择实例">
              ${state.instances.map((i) => `<option value="${escapeHtml(i.id)}">${escapeHtml(instLabel(i))}</option>`).join('')}
            </select>
          </div>
          <div class="card mb-3">
            <div class="row" style="flex-wrap:wrap">
              <input class="input" id="gt-cmd-new" placeholder="输入指令，例如：/give @p diamond 64" style="flex:2;min-width:220px" aria-label="新指令">
              <input class="input" id="gt-cmd-note" placeholder="备注（可选），例如：给自己发一组钻石" style="flex:1;min-width:180px" aria-label="指令备注">
              <button class="btn primary" id="gt-cmd-add">添加</button>
            </div>
          </div>
          <div id="gt-cmd-list">${skeletonRows(2)}</div>`;

        const instSel = body.querySelector('#gt-cmd-inst');
        instSel.value = defaultId;
        body.dataset.cmdInst = defaultId;
        instSel.onchange = () => { body.dataset.cmdInst = instSel.value; load(); };
        const cmdInput = body.querySelector('#gt-cmd-new');
        const noteInput = body.querySelector('#gt-cmd-note');

        async function saveCommands(instanceId, commands) {
          await api.gametools.saveQuickCommands({ instanceId, commands });
        }

        async function load() {
          const list = body.querySelector('#gt-cmd-list');
          if (!list || !list.isConnected) return;
          list.innerHTML = skeletonRows(2);
          const instanceId = body.dataset.cmdInst;
          let raw = null, err = null;
          try { raw = await api.gametools.quickCommands({ instanceId }); }
          catch (e) { err = e; }
          if (!list.isConnected) return;
          if (raw === null) {
            list.innerHTML = `<div class="card"><div class="bold">快捷指令加载失败</div>
              <div class="small muted mt-1">发生了什么：${escapeHtml(errMsg(err))}</div>
              <button class="btn mt-3" id="gt-cmd-retry">重试</button></div>`;
            const b = list.querySelector('#gt-cmd-retry');
            if (b) b.onclick = () => load();
            return;
          }
          const cmds = (Array.isArray(raw) ? raw : []).map(normalizeCmd).filter((c) => c.cmd);
          if (!cmds.length) {
            list.innerHTML = emptyState({
              icon: '⌨️',
              title: '还没有快捷指令',
              text: '把常用的 /give、/tp 存在这里，游戏里要用的时候点一下「复制」，到聊天框粘贴发送就行。',
            });
            return;
          }
          list.innerHTML = cmds.map((c, idx) => `
            <div class="gt-cmd-row ${idx > 0 ? 'mt-2' : ''}">
              <span style="flex:0 0 auto">⌨️</span>
              <div class="col" style="gap:2px;flex:1;min-width:0">
                <code class="ellipsis">${escapeHtml(c.cmd)}</code>
                ${c.note ? `<span class="tiny muted ellipsis">${escapeHtml(c.note)}</span>` : ''}
              </div>
              <button class="btn sm" data-copy="${idx}" style="flex:0 0 auto">复制</button>
              <button class="btn sm danger" data-del="${idx}" style="flex:0 0 auto">删除</button>
            </div>`).join('');
          for (const b of list.querySelectorAll('[data-copy]')) {
            b.onclick = () => copyCmd(cmds[Number(b.dataset.copy)]);
          }
          for (const b of list.querySelectorAll('[data-del]')) {
            b.onclick = () => delCmd(cmds[Number(b.dataset.del)]);
          }
        }

        async function copyCmd(c) {
          if (!c || !c.cmd) return;
          try {
            await api.clip.write({ text: c.cmd });
            toast('已复制。进游戏按 T 或 / 打开聊天框，粘贴发送即可', 'ok', 4000);
          } catch (e) {
            try {
              await navigator.clipboard.writeText(c.cmd);
              toast('已复制。进游戏按 T 或 / 打开聊天框，粘贴发送即可', 'ok', 4000);
            } catch {
              toast(`复制失败：${errMsg(e)}。可以选中指令文字后按 Cmd+C 手动复制。`, 'error', 6000);
            }
          }
        }

        async function delCmd(c) {
          const ok = await confirmDialog('删除快捷指令',
            `确定删除「${c.cmd}」吗？删除后需要重新添加。`,
            { danger: true, okLabel: '删除' });
          if (!ok) return;
          const instanceId = body.dataset.cmdInst;
          try {
            const raw2 = await api.gametools.quickCommands({ instanceId });
            const rest = (Array.isArray(raw2) ? raw2 : []).map(normalizeCmd).filter((x) => x.cmd && x.cmd !== c.cmd);
            await saveCommands(instanceId, rest);
            toast('已删除', 'ok');
            load();
          } catch (e) {
            toast(`删除失败：${errMsg(e)}`, 'error', 5000);
          }
        }

        async function addCmd() {
          let cmd = (cmdInput.value || '').trim();
          const note = (noteInput.value || '').trim();
          if (!cmd) { toast('先输入指令内容，例如 /tp ~ ~ ~', 'warn'); return; }
          if (!cmd.startsWith('/')) { cmd = '/' + cmd; toast('游戏指令一般以 / 开头，已帮你补上', 'info'); }
          const instanceId = body.dataset.cmdInst;
          try {
            const raw2 = await api.gametools.quickCommands({ instanceId });
            const cmds = (Array.isArray(raw2) ? raw2 : []).map(normalizeCmd).filter((x) => x.cmd);
            if (cmds.some((x) => x.cmd === cmd)) { toast('这条指令已经存在了', 'warn'); return; }
            cmds.push({ cmd, note });
            await saveCommands(instanceId, cmds);
            cmdInput.value = '';
            noteInput.value = '';
            toast('已添加并保存', 'ok');
            load();
          } catch (e) {
            toast(`保存失败：${errMsg(e)}`, 'error', 5000);
          }
        }

        body.querySelector('#gt-cmd-add').onclick = addCmd;
        cmdInput.onkeydown = (e) => { if (e.key === 'Enter') addCmd(); };
        await load();
      }

      /* ---------- 启动 ---------- */
      await reloadInstances();
      await renderTab();

      // 实例变化（新建/删除/换封面等）后刷新列表与当前标签页
      sub('bb:instances-changed', async () => {
        await reloadInstances();
        await renderTab();
      });
    },
  },
];
