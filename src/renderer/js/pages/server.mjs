// 服务器：列表/创建（#/server） + 控制台子页（#/server/:id，不出现在导航）
import { api, on } from '../api.js';
import { toast, confirmDialog, showDialog, emptyState, skeletonRows, setBreadcrumb, escapeHtml } from '../ui.js';

let cleanups = [];
function addCleanup(fn) { cleanups.push(fn); }
function runCleanups() { for (const f of cleanups) { try { f(); } catch { /* 忽略 */ } } cleanups = []; }
function sub(ch, cb) { try { const off = on(ch, cb); if (typeof off === 'function') addCleanup(off); } catch { /* 忽略 */ } }
function errMsg(e) { const m = e && e.message ? String(e.message) : String(e || ''); return m || '未知错误'; }
// 未实现的后台路由降级为友好文案
function friendlyErr(e) {
  const m = errMsg(e);
  return /接通中|__unimplemented/.test(m) ? '该功能需要较新版本支持' : m;
}

/* ---------- 服务器设置（server.properties） ---------- */
async function openPropsDialog(id, onSaved) {
  let props = null;
  try {
    const d = await api.servers.detail({ id });
    if (d && d.props && typeof d.props === 'object') props = d.props;
  } catch { /* 拿不到 props 就用默认表单 */ }
  const gv = (k, def) => (props && props[k] != null && props[k] !== '' ? String(props[k]) : def);
  await showDialog({
    title: '服务器设置',
    wide: true,
    body: `
      <label class="field"><span class="field-label">端口</span>
        <input class="input" id="sp-port" type="number" min="1024" max="65535" value="${escapeHtml(gv('server-port', '25565'))}"></label>
      <label class="field"><span class="field-label">视距（区块数，数字越大看得越远、越吃性能）</span>
        <input class="input" id="sp-view" type="number" min="3" max="32" value="${escapeHtml(gv('view-distance', '10'))}"></label>
      <label class="field"><span class="field-label">正版验证</span>
        <select class="input" id="sp-online">
          <option value="true">开启（只有正版账号能进入）</option>
          <option value="false">关闭（离线账号也能进入）</option>
        </select></label>
      <label class="field"><span class="field-label">难度</span>
        <select class="input" id="sp-diff">
          <option value="peaceful">和平</option>
          <option value="easy">简单</option>
          <option value="normal">普通</option>
          <option value="hard">困难</option>
        </select></label>
      <label class="field"><span class="field-label">游戏模式</span>
        <select class="input" id="sp-gamemode">
          <option value="survival">生存</option>
          <option value="creative">创造</option>
          <option value="adventure">冒险</option>
        </select></label>
      <label class="field"><span class="field-label">最大玩家数</span>
        <input class="input" id="sp-max" type="number" min="1" max="999" value="${escapeHtml(gv('max-players', '20'))}"></label>
      <label class="field"><span class="field-label">白名单</span>
        <select class="input" id="sp-white">
          <option value="false">关闭（任何人都能进入）</option>
          <option value="true">开启（只有白名单里的玩家能进入）</option>
        </select></label>
      <div class="field-hint">设置会写入服务器的 server.properties，重启服务器后生效。</div>`,
    actions: [{ label: '取消', value: null }],
    onMount(mask, close) {
      const portInput = mask.querySelector('#sp-port');
      const viewInput = mask.querySelector('#sp-view');
      const maxInput = mask.querySelector('#sp-max');
      const pick = (sel, key, def) => {
        const v = gv(key, def);
        sel.value = [...sel.options].some((o) => o.value === v) ? v : def;
      };
      const onlineSel = mask.querySelector('#sp-online');
      const diffSel = mask.querySelector('#sp-diff');
      const gmSel = mask.querySelector('#sp-gamemode');
      const whiteSel = mask.querySelector('#sp-white');
      pick(onlineSel, 'online-mode', 'true');
      pick(diffSel, 'difficulty', 'easy');
      pick(gmSel, 'gamemode', 'survival');
      pick(whiteSel, 'white-list', 'false');

      const saveBtn = document.createElement('button');
      saveBtn.className = 'btn primary';
      saveBtn.textContent = '保存';
      saveBtn.onclick = async () => {
        const port = Number(portInput.value);
        if (!Number.isInteger(port) || port < 1024 || port > 65535) {
          toast('端口需要在 1024 - 65535 之间', 'warn');
          portInput.focus();
          return;
        }
        const propsOut = {
          'server-port': String(port),
          'view-distance': String(Math.max(3, Math.min(32, Number(viewInput.value) || 10))),
          'online-mode': onlineSel.value,
          'difficulty': diffSel.value,
          'gamemode': gmSel.value,
          'max-players': String(Math.max(1, Number(maxInput.value) || 20)),
          'white-list': whiteSel.value,
        };
        saveBtn.disabled = true;
        saveBtn.textContent = '保存中…';
        try {
          await api.servers.saveProps({ id, props: propsOut });
          close(true);
          toast('服务器设置已保存，重启服务器后生效', 'ok', 4500);
          if (onSaved) onSaved(propsOut);
        } catch (e) {
          saveBtn.disabled = false;
          saveBtn.textContent = '保存';
          toast(`保存失败：${friendlyErr(e)}`, 'error', 5000);
        }
      };
      mask.querySelector('.dialog-actions').appendChild(saveBtn);
      setTimeout(() => portInput.focus(), 50);
    },
  });
}

function loaderLabel(l) {
  const m = { vanilla: '原版', forge: 'Forge', fabric: 'Fabric', quilt: 'Quilt', neoforge: 'NeoForge' };
  const k = String(l || '').toLowerCase();
  return m[k] || (k ? k : '原版');
}

/* ---------- 配置编辑器（按分组的 server.properties 表单） ---------- */
const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
// 把后台返回的 schema 归一成 [{name, items:[{key,name,type,options,recommended,desc}]}]
function normalizePropSchema(schema) {
  const groups = [];
  const pushItem = (gname, it) => {
    if (!it || !it.key) return;
    let grp = groups.find((x) => x.name === gname);
    if (!grp) { grp = { name: gname, items: [] }; groups.push(grp); }
    grp.items.push(it);
  };
  const rawGroups = schema && Array.isArray(schema.groups) ? schema.groups : (Array.isArray(schema) ? schema : []);
  for (const g of rawGroups) {
    if (!isPlain(g)) continue;
    const gname = String(g.group || g.name || g.title || '常规');
    const items = Array.isArray(g.items) ? g.items : (Array.isArray(g.props) ? g.props : []);
    for (const it of items) pushItem(gname, it);
  }
  if (!groups.length && isPlain(schema) && Array.isArray(schema.items)) {
    for (const it of schema.items) pushItem(String((it && it.group) || '常规'), it);
  }
  return groups;
}

async function savePropsOneByOne(id, entries, onProgress) {
  let okN = 0;
  const fails = [];
  for (let i = 0; i < entries.length; i += 1) {
    const [k, v] = entries[i];
    if (onProgress) onProgress(i + 1, entries.length);
    try {
      await api.servers.saveProps({ id, props: { [k]: String(v) } });
      okN += 1;
    } catch (e) { fails.push(`${k}：${friendlyErr(e)}`); }
  }
  return { okN, fails };
}

async function openPropsEditor(id, onSaved) {
  let schema = null;
  try { schema = await api.server.propsSchema(); }
  catch (e) { toast(`配置结构读取失败：${friendlyErr(e)}`, 'error', 5000); return; }
  const groups = normalizePropSchema(schema);
  if (!groups.length) {
    toast('后台没有返回可编辑的配置项，可能需要较新版本的启动器', 'warn', 5000);
    return;
  }
  let props = {};
  try {
    const d = await api.servers.detail({ id });
    if (d && isPlain(d.props)) props = d.props;
  } catch { /* 拿不到当前值就按空处理 */ }
  const orig = {};
  for (const g of groups) for (const it of g.items) orig[it.key] = props[it.key] != null ? String(props[it.key]) : '';
  const allItems = groups.flatMap((g) => g.items);

  const controlHtml = (it) => {
    const cur = orig[it.key] ?? '';
    const type = String(it.type || '').toLowerCase();
    const opts = Array.isArray(it.options) ? it.options : [];
    if (opts.length) {
      const list = opts.map((o) => (isPlain(o)
        ? { v: String(o.value ?? o.v ?? o.key ?? ''), t: String(o.label ?? o.text ?? o.name ?? o.value ?? o.v ?? '') }
        : { v: String(o), t: String(o) }));
      if (cur && !list.some((o) => o.v === cur)) list.unshift({ v: cur, t: `${cur}（当前值）` });
      return `<select class="input pe-ctl" data-key="${escapeHtml(it.key)}">${list.map((o) => `<option value="${escapeHtml(o.v)}" ${o.v === cur ? 'selected' : ''}>${escapeHtml(o.t)}</option>`).join('')}</select>`;
    }
    if (type.includes('bool')) {
      const v = cur === 'true' ? 'true' : 'false';
      return `<select class="input pe-ctl" data-key="${escapeHtml(it.key)}">
        <option value="true" ${v === 'true' ? 'selected' : ''}>开启（true）</option>
        <option value="false" ${v === 'false' ? 'selected' : ''}>关闭（false）</option></select>`;
    }
    const numeric = type.includes('number') || type.includes('int');
    return `<input class="input pe-ctl" data-key="${escapeHtml(it.key)}" type="${numeric ? 'number' : 'text'}" value="${escapeHtml(cur)}" style="min-width:200px">`;
  };

  const itemHtml = (it) => {
    const cur = orig[it.key] ?? '';
    const rec = it.recommended != null && it.recommended !== '' ? String(it.recommended) : '';
    const name = String(it.name || it.label || it.key);
    const desc = String(it.desc || it.description || '');
    return `<div class="pe-item" style="padding:10px 4px; border-bottom:1px solid var(--border)">
      <div class="row wrap" style="gap:8px; align-items:center">
        <span class="small bold">${escapeHtml(name)}</span>
        <code class="tiny muted-3">${escapeHtml(it.key)}</code>
        ${rec ? `<span class="badge ok" data-tip="官方建议值，适合 4-10 人的小服">推荐 ${escapeHtml(rec)}</span>` : ''}
      </div>
      <div class="row wrap mt-1" style="gap:8px; align-items:center">
        ${controlHtml(it)}
        ${rec && cur !== rec ? `<button class="btn ghost sm pe-use" data-key="${escapeHtml(it.key)}" data-rec="${escapeHtml(rec)}">用推荐值</button>` : ''}
      </div>
      ${desc ? `<div class="tiny muted mt-1">${escapeHtml(desc)}</div>` : ''}
    </div>`;
  };

  await showDialog({
    title: '配置编辑器（server.properties）',
    wide: true,
    body: `
      <div class="row wrap mb-2" style="gap:8px">
        <button class="btn sm" id="pe-optimize">⚡ 一键优化（4-10 人小服）</button>
        <span class="tiny muted-3">每项改动会逐条写入配置，重启服务器后生效。</span>
      </div>
      <div style="max-height:56vh; overflow:auto">
        ${groups.map((g) => `
          <div class="section-title" style="margin-top:10px">${escapeHtml(String(g.name))}</div>
          ${g.items.map((it) => itemHtml(it)).join('')}`).join('')}
      </div>`,
    actions: [{ label: '取消', value: null }],
    onMount(mask, close) {
      const body = mask.querySelector('.dialog-body');
      const ctlOf = (key) => body.querySelector(`.pe-ctl[data-key="${key}"]`);
      body.querySelectorAll('.pe-use').forEach((btn) => {
        btn.onclick = () => {
          const c = ctlOf(btn.dataset.key);
          if (c) { c.value = btn.dataset.rec; toast(`已把 ${btn.dataset.key} 改为推荐值，点「保存全部改动」后生效`, 'info', 3500); }
        };
      });

      const collectChanged = () => {
        const changed = [];
        for (const it of allItems) {
          const c = ctlOf(it.key);
          if (!c) continue;
          const v = String(c.value);
          if ((orig[it.key] ?? '') !== v) changed.push([it.key, v]);
        }
        return changed;
      };
      const applyEntries = async (entries, btn, doneText) => {
        btn.disabled = true;
        const r = await savePropsOneByOne(id, entries, (i, n) => { btn.textContent = `保存中（${i}/${n}）…`; });
        btn.disabled = false;
        btn.textContent = doneText;
        for (const [k, v] of entries) {
          orig[k] = String(v);
          const c = ctlOf(k); // 一键优化走的是二级弹窗，这里同步回编辑器控件，避免重复保存旧值
          if (c && c.value !== String(v)) c.value = String(v);
        }
        if (r.okN) toast(`已保存 ${r.okN} 项配置，重启服务器后生效`, 'ok', 5000);
        for (const f of r.fails.slice(0, 3)) toast(f, 'error', 6000);
        if (r.fails.length > 3) toast(`另有 ${r.fails.length - 3} 项保存失败，请稍后再试`, 'error', 5000);
        if (r.okN && !r.fails.length && onSaved) { try { onSaved(); } catch { /* 忽略 */ } }
        return r;
      };

      const saveBtn = document.createElement('button');
      saveBtn.className = 'btn primary';
      saveBtn.textContent = '保存全部改动';
      saveBtn.onclick = async () => {
        const changed = collectChanged();
        if (!changed.length) { toast('没有改动，不需要保存', 'info'); return; }
        saveBtn.textContent = '保存中…';
        const r = await applyEntries(changed, saveBtn, '保存全部改动');
        if (r.okN && !r.fails.length) close(true);
      };
      mask.querySelector('.dialog-actions').appendChild(saveBtn);

      mask.querySelector('#pe-optimize').onclick = () => {
        const diff = [];
        for (const it of allItems) {
          const rec = it.recommended != null && it.recommended !== '' ? String(it.recommended) : '';
          if (!rec) continue;
          const cur = orig[it.key] ?? '';
          if (cur === rec) continue;
          diff.push({ key: it.key, name: String(it.name || it.key), from: cur === '' ? '（未设置）' : cur, to: rec, desc: String(it.desc || it.description || '') });
        }
        if (!diff.length) { toast('当前配置已经符合 4-10 人小服的推荐值，无需优化', 'ok'); return; }
        showDialog({
          title: '一键优化预览',
          wide: true,
          body: `
            <p class="small" style="margin-top:0">以下是针对 <b>4-10 人小服</b> 的推荐改动，共 ${diff.length} 项。确认后逐条写入配置，重启服务器后生效。</p>
            <div style="max-height:44vh; overflow:auto">
              ${diff.map((d) => `
                <div class="list-row">
                  <div class="row-icon">⚡</div>
                  <div class="col" style="gap:2px; flex:1; min-width:0">
                    <div class="row" style="gap:8px"><span class="bold">${escapeHtml(d.name)}</span><code class="tiny muted-3">${escapeHtml(d.key)}</code></div>
                    <div class="small">${escapeHtml(d.from)} <span style="color:var(--accent)">→</span> <b>${escapeHtml(d.to)}</b></div>
                    ${d.desc ? `<div class="tiny muted-3">${escapeHtml(d.desc)}</div>` : ''}
                  </div>
                </div>`).join('')}
            </div>`,
          actions: [{ label: '取消', value: false }, { label: '确认优化', value: true, primary: true }],
          onMount(mask2, close2) {
            const btn = mask2.querySelector('.dialog-actions .btn.primary');
            btn.onclick = async () => {
              btn.textContent = '优化中…';
              await applyEntries(diff.map((d) => [d.key, d.to]), btn, '确认优化');
              close2(true);
            };
          },
        });
      };
    },
  });
}

/* ---------- 性能面板 ---------- */
async function openPerfPanel(id) {
  await showDialog({
    title: '服务器性能面板',
    body: `
      <div class="row mb-2"><span class="small muted">在线人数与 TPS 每次打开时刷新</span><div class="spacer"></div><button class="btn ghost sm pf-refresh">刷新</button></div>
      <div class="pf-body"><div class="col center" style="padding:28px 0; gap:10px"><div class="spinner"></div><div class="small muted">正在读取服务器状态…</div></div></div>`,
    actions: [{ label: '关闭', value: true }],
    onMount: async (mask) => {
      const box = mask.querySelector('.pf-body');
      const paint = (r) => {
        const players = r && r.players;
        const playersText = isPlain(players)
          ? `${Number(players.online) || 0} / ${Number(players.max) || 0}`
          : (players != null && players !== '' ? String(players) : '未知');
        let tpsText = '未知';
        let tpsCls = '';
        if (r && r.tps != null && r.tps !== '') {
          const n = Number(r.tps);
          if (Number.isFinite(n)) {
            tpsText = n.toFixed(1);
            tpsCls = n >= 19 ? 'style="color:var(--ok)"' : n >= 15 ? 'style="color:var(--warn)"' : 'style="color:var(--err)"';
          } else tpsText = String(r.tps);
        }
        box.innerHTML = `
          <div class="grid cols-2 mb-3">
            <div class="card" style="padding:12px"><div class="tiny muted-3">在线玩家</div><div class="bold" style="font-size:22px">👥 ${escapeHtml(playersText)}</div></div>
            <div class="card" style="padding:12px"><div class="tiny muted-3">TPS（每秒刻数，满值 20）</div><div class="bold" ${tpsCls} style="font-size:22px">⏱ ${escapeHtml(tpsText)}</div></div>
          </div>
          ${r && r.tpsNote ? `<div class="small muted mb-3" style="padding:8px 12px; border-radius:8px; background:var(--card-2)">${escapeHtml(String(r.tpsNote))}</div>` : ''}
          ${r && r.diagnosis ? `<div class="sc-eula mb-3" style="border-radius:var(--radius-sm); padding:10px 12px"><div class="bold small" style="color:var(--warn)">诊断结果</div><div class="small mt-1">${escapeHtml(String(r.diagnosis))}</div></div>` : ''}
          ${r && r.basis ? `<div class="tiny muted-3">判断依据：${escapeHtml(String(r.basis))}</div>` : ''}`;
      };
      const load = async () => {
        box.innerHTML = '<div class="col center" style="padding:28px 0; gap:10px"><div class="spinner"></div><div class="small muted">正在读取服务器状态…</div></div>';
        let r;
        try { r = await api.server.perf({ id }); } catch (e) {
          box.innerHTML = emptyState({ icon: '📊', title: '性能数据读取失败', text: friendlyErr(e), actionsHtml: '<button class="btn primary pf-retry">重试</button>' });
          const b = box.querySelector('.pf-retry');
          if (b) b.onclick = load;
          return;
        }
        paint(r);
      };
      mask.querySelector('.pf-refresh').onclick = load;
      load();
    },
  });
}

/* ---------- 白名单与权限 ---------- */
const WL_ROWS = [
  ['wl-add', '添加白名单', 'whitelist add'],
  ['wl-remove', '移除白名单', 'whitelist remove'],
  ['wl-op', '设为管理员', 'op'],
  ['wl-ban', '封禁玩家', 'ban'],
  ['wl-pardon', '解封玩家', 'pardon'],
];

async function openWhitelistDialog(id) {
  await showDialog({
    title: '白名单与权限',
    wide: true,
    body: `
      <p class="small muted">以下操作通过服务器控制台命令完成，结果以控制台输出为准。玩家名要与游戏内 ID 完全一致（区分大小写）。</p>
      <div class="col" style="gap:10px">
        ${WL_ROWS.map(([k, label, cmd]) => `
        <div class="row" style="gap:8px">
          <span class="small bold" style="width:86px; flex:0 0 auto">${label}</span>
          <input class="input sm ${k}-input" placeholder="玩家名，例如：Steve" style="flex:1">
          <button class="btn sm ${k}-btn" style="flex:0 0 auto">执行</button>
        </div>`).join('')}
      </div>`,
    actions: [{ label: '关闭', value: true }],
    onMount(mask) {
      const send = async (cmd, name) => {
        try {
          await api.servers.sendCommand({ id, text: `${cmd} ${name}` });
          toast(`已执行：${cmd} ${name}，结果以控制台输出为准`, 'ok', 4500);
        } catch (e) { toast(`命令发送失败：${friendlyErr(e)}`, 'error', 5000); }
      };
      for (const [k, , cmd] of WL_ROWS) {
        const input = mask.querySelector(`.${k}-input`);
        const btn = mask.querySelector(`.${k}-btn`);
        if (!input || !btn) continue;
        const go = () => {
          const name = input.value.trim();
          if (!name) { toast('先填写玩家名', 'warn'); input.focus(); return; }
          send(cmd, name);
        };
        btn.onclick = go;
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
      }
    },
  });
}

/* ---------- 邀请文案 ---------- */
async function openInviteDialog(id) {
  let text = '';
  try { text = String(await api.servers.inviteText({ id }) || ''); }
  catch (e) { toast(`生成邀请文案失败：${friendlyErr(e)}`, 'error', 5000); return; }
  await showDialog({
    title: '服务器邀请文案',
    body: `<div class="sc-invite-text">${escapeHtml(text || '（服务器没有返回文案）')}</div>`,
    actions: [{ label: '关闭', value: true }],
    onMount(mask) {
      const btn = document.createElement('button');
      btn.className = 'btn primary';
      btn.textContent = '复制';
      btn.onclick = async () => {
        try { await api.clip.write(text); toast('邀请文案已复制到剪贴板', 'ok'); }
        catch (e) { toast(`复制失败：${friendlyErr(e)}`, 'error', 5000); }
      };
      mask.querySelector('.dialog-actions').appendChild(btn);
    },
  });
}

/* ---------- 导入配置 ---------- */
async function openImportProps(id) {
  await showDialog({
    title: '导入服务器配置',
    wide: true,
    body: `
      <p class="small muted">启动器不能直接读取文件内容，请打开你的 server.properties 文件，全选复制后粘贴到下面（也可以只粘贴想修改的几行，每行格式为 键=值）。导入会覆盖当前配置，导入前会自动备份一份。</p>
      <div class="row mb-2" style="gap:8px">
        <button class="btn sm" id="ip-pick">选择文件作为参照</button>
        <span class="tiny muted-3 ellipsis" id="ip-picked" style="flex:1"></span>
      </div>
      <textarea class="input" id="ip-text" rows="10" placeholder="在这里粘贴 server.properties 的内容…" style="width:100%; resize:vertical; font-family:ui-monospace,monospace"></textarea>
      <div class="tiny muted-3 mt-1">服务器运行中无法导入，请先停止服务器。导入后如发现问题，可以一键恢复到导入前的配置。</div>`,
    actions: [{ label: '取消', value: null }],
    onMount(mask, close) {
      mask.querySelector('#ip-pick').onclick = async () => {
        try {
          const p = await api.pick.file({ title: '选择 server.properties 文件', filters: [{ name: 'properties 文件', extensions: ['properties', 'txt', 'conf'] }] });
          if (!p) return;
          mask.querySelector('#ip-picked').textContent = p;
          toast('出于安全考虑启动器不能直接读取文件，请打开这个文件全选复制，再粘贴到下方输入框', 'info', 6000);
        } catch (e) { toast(`选择文件失败：${friendlyErr(e)}`, 'error', 5000); }
      };
      const btn = document.createElement('button');
      btn.className = 'btn primary';
      btn.textContent = '导入';
      btn.onclick = async () => {
        const text = mask.querySelector('#ip-text').value;
        if (!text.trim()) { toast('先粘贴 server.properties 的内容', 'warn'); return; }
        btn.disabled = true;
        btn.textContent = '导入中…';
        let r;
        try { r = await api.servers.importProps({ id, text }); }
        catch (e) {
          btn.disabled = false;
          btn.textContent = '导入';
          toast(`导入失败：${friendlyErr(e)}`, 'error', 5000);
          return;
        }
        toast((r && r.message) || '配置已导入，重启服务器后生效', 'ok', 6000);
        close(true);
        const restore = await showDialog({
          title: '导入完成',
          body: `<p>${escapeHtml((r && r.message) || '配置已导入，重启服务器后生效。')}</p>
            <p class="small muted mt-2">如果导入后服务器表现异常，可以回滚到导入前的配置。</p>`,
          actions: [{ label: '暂不恢复', value: false }, { label: '恢复导入前配置', value: true, primary: true }],
        });
        if (!restore) return;
        try {
          const rr = await api.servers.restorePropsBak({ id });
          toast((rr && rr.message) || '已恢复到导入前的配置', 'ok', 5000);
        } catch (e) { toast(`恢复失败：${friendlyErr(e)}`, 'error', 5000); }
      };
      mask.querySelector('.dialog-actions').appendChild(btn);
    },
  });
}

/* ---------- 精选模组包 ---------- */
const FEATURED_PACKS = [
  { slug: 'sodium', name: 'Sodium', icon: '⚡', intro: '重写渲染管线，帧数提升明显，画面选项更丰富。', who: '适合所有想流畅游玩的玩家' },
  { slug: 'jei', name: 'JEI 物品查询', icon: '🔎', intro: '在游戏内查询任意物品的合成配方与用途。', who: '适合刚上手和爱研究的玩家' },
  { slug: 'lithium', name: 'Lithium', icon: '🚀', intro: '优化游戏内部运算逻辑，不改变任何玩法。', who: '适合原版生存与轻量服务器' },
  { slug: 'appleskin', name: 'AppleSkin', icon: '🍎', intro: '显示食物能恢复多少饥饿值与饱和度。', who: '适合生存玩家' },
];

async function openFeaturedInstall(f) {
  let instances = [];
  try { instances = await api.instances.list() || []; }
  catch (e) { toast(`实例列表加载失败：${errMsg(e)}`, 'error', 5000); return; }
  if (!Array.isArray(instances) || !instances.length) {
    toast('还没有可安装的实例，请先到「实例」页创建一个', 'warn', 5000);
    return;
  }
  await showDialog({
    title: `一键安装「${f.name}」`,
    body: `
      <p class="small muted">选择要安装到的实例，启动器会从 Modrinth 下载适配当前实例的版本。</p>
      <label class="field"><span class="field-label">目标实例</span>
        <select class="input" id="fi-inst">${instances.map((i) =>
    `<option value="${escapeHtml(i.id)}">${escapeHtml(i.name || i.id)}（${escapeHtml(String(i.versionId || ''))} · ${escapeHtml(loaderLabel(i.loader))}）</option>`).join('')}</select></label>
      <div class="tiny muted-3 mb-2" id="fi-hint"></div>
      <div id="fi-status"></div>`,
    actions: [{ label: '取消', value: null }],
    onMount(mask, close) {
      const sel = mask.querySelector('#fi-inst');
      const hint = mask.querySelector('#fi-hint');
      const status = mask.querySelector('#fi-status');
      const updateHint = () => {
        const inst = instances.find((x) => x.id === sel.value);
        hint.textContent = inst && inst.loader === 'vanilla'
          ? '提示：这是原版实例，画质/优化类模组通常需要 Fabric 等加载器。如果安装失败，请先创建一个 Fabric 实例。'
          : '';
      };
      sel.onchange = updateHint;
      updateHint();
      const btn = document.createElement('button');
      btn.className = 'btn primary';
      btn.textContent = '安装';
      btn.onclick = async () => {
        const instId = sel.value;
        btn.disabled = true;
        btn.textContent = '搜索模组…';
        try {
          const rs = await api.mods.search({ query: f.slug, limit: 5 });
          const list = Array.isArray(rs) ? rs : [];
          const hit = list.find((x) => String(x.slug || '').toLowerCase() === f.slug) || list[0];
          if (!hit) throw new Error('没有在 Modrinth 上找到这个模组。可能是网络暂时不通，稍后再试。');
          btn.textContent = '安装中…';
          status.innerHTML = '<div class="row small muted" style="gap:8px"><div class="spinner sm"></div><span>正在下载安装，进度可以在下载中心查看…</span></div>';
          await api.mods.install({ instanceId: instId, projectId: hit.projectId });
          close(true);
          toast(`「${f.name}」安装完成，到实例的模组页可以看到它`, 'ok', 5000);
        } catch (e) {
          btn.disabled = false;
          btn.textContent = '安装';
          status.innerHTML = `<div class="small mt-2" style="color:var(--err)">安装失败：${escapeHtml(friendlyErr(e))}</div>`;
        }
      };
      mask.querySelector('.dialog-actions').appendChild(btn);
    },
  });
}

async function openReportDialog(f) {
  let reason = '不当内容';
  const go = await showDialog({
    title: `举报「${f.name}」`,
    body: `
      <p class="small muted">举报内容会记录在本地，并可在诊断包中导出给官方核查。举报不会自动下架内容，也不影响你本地的模组。</p>
      <label class="field"><span class="field-label">举报原因</span>
        <select class="input" id="rp-reason">
          <option>不当内容</option>
          <option>侵权</option>
          <option>失效</option>
          <option>其他</option>
        </select></label>`,
    actions: [{ label: '取消', value: false }, { label: '生成举报记录', value: true, primary: true }],
    onMount(mask) {
      const sel = mask.querySelector('#rp-reason');
      sel.onchange = () => { reason = sel.value; };
    },
  });
  if (!go) return;
  const text = `【方块盒子 内容举报】\n内容：${f.name}（Modrinth slug: ${f.slug}）\n原因：${reason}\n时间：${new Date().toLocaleString('zh-CN')}\n备注：由用户在启动器内提交，供官方核查。`;
  try {
    await api.clip.write(text);
    try {
      const arr = JSON.parse(localStorage.getItem('bb-report-log') || '[]');
      arr.unshift({ name: f.name, slug: f.slug, reason, time: Date.now() });
      localStorage.setItem('bb-report-log', JSON.stringify(arr.slice(0, 100)));
    } catch { /* 本地记录失败不影响主流程 */ }
    toast('举报记录已生成并复制到剪贴板，同时保存在本地', 'ok', 5000);
  } catch (e) { toast(`生成举报记录失败：${friendlyErr(e)}`, 'error', 5000); }
}

function statusMeta(s) {
  if (s === 'running') return { label: '运行中', cls: 'ok' };
  if (s === 'starting') return { label: '启动中', cls: 'warn' };
  return { label: '已停止', cls: '' };
}
function fmtPort(p) {
  const v = Number(p);
  return Number.isFinite(v) && v > 0 ? String(v) : '';
}
function lineLevel(l) {
  const lv = String((l && l.level) || '').toLowerCase();
  if (lv.startsWith('warn')) return 'lv-warn';
  if (lv.startsWith('err') || lv.startsWith('severe') || lv.startsWith('fatal')) return 'lv-error';
  const t = String((l && l.text) || '');
  if (/\bERROR\b|\bSEVERE\b|Exception|错误|严重/.test(t)) return 'lv-error';
  if (/\bWARN\b|警告/.test(t)) return 'lv-warn';
  return 'lv-info';
}

function ensureStyle() {
  if (document.getElementById('srv-style')) return;
  const s = document.createElement('style');
  s.id = 'srv-style';
  s.textContent = `
    .srv-notice { padding: 8px 12px; border-radius: var(--radius-sm); font-size: 12.5px;
      background: color-mix(in srgb, var(--warn) 14%, transparent);
      border: 1px solid color-mix(in srgb, var(--warn) 40%, transparent); color: var(--warn); }
    .sc-eula { border-color: color-mix(in srgb, var(--warn) 45%, transparent);
      background: color-mix(in srgb, var(--warn) 8%, var(--card)); }
    .sc-eula input[type="checkbox"] { accent-color: var(--accent); width: 15px; height: 15px; cursor: pointer; }
    .sc-console { background: #14161c; border: 1px solid var(--border); border-radius: var(--radius-sm);
      padding: 10px 12px; height: 48vh; min-height: 260px; overflow-y: auto; color: #d6dae3; }
    .sc-console .lv-info { color: #d6dae3; }
    .sc-console .lv-warn { color: #f0b13e; }
    .sc-console .lv-error { color: #f26d6d; }
    .sc-console .lv-time { color: #6f7686; }
    .sc-invite-text { white-space: pre-wrap; background: var(--card-2); border: 1px solid var(--border);
      border-radius: 8px; padding: 10px 12px; font-size: 13px; line-height: 1.7; }
    .featured-card { position: relative; padding: 12px; }
    .featured-card .ft-report { position: absolute; top: 6px; right: 6px; padding: 2px 7px; font-size: 11px; }
  `;
  document.head.appendChild(s);
}

/* ---------- 列表页 ---------- */
const listPage = {
  id: 'server',
  title: '服务器',
  icon: '🖥️',
  routes: ['/server'],
  order: 9,
  async render(el) {
    runCleanups();
    ensureStyle();
    setBreadcrumb([{ label: '主页', onClick() { location.hash = '/'; } }, { label: '服务器' }]);

    el.innerHTML = `
      <div class="row mb-3">
        <div class="col" style="gap:2px">
          <div class="bold" style="font-size:17px">服务器</div>
          <div class="small muted">在这里创建和管理 Minecraft 联机服务器，好友用「你的IP:端口」就能连进来。</div>
        </div>
        <div class="spacer"></div>
        <button class="btn primary" id="srv-create">＋ 创建服务器</button>
      </div>
      <div class="section-title" style="margin-top:4px">精选模组包</div>
      <div class="small muted mb-2">社区验证过的常用模组，选一个实例即可一键安装。</div>
      <div class="grid cols-4 mb-3" id="srv-featured"></div>
      <div class="section-title">我的服务器</div>
      <div id="srv-list">${skeletonRows(3)}</div>`;

    el.querySelector('#srv-create').onclick = openCreate;
    renderFeatured();

    function renderFeatured() {
      const box = el.querySelector('#srv-featured');
      if (!box) return;
      box.innerHTML = FEATURED_PACKS.map((f, i) => `
        <div class="card hoverable featured-card" data-idx="${i}">
          <button class="btn ghost sm ft-report" data-tip="举报此推荐内容">⚠️</button>
          <div class="row" style="gap:8px"><span style="font-size:20px">${f.icon}</span><span class="bold">${escapeHtml(f.name)}</span></div>
          <div class="small muted mt-1">${escapeHtml(f.intro)}</div>
          <div class="tiny muted-3 mt-1">${escapeHtml(f.who)}</div>
          <button class="btn sm primary block mt-2 ft-install">一键安装</button>
        </div>`).join('');
      box.querySelectorAll('.featured-card').forEach((card) => {
        const f = FEATURED_PACKS[Number(card.dataset.idx)];
        if (!f) return;
        card.querySelector('.ft-install').onclick = () => openFeaturedInstall(f);
        card.querySelector('.ft-report').onclick = (e) => { e.stopPropagation(); openReportDialog(f); };
      });
    }

    let timer = null;
    const scheduleLoad = (ms = 300) => { clearTimeout(timer); timer = setTimeout(load, ms); };
    addCleanup(() => clearTimeout(timer));
    sub('bb:server-status', () => scheduleLoad());

    async function load() {
      if (!el.isConnected) return;
      const box = el.querySelector('#srv-list');
      if (!box) return;
      let list;
      try { list = await api.servers.list(); }
      catch (e) {
        box.innerHTML = `<div class="card"><div class="bold">服务器列表加载失败</div>
          <div class="small muted mt-1">发生了什么：${escapeHtml(errMsg(e))}</div>
          <div class="small muted mt-1">可能是后台服务暂时没有响应，稍等一下再试。</div>
          <button class="btn mt-3" id="srv-retry">重试</button></div>`;
        const b = box.querySelector('#srv-retry');
        if (b) b.onclick = () => { box.innerHTML = skeletonRows(3); load(); };
        return;
      }
      const servers = Array.isArray(list) ? list : [];
      if (!servers.length) {
        box.innerHTML = emptyState({
          icon: '🖥️',
          title: '还没有服务器',
          text: '点击上方按钮创建，或导入整合包时选择创建服务器。',
          actionsHtml: '<button class="btn primary" id="srv-empty-create">创建服务器</button>',
        });
        const b = box.querySelector('#srv-empty-create');
        if (b) b.onclick = openCreate;
        return;
      }
      box.innerHTML = '';
      for (const s of servers) box.appendChild(cardEl(s));
    }

    function cardEl(s) {
      const sm = statusMeta(s.status);
      const port = fmtPort(s.port);
      const card = document.createElement('div');
      card.className = 'card hoverable mb-3';
      card.innerHTML = `
        <div class="row" style="gap:12px">
          <div class="row-icon" style="width:42px;height:42px;font-size:20px">🖥️</div>
          <div class="col" style="gap:3px;flex:1;min-width:0">
            <div class="row" style="gap:8px">
              <span class="bold ellipsis">${escapeHtml(s.name || '未命名服务器')}</span>
              <span class="badge ${sm.cls}" style="flex:0 0 auto">${sm.label}</span>
            </div>
            <div class="small muted-3 ellipsis">${escapeHtml(String(s.versionId || ''))} · ${escapeHtml(loaderLabel(s.loader))}${port ? ` · 端口 ${escapeHtml(port)}` : ''}</div>
          </div>
          <button class="btn sm srv-props" style="flex:0 0 auto" data-tip="服务器设置">⚙️ 设置</button>
          <span class="tiny muted-3" style="flex:0 0 auto">点击进入控制台 →</span>
        </div>
        ${s.portNotice != null && s.portNotice !== ''
          ? `<div class="srv-notice mt-2">⚠️ 25565 端口被占用了，已自动改为 ${escapeHtml(String(s.portNotice))}。好友连接时请使用 你的IP:${escapeHtml(String(s.portNotice))}</div>`
          : ''}`;
      const setBtn = card.querySelector('.srv-props');
      if (setBtn) setBtn.onclick = (e) => { e.stopPropagation(); openPropsDialog(s.id, () => load()); };
      card.onclick = () => { location.hash = `/server/${encodeURIComponent(s.id)}`; };
      return card;
    }

    async function openCreate() {
      let versions;
      try { versions = await api.versions.listAll(); }
      catch (e) { toast(`版本列表加载失败：${errMsg(e)}`, 'error'); return; }
      const releases = (Array.isArray(versions) ? versions : []).filter((v) => v && v.type === 'release');
      if (!releases.length) { toast('暂时拿不到可用的游戏版本，稍后再试', 'warn'); return; }
      await showDialog({
        title: '创建服务器',
        body: `
          <label class="field"><span class="field-label">服务器名称</span>
            <input class="input" id="cs-name" placeholder="例如：和朋友的生存服"></label>
          <label class="field"><span class="field-label">游戏版本</span>
            <select class="input" id="cs-version">${releases.map((v) =>
              `<option value="${escapeHtml(v.id)}">${escapeHtml(v.id)}</option>`).join('')}</select></label>
          <div class="field-hint">也可以在导入整合包时选择『同时创建服务器』。</div>`,
        actions: [{ label: '取消', value: null }],
        onMount(mask, close) {
          const nameInput = mask.querySelector('#cs-name');
          const verSel = mask.querySelector('#cs-version');
          const btn = document.createElement('button');
          btn.className = 'btn primary';
          btn.textContent = '创建';
          btn.onclick = async () => {
            const name = nameInput.value.trim();
            if (!name) { toast('先给服务器起个名字吧', 'warn'); nameInput.focus(); return; }
            btn.disabled = true;
            btn.textContent = '创建中…';
            try {
              await api.servers.createVanilla({ name, versionId: verSel.value });
              close(true);
              toast(`服务器「${name}」创建完成`, 'ok');
              load();
            } catch (e) {
              btn.disabled = false;
              btn.textContent = '创建';
              toast(`创建失败：${errMsg(e)}`, 'error');
            }
          };
          nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') btn.click(); });
          mask.querySelector('.dialog-actions').appendChild(btn);
          setTimeout(() => nameInput.focus(), 50);
        },
      });
    }

    await load();
  },
};

/* ---------- 控制台子页 ---------- */
const consolePage = {
  id: 'server-console',
  title: '服务器控制台',
  icon: '🖥️',
  routes: ['/server/'],
  hiddenNav: true,
  async render(el, ctx) {
    runCleanups();
    ensureStyle();
    const id = (ctx.params && ctx.params[0]) || '';
    if (!id) { location.hash = '/server'; return; }
    setBreadcrumb([
      { label: '主页', onClick() { location.hash = '/'; } },
      { label: '服务器', onClick() { location.hash = '/server'; } },
      { label: '控制台' },
    ]);

    const expandedEula = { accepted: undefined };

    async function boot() {
      runCleanups();
      el.innerHTML = `<div class="page-loading"><div class="spinner"></div><div>正在读取服务器信息…</div></div>`;
      let detail = null;
      try { const d = await api.servers.detail({ id }); if (d && typeof d === 'object') detail = d; }
      catch { /* servers.detail 未接通时回退到列表数据 */ }
      let base = null;
      try {
        const list = await api.servers.list();
        base = (Array.isArray(list) ? list : []).find((s) => s && String(s.id) === String(id)) || null;
      } catch { /* 忽略 */ }
      if (!detail && !base) {
        el.innerHTML = `<div class="card"><div class="bold">暂时拿不到这台服务器的信息</div>
          <div class="small muted mt-1">它可能已被删除，或者后台服务暂时没有响应。</div>
          <div class="row mt-3"><button class="btn" id="sc-back0">返回服务器列表</button><button class="btn" id="sc-retry">重试</button></div></div>`;
        el.querySelector('#sc-back0').onclick = () => { location.hash = '/server'; };
        el.querySelector('#sc-retry').onclick = boot;
        return;
      }
      renderShell({ ...(base || {}), ...(detail || {}) });
    }

    function renderShell(srv) {
      srv.id = srv.id || id;
      if (expandedEula.accepted !== undefined) srv.eulaAccepted = expandedEula.accepted;
      const sm = statusMeta(srv.status);

      el.innerHTML = `
        <div class="row mb-3">
          <button class="btn ghost" id="sc-back">← 返回列表</button>
          <div class="col" style="gap:2px;min-width:0">
            <div class="bold ellipsis" style="font-size:16px">${escapeHtml(srv.name || '服务器')}</div>
            <div class="small muted-3 ellipsis">${escapeHtml(String(srv.versionId || ''))}${srv.loader && String(srv.loader) !== 'vanilla' ? ` · ${escapeHtml(loaderLabel(srv.loader))}` : ''}</div>
          </div>
          <div class="spacer"></div>
          <span class="badge ${sm.cls}" id="sc-status">${sm.label}</span>
          <span class="badge" id="sc-port">端口 ${escapeHtml(fmtPort(srv.port) || '未知')}</span>
        </div>
        <div id="sc-eula" class="mb-3"></div>
        <div class="row wrap mb-3" style="gap:8px">
          <button class="btn primary" id="sc-start">启动服务器</button>
          <button class="btn danger" id="sc-stop" style="display:none">停止服务器</button>
          <button class="btn" id="sc-open">打开服务器文件夹</button>
          <button class="btn" id="sc-props">服务器设置</button>
          <button class="btn" id="sc-props-edit" data-tip="按分组编辑全部 server.properties 配置">🧩 配置编辑器</button>
          <button class="btn" id="sc-perf" data-tip="查看在线人数、TPS 与诊断">📊 性能面板</button>
          <button class="btn" id="sc-backup">备份服务器</button>
          <button class="btn ghost" id="sc-restore">恢复备份</button>
          <button class="btn" id="sc-whitelist" data-tip="白名单、管理员、封禁">👥 白名单与权限</button>
          <button class="btn" id="sc-invite">✉️ 邀请文案</button>
          <button class="btn" id="sc-export-props">📤 导出配置</button>
          <button class="btn" id="sc-import-props">📥 导入配置</button>
        </div>
        <div class="card mb-3" id="sc-auto">
          <div class="row wrap" style="gap:14px">
            <div class="row wrap" style="gap:8px; flex:1; min-width:280px">
              <span class="bold small">自动备份</span>
              <input class="input sm" id="sc-bak-min" type="number" min="0" step="5" style="width:100px"
                value="${escapeHtml(String(Math.max(0, Math.floor(Number(srv.backupIntervalMin) || 0))))}" data-tip="两次自动备份的间隔分钟数，0 表示关闭">
              <span class="small muted">分钟一次，0 = 关闭</span>
              <button class="btn sm" id="sc-bak-save">保存</button>
            </div>
            <div class="row" style="gap:8px">
              <span class="bold small">崩溃自动重启</span>
              <label class="switch" data-tip="开启后服务器意外退出时会自动重新启动（最多连续 3 次）">
                <input type="checkbox" id="sc-restart-sw" ${srv.autoRestart ? 'checked' : ''}><span class="track"></span>
              </label>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="row mb-2">
            <span class="bold">控制台</span>
            <span class="small muted-3">服务器的日志会实时显示在这里</span>
            <div class="spacer"></div>
            <button class="btn ghost sm" id="sc-clear">清空</button>
          </div>
          <div class="console sc-console" id="sc-lines"></div>
          <div class="row mt-2">
            <input class="input" id="sc-cmd" placeholder="输入服务器命令后回车发送，例如：say 大家好">
            <button class="btn primary" id="sc-send" style="flex:0 0 auto">发送</button>
          </div>
        </div>`;

      const startBtn = el.querySelector('#sc-start');
      const stopBtn = el.querySelector('#sc-stop');
      const statusBadge = el.querySelector('#sc-status');
      const portBadge = el.querySelector('#sc-port');
      const linesBox = el.querySelector('#sc-lines');

      appendInfo('—— 控制台已就绪，服务器输出会显示在这里 ——');

      function setStatus(s) {
        srv.status = s;
        const m = statusMeta(s);
        statusBadge.className = `badge ${m.cls}`;
        statusBadge.textContent = m.label;
        updateButtons();
      }
      function setPort(p) {
        srv.port = p;
        portBadge.textContent = `端口 ${fmtPort(p) || '未知'}`;
      }
      function updateButtons() {
        if (srv.status === 'running') {
          startBtn.style.display = 'none';
          stopBtn.style.display = '';
          stopBtn.disabled = false;
          stopBtn.textContent = '停止服务器';
        } else if (srv.status === 'starting') {
          startBtn.style.display = '';
          startBtn.disabled = true;
          startBtn.textContent = '启动中…';
          stopBtn.style.display = '';
          stopBtn.disabled = false;
          stopBtn.textContent = '停止服务器';
        } else {
          startBtn.style.display = '';
          startBtn.disabled = false;
          startBtn.textContent = '启动服务器';
          stopBtn.style.display = 'none';
        }
      }
      function appendInfo(text) {
        const div = document.createElement('div');
        div.className = 'lv-time';
        div.textContent = text;
        linesBox.appendChild(div);
        linesBox.scrollTop = linesBox.scrollHeight;
      }
      function appendLines(lines) {
        const arr = Array.isArray(lines) ? lines : [];
        if (!arr.length) return;
        const stick = linesBox.scrollHeight - linesBox.scrollTop - linesBox.clientHeight <= 50;
        for (const l of arr) {
          const div = document.createElement('div');
          div.className = lineLevel(l);
          div.textContent = String(l && l.text != null ? l.text : l ?? '');
          linesBox.appendChild(div);
        }
        while (linesBox.children.length > 600) linesBox.firstChild.remove();
        if (stick) linesBox.scrollTop = linesBox.scrollHeight;
      }

      function renderEula() {
        const box = el.querySelector('#sc-eula');
        if (!box) return;
        if (srv.eulaAccepted !== false) { box.innerHTML = ''; return; }
        box.innerHTML = `
          <div class="card sc-eula">
            <div class="bold">启动前需要同意 EULA</div>
            <div class="small muted mt-1">启动服务器前需要同意 Minecraft 最终用户许可协议（EULA）。不同意的话服务器无法开机。</div>
            <label class="row mt-2" style="gap:8px;cursor:pointer;width:fit-content">
              <input type="checkbox" id="sc-eula-check">
              <span class="small bold">我同意 Minecraft EULA</span>
            </label>
          </div>`;
        const cb = box.querySelector('#sc-eula-check');
        cb.addEventListener('change', async () => {
          if (!cb.checked) return;
          cb.disabled = true;
          try {
            await api.servers.acceptEula({ id, accept: true });
            srv.eulaAccepted = true;
            expandedEula.accepted = true;
            box.innerHTML = '';
            toast('已同意 EULA，现在可以启动服务器了', 'ok');
          } catch (e) {
            cb.disabled = false;
            cb.checked = false;
            toast(`同意 EULA 失败：${errMsg(e)}`, 'error');
          }
        });
      }

      el.querySelector('#sc-back').onclick = () => { location.hash = '/server'; };
      el.querySelector('#sc-clear').onclick = () => { linesBox.innerHTML = ''; };
      el.querySelector('#sc-open').onclick = async () => {
        try { await api.servers.openFolder({ id }); }
        catch (e) { toast(`打开服务器文件夹失败：${errMsg(e)}`, 'error'); }
      };
      el.querySelector('#sc-props').onclick = () => openPropsDialog(id, (p) => {
        const port = Number(p && p['server-port']);
        if (Number.isFinite(port) && port > 0) setPort(port);
      });
      el.querySelector('#sc-props-edit').onclick = () => openPropsEditor(id, async () => {
        try {
          const d = await api.servers.detail({ id });
          const port = Number(d && d.props && d.props['server-port']);
          if (Number.isFinite(port) && port > 0) setPort(port);
        } catch { /* 端口刷新失败不影响保存结果 */ }
      });
      el.querySelector('#sc-perf').onclick = () => openPerfPanel(id);
      el.querySelector('#sc-backup').onclick = async () => {
        try {
          const r = await api.servers.backup({ id });
          toast((r && r.message) || '备份完成，可以在服务器文件夹里查看备份文件', 'ok', 4500);
        } catch (e) { toast(`备份失败：${friendlyErr(e)}`, 'error', 5000); }
      };
      el.querySelector('#sc-restore').onclick = async () => {
        const ok = await confirmDialog('恢复备份',
          '会用最近的备份覆盖当前的世界和配置，自上次备份之后的改动会丢失。确定恢复吗？',
          { danger: true, okLabel: '恢复备份' });
        if (!ok) return;
        try {
          await api.servers.restore({ id });
          toast('备份已恢复', 'ok', 4500);
        } catch (e) { toast(`恢复失败：${friendlyErr(e)}`, 'error', 5000); }
      };

      el.querySelector('#sc-whitelist').onclick = () => openWhitelistDialog(id);
      el.querySelector('#sc-invite').onclick = () => openInviteDialog(id);
      el.querySelector('#sc-export-props').onclick = async () => {
        let content = '';
        try { content = String(await api.servers.exportProps({ id }) ?? ''); }
        catch (e) { toast(`导出配置失败：${friendlyErr(e)}`, 'error', 5000); return; }
        let dest = null;
        try {
          dest = await api.pick.save({ title: '导出 server.properties', defaultName: 'server.properties', filters: [{ name: 'properties 文件', extensions: ['properties'] }] });
        } catch (e) { toast(`选择保存位置失败：${friendlyErr(e)}`, 'error', 5000); return; }
        if (!dest) return;
        try {
          const r = await api.data.save({ path: dest, text: content });
          toast(`配置已导出到 ${(r && r.path) || dest}`, 'ok', 5000);
        } catch (e) {
          if (/接通中|__unimplemented/.test(errMsg(e))) {
            try {
              await api.clip.write(content);
              toast('该功能需要较新版本支持，已把配置内容复制到剪贴板，可粘贴到文本文件保存', 'info', 6000);
            } catch (e2) { toast(`导出失败：${friendlyErr(e2)}`, 'error', 5000); }
          } else {
            toast(`导出失败：${friendlyErr(e)}`, 'error', 5000);
          }
        }
      };
      el.querySelector('#sc-import-props').onclick = () => openImportProps(id);

      const bakMinInput = el.querySelector('#sc-bak-min');
      el.querySelector('#sc-bak-save').onclick = async () => {
        const v = Math.max(0, Math.floor(Number(bakMinInput.value) || 0));
        try {
          const r = await api.servers.scheduleBackup({ id, intervalMinutes: v });
          toast((r && r.message) || (v ? `已开启自动备份，每 ${v} 分钟一次` : '已关闭自动备份'), 'ok', 5000);
        } catch (e) { toast(`自动备份设置失败：${friendlyErr(e)}`, 'error', 5000); }
      };
      const restartSw = el.querySelector('#sc-restart-sw');
      restartSw.addEventListener('change', async () => {
        const enabled = restartSw.checked;
        try {
          const r = await api.servers.setAutoRestart({ id, enabled });
          toast((r && r.message) || (enabled ? '已开启崩溃自动重启' : '已关闭崩溃自动重启'), 'ok', 5000);
        } catch (e) {
          restartSw.checked = !enabled;
          toast(`设置失败：${friendlyErr(e)}`, 'error', 5000);
        }
      });

      startBtn.onclick = async () => {
        if (srv.eulaAccepted === false) {
          toast('请先在上方勾选同意 Minecraft EULA，再启动服务器', 'warn', 4500);
          return;
        }
        startBtn.disabled = true;
        startBtn.textContent = '正在启动…';
        try {
          const r = await api.servers.start({ id });
          if (r && r.port != null) setPort(r.port);
          setStatus('starting');
          toast('启动命令已发出，服务器正在启动，可在下方控制台查看进度', 'info', 4500);
        } catch (e) {
          toast(`启动失败：${errMsg(e)}`, 'error');
          updateButtons();
        }
      };

      stopBtn.onclick = async () => {
        const ok = await confirmDialog('停止服务器',
          '停止前会自动保存世界，已连接的玩家会断开连接。确定停止吗？',
          { danger: true, okLabel: '停止服务器' });
        if (!ok) return;
        stopBtn.disabled = true;
        stopBtn.textContent = '正在停止…';
        try {
          await api.servers.stop({ id });
          setStatus('stopped');
          toast('服务器已停止，世界已保存', 'ok');
        } catch (e) {
          toast(`停止失败：${errMsg(e)}`, 'error');
          updateButtons();
        }
      };

      const cmdInput = el.querySelector('#sc-cmd');
      async function sendCmd() {
        const raw = cmdInput.value.trim();
        if (!raw) return;
        const text = raw.startsWith('/') ? raw.slice(1) : raw;
        if (!text) { cmdInput.value = ''; return; }
        try {
          await api.servers.sendCommand({ id, text });
          cmdInput.value = '';
        } catch (e) {
          toast(`命令发送失败：${errMsg(e)}`, 'error');
        }
      }
      el.querySelector('#sc-send').onclick = sendCmd;
      cmdInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendCmd(); });

      renderEula();
      updateButtons();

      sub('bb:server-console', (d) => {
        if (!d || String(d.id) !== String(id)) return;
        appendLines(d.lines);
      });
      sub('bb:server-status', (d) => {
        if (!d || String(d.id) !== String(id)) return;
        if (d.port != null) setPort(d.port);
        setStatus(d.status);
      });
    }

    await boot();
  },
};

export default [listPage, consolePage];
