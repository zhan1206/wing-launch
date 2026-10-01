// 性能页：硬件画像 / 性能建议 / 性能预设 / 一键优化 / 性能诊断 / 优化模组推荐
import { api, on } from '../api.js';
import { toast, confirmDialog, showDialog, emptyState, skeletonRows, setBreadcrumb, escapeHtml } from '../ui.js';

let cleanups = [];
function addCleanup(fn) { cleanups.push(fn); }
function runCleanups() { for (const f of cleanups) { try { f(); } catch { /* 忽略 */ } } cleanups = []; }
function sub(ch, cb) { try { const off = on(ch, cb); if (typeof off === 'function') addCleanup(off); } catch { /* 忽略 */ } }
function errMsg(e) { const m = e && e.message ? String(e.message) : String(e || ''); return m || '未知错误'; }
function gb(mb) { return (Number(mb) / 1024).toFixed(1); }
function instLabel(i) {
  const loader = i.loader && i.loader !== 'vanilla' ? ` · ${i.loader}` : '';
  return `${i.name}（${i.versionId || '未知版本'}${loader}）`;
}

function ensureStyle() {
  if (document.getElementById('pf-style')) return;
  const s = document.createElement('style');
  s.id = 'pf-style';
  s.textContent = `
    .pf-stats { display:grid; grid-template-columns: repeat(auto-fit, minmax(128px, 1fr)); gap:10px; }
    .pf-stat { background: var(--card-2); border-radius: var(--radius-sm); padding: 10px 12px; }
    .pf-stat .k { font-size: 11.5px; color: var(--fg-3); }
    .pf-stat .v { font-weight: 600; font-size: 14px; margin-top: 2px; word-break: break-all; }
    .pf-warnbox { margin-top: 12px; padding: 10px 12px; border-radius: var(--radius-sm); font-size: 12.5px;
      background: color-mix(in srgb, var(--warn) 12%, transparent);
      border: 1px solid color-mix(in srgb, var(--warn) 40%, transparent); color: var(--warn); }
    .pf-advice-row { display:flex; gap:9px; padding: 9px 2px; border-bottom: 1px dashed var(--border); font-size: 13px; }
    .pf-advice-row:last-child { border-bottom: none; }
    .pf-diff { padding: 9px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); margin-bottom: 8px; }
    .pf-diag-item { display:flex; gap:10px; align-items:flex-start; padding: 9px 2px; border-bottom: 1px dashed var(--border); }
    .pf-diag-item:last-child { border-bottom: none; }
    .pf-diag-icon { flex: 0 0 auto; font-size: 15px; }
  `;
  document.head.appendChild(s);
}

export default {
  id: 'performance',
  title: '性能',
  icon: '⚡',
  routes: ['/performance'],
  order: 3,
  async render(el, ctx) {
    runCleanups();
    ensureStyle();
    setBreadcrumb([{ label: '主页', onClick() { location.hash = '/'; } }, { label: '性能' }]);

    const state = {
      instances: [],
      instanceId: '',
      applied: new Set(),   // 本次会话里已应用过预设（可回滚）的实例
      installing: false,
      diagnosing: false,
    };

    el.innerHTML = `
      <div class="row mb-3" style="gap:12px;flex-wrap:wrap">
        <div class="col" style="gap:2px">
          <div class="bold" style="font-size:17px">性能</div>
          <div class="small muted">看看这台电脑适合怎么玩：自动分配内存、切换性能预设、诊断卡顿原因。</div>
        </div>
        <div class="spacer"></div>
        <label class="row" style="gap:6px;flex:0 0 auto">
          <span class="small muted-3">实例</span>
          <select class="input sm" id="pf-inst" style="width:auto;min-width:180px" aria-label="选择实例"></select>
        </label>
        <button class="btn" id="pf-diagnose" data-tip="游戏卡顿点这里，逐项检查原因">🩺 性能诊断（游戏卡顿点这里）</button>
        <button class="btn lg primary" id="pf-quick">⚡ 一键优化</button>
      </div>
      <div id="pf-hw">${skeletonRows(1)}</div>
      <div class="section-title">性能建议</div>
      <div id="pf-advice">${skeletonRows(2)}</div>
      <div class="section-title">性能预设 <span id="pf-rollback-slot" style="font-weight:400"></span></div>
      <div id="pf-presets">${skeletonRows(2)}</div>
      <div class="section-title">优化模组推荐</div>
      <div id="pf-mods">${skeletonRows(2)}</div>`;

    const $ = (sel) => el.querySelector(sel);

    /* ---------- 硬件画像 ---------- */
    function hwHtml(hw) {
      if (!hw) return '';
      const stats = [
        ['芯片', hw.chip || '未知'],
        ['显卡', hw.gpu || '未知'],
        ['内存总量', hw.totalGB != null ? `${hw.totalGB} GB` : '未知'],
        ['可用磁盘', hw.diskFreeGB != null ? `${hw.diskFreeGB} GB` : '未知'],
        ['CPU 核心', hw.cpuCores != null ? `${hw.cpuCores} 核` : '未知'],
      ];
      return `<div class="card">
        <div class="row mb-2"><span class="bold">硬件画像</span><span class="spacer"></span><span class="tiny muted">这台电脑的基本情况，建议都基于它给出</span></div>
        <div class="pf-stats">${stats.map(([k, v]) => `<div class="pf-stat"><div class="k">${escapeHtml(k)}</div><div class="v">${escapeHtml(String(v))}</div></div>`).join('')}</div>
        <div id="pf-hw-warn"></div>
      </div>`;
    }
    function showDetectWarn(text) {
      const box = $('#pf-hw-warn');
      if (box) box.innerHTML = text ? `<div class="pf-warnbox">⚠️ ${escapeHtml(String(text))}</div>` : '';
    }
    function renderHw(hw) { $('#pf-hw').innerHTML = hwHtml(hw); }

    async function loadProfile() {
      try {
        const hw = await api.perf.profile();
        renderHw(hw);
        return hw;
      } catch (e) {
        $('#pf-hw').innerHTML = `<div class="card"><div class="bold">硬件信息没有读出来</div>
          <div class="small muted mt-1">发生了什么：${escapeHtml(errMsg(e))}</div>
          <div class="small muted mt-1">可能是系统暂时没有响应，不影响其他功能。</div>
          <button class="btn mt-3" id="pf-hw-retry">重试</button></div>`;
        const b = $('#pf-hw-retry');
        if (b) b.onclick = () => { $('#pf-hw').innerHTML = skeletonRows(1); loadProfile(); };
        return null;
      }
    }

    /* ---------- 实例下拉 ---------- */
    function renderInstSelect() {
      const sel = $('#pf-inst');
      if (!sel) return;
      const keep = state.instanceId;
      if (!state.instances.length) {
        sel.innerHTML = `<option value="">还没有实例</option>`;
        sel.disabled = true;
        return;
      }
      sel.disabled = false;
      sel.innerHTML = state.instances.map((i) => `<option value="${escapeHtml(i.id)}">${escapeHtml(instLabel(i))}</option>`).join('');
      const sortedIds = state.instances.map((i) => i.id);
      state.instanceId = sortedIds.includes(keep) ? keep : sortedIds[0];
      sel.value = state.instanceId;
    }
    $('#pf-inst').onchange = () => {
      state.instanceId = $('#pf-inst').value;
      updateRollbackBtn();
      loadAdvice();
      loadMods();
    };

    /* ---------- 性能建议 ---------- */
    async function loadAdvice() {
      const box = $('#pf-advice');
      if (!box) return;
      if (!state.instances.length) {
        box.innerHTML = emptyState({
          icon: '🗂️',
          title: '还没有实例',
          text: '创建一个游戏实例后，这里会结合硬件和实例情况给出内存等建议。',
          actionsHtml: '<button class="btn primary" id="pf-go-create">去创建第一个实例</button>',
        });
        const b = box.querySelector('#pf-go-create');
        if (b) b.onclick = () => { location.hash = '/instances'; };
        return;
      }
      box.innerHTML = skeletonRows(2);
      const hasInst = !!state.instanceId;
      let r = null, err = null;
      try { r = await api.perf.advice(hasInst ? { instanceId: state.instanceId } : {}); }
      catch (e) { err = e; }
      if (r) {
        if (r.hw) renderHw(r.hw);
        showDetectWarn(r.detectFailedText || null);
        const rows = (Array.isArray(r.advice) ? r.advice : [])
          .map((a) => `<div class="pf-advice-row"><span style="flex:0 0 auto">💡</span><span>${escapeHtml(a && a.text ? a.text : '')}</span></div>`)
          .join('');
        box.innerHTML = `<div class="card">
          <div class="row mb-2"><span class="bold">${hasInst ? '针对当前实例的建议' : '通用建议'}</span>
            ${r.memoryMB != null ? `<span class="badge accent">建议内存 ${escapeHtml(gb(r.memoryMB))} GB</span>` : ''}
            <span class="spacer"></span>${hasInst ? '' : '<span class="tiny muted">选择实例后可给出针对该实例的建议</span>'}</div>
          ${rows || '<div class="small muted">暂时没有针对这台设备的建议，直接开玩即可。</div>'}
        </div>`;
        return;
      }
      // 调用失败：无实例时只提示硬件部分，有实例时给错误与重试
      if (!hasInst) {
        box.innerHTML = `<div class="card"><div class="row"><span>💡</span><span class="small">通用的性能建议暂时没有取到（${escapeHtml(errMsg(err))}）。</span></div>
          <div class="small muted mt-1">选择实例后可给出针对该实例的建议。</div></div>`;
        return;
      }
      box.innerHTML = `<div class="card"><div class="bold">性能建议加载失败</div>
        <div class="small muted mt-1">发生了什么：${escapeHtml(errMsg(err))}</div>
        <div class="small muted mt-1">可以点「重试」再试一次；硬件画像不受影响。</div>
        <button class="btn mt-3" id="pf-advice-retry">重试</button></div>`;
      const b = box.querySelector('#pf-advice-retry');
      if (b) b.onclick = () => loadAdvice();
    }

    /* ---------- 性能预设 ---------- */
    let presets = [];
    async function loadPresets() {
      const box = $('#pf-presets');
      if (!box) return;
      box.innerHTML = skeletonRows(3);
      try {
        presets = await api.perf.presets();
      } catch (e) {
        box.innerHTML = `<div class="card"><div class="bold">性能预设加载失败</div>
          <div class="small muted mt-1">发生了什么：${escapeHtml(errMsg(e))}</div>
          <button class="btn mt-3" id="pf-presets-retry">重试</button></div>`;
        const b = box.querySelector('#pf-presets-retry');
        if (b) b.onclick = () => loadPresets();
        return;
      }
      if (!Array.isArray(presets) || !presets.length) {
        box.innerHTML = emptyState({ icon: '🎛️', title: '暂时没有可用的预设', text: '可以先用「一键优化」，它会按当前实例自动配置。' });
        return;
      }
      box.innerHTML = `<div class="grid auto">${presets.map((p) => `
        <div class="card hoverable" data-preset="${escapeHtml(p.id)}" role="button" tabindex="0" aria-label="查看预设 ${escapeHtml(p.name)}">
          <div class="bold">${escapeHtml(p.name || '未命名预设')}</div>
          <div class="small muted mt-1" style="min-height:38px">${escapeHtml(p.desc || '')}</div>
          <div class="tiny muted-3 mt-1">点击查看会改动哪些设置</div>
        </div>`).join('')}</div>`;
      for (const card of box.querySelectorAll('[data-preset]')) {
        const p = presets.find((x) => x.id === card.dataset.preset);
        const open = () => openPresetDiff(p);
        card.onclick = open;
        card.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
      }
    }

    function needInstance() {
      if (state.instanceId) return false;
      toast(state.instances.length ? '请先在右上角选择一个实例' : '还没有实例，先去创建一个吧', 'warn');
      return true;
    }

    function diffBody(preset, diff) {
      const rows = (Array.isArray(diff.diffs) ? diff.diffs : [])
        .map((d) => `<div class="pf-diff"><div class="bold small">${escapeHtml(d && d.text ? d.text : '')}</div>
          <div class="tiny muted mt-1">为什么：${escapeHtml(d && d.why ? d.why : '')}</div></div>`).join('');
      return `${rows || '<div class="small muted">这个预设与当前设置一致，不会改动任何内容。</div>'}
        ${diff.expect ? `<div class="small mt-2">预期效果：${escapeHtml(diff.expect)}</div>` : ''}
        <div class="tiny muted mt-2">优化前的设置会自动备份，随时可以「一键回滚」。</div>`;
    }

    async function openPresetDiff(preset) {
      if (!preset) return;
      if (needInstance()) return;
      const instanceId = state.instanceId;
      // catch 后打标记，避免用户点「取消」时出现未处理的 Promise 拒绝
      const diffPromise = api.perf.presetDiff({ instanceId, presetId: preset.id }).catch((e) => ({ __pfError: e }));
      const ok = await showDialog({
        title: `切换到「${preset.name}」？`,
        wide: true,
        body: `<div class="row"><span class="spinner sm"></span><span class="small muted">正在计算会改动哪些设置…</span></div>`,
        actions: [{ label: '取消', value: false }, { label: '确认切换', value: true, primary: true }],
        onMount(mask) {
          diffPromise.then((diff) => {
            if (!mask.isConnected) return;
            if (diff && diff.__pfError) {
              mask.querySelector('.dialog-body').innerHTML = `<div class="small" style="color:var(--err)">预设内容没有取到：${escapeHtml(errMsg(diff.__pfError))}</div>
                <div class="small muted mt-1">可以关闭后重新点击这张卡片再试。</div>`;
              return;
            }
            mask.querySelector('.dialog-body').innerHTML = diffBody(preset, diff || {});
          });
        },
      });
      if (!ok) return;
      const diff = await diffPromise;
      if (diff && diff.__pfError) { toast(`切换失败：预设内容没有取到（${errMsg(diff.__pfError)}）`, 'error', 5000); return; }
      try {
        const r = await api.perf.applyPreset({ instanceId, presetId: preset.id });
        state.applied.add(instanceId);
        updateRollbackBtn();
        toast((r && r.summary) || `已切换到「${preset.name}」`, 'ok', 7000);
        loadAdvice();
      } catch (e) {
        toast(`切换失败：${errMsg(e)}`, 'error', 5000);
      }
    }

    function updateRollbackBtn() {
      const slot = $('#pf-rollback-slot');
      if (!slot) return;
      if (state.instanceId && state.applied.has(state.instanceId)) {
        slot.innerHTML = `<button class="btn sm" id="pf-rollback">↩️ 一键回滚</button>`;
        const b = slot.querySelector('#pf-rollback');
        if (b) b.onclick = doRollback;
      } else {
        slot.innerHTML = '';
      }
    }
    async function doRollback() {
      if (needInstance()) return;
      const instanceId = state.instanceId;
      try {
        const msg = await api.perf.rollback({ instanceId });
        state.applied.delete(instanceId);
        updateRollbackBtn();
        toast(String(msg || '已恢复到优化前的设置'), 'ok', 6000);
        loadAdvice();
      } catch (e) {
        toast(`回滚失败：${errMsg(e)}`, 'error', 5000);
      }
    }

    /* ---------- 一键优化 ---------- */
    $('#pf-quick').onclick = async () => {
      if (needInstance()) return;
      const inst = state.instances.find((i) => i.id === state.instanceId);
      const ok = await confirmDialog('一键优化',
        `将按「模组友好」预设优化「${inst ? inst.name : '当前实例'}」：自动分配更合适的内存并启用垃圾回收调优，减少顿卡和崩溃。优化前的设置会自动备份，随时可以一键回滚。`,
        { okLabel: '开始优化' });
      if (!ok) return;
      try {
        const r = await api.perf.applyPreset({ instanceId: state.instanceId, presetId: 'modded' });
        state.applied.add(state.instanceId);
        updateRollbackBtn();
        toast('优化完成', 'ok');
        showDialog({
          title: '一键优化完成',
          body: `<p>${escapeHtml((r && r.summary) || '已按当前硬件与模组情况完成优化，重新启动游戏后生效。')}</p>`,
          actions: [{ label: '知道了', value: true, primary: true }],
        });
        loadAdvice();
      } catch (e) {
        toast(`一键优化没有完成：${errMsg(e)}`, 'error', 5000);
      }
    };

    /* ---------- 性能诊断 ---------- */
    $('#pf-diagnose').onclick = () => openDiagnose();
    async function openDiagnose() {
      if (needInstance()) return;
      const instanceId = state.instanceId;
      await showDialog({
        title: '性能诊断',
        wide: true,
        body: `<div class="row"><span class="spinner sm"></span><span class="small muted">正在逐项检查，几秒钟就好…</span></div>`,
        actions: [{ label: '关闭', value: true, primary: true }],
        onMount(mask) { runDiagnose(mask, instanceId); },
      });
    }
    async function runDiagnose(mask, instanceId) {
      const body = mask.querySelector('.dialog-body');
      if (!body || !mask.isConnected) return;
      body.innerHTML = `<div class="row"><span class="spinner sm"></span><span class="small muted">正在逐项检查，几秒钟就好…</span></div>`;
      let r = null, err = null;
      try { r = await api.perf.diagnose({ instanceId }); } catch (e) { err = e; }
      if (!mask.isConnected) return;
      if (!r) {
        body.innerHTML = `<div class="bold" style="color:var(--err)">性能诊断没有完成</div>
          <div class="small mt-1">发生了什么：${escapeHtml(errMsg(err))}</div>
          <div class="small muted mt-1">可能是后台检查暂时出了问题，可以点「重试」再试一次；如果反复失败，请到帮助中心反馈。</div>
          <button class="btn mt-3" id="pf-diag-retry">重试</button>`;
        const b = body.querySelector('#pf-diag-retry');
        if (b) b.onclick = () => runDiagnose(mask, instanceId);
        return;
      }
      const items = Array.isArray(r.items) ? r.items : [];
      if (!items.length) {
        body.innerHTML = '<div class="small muted">没有检查出任何问题，一切正常。</div>';
        return;
      }
      body.innerHTML = items.map((it, idx) => `
        <div class="pf-diag-item">
          <span class="pf-diag-icon">${it && it.ok ? '✅' : '⚠️'}</span>
          <div class="col" style="gap:3px;flex:1;min-width:0">
            <div class="bold small">${escapeHtml((it && it.title) || '检查项')}</div>
            <div class="small muted">${escapeHtml((it && it.detail) || '')}</div>
          </div>
          ${it && it.fix ? `<button class="btn sm" data-fix="${idx}" style="flex:0 0 auto">一键修复</button>` : ''}
        </div>`).join('') + '<div class="tiny muted mt-2">修复完成后会自动重新检查一遍。</div>';
      for (const btn of body.querySelectorAll('[data-fix]')) {
        const it = items[Number(btn.dataset.fix)];
        btn.onclick = async () => {
          btn.disabled = true;
          try {
            const res = await api.fixes.apply({ instanceId, fix: it.fix });
            toast(String((res && res.message) || '修复完成'), 'ok', 5000);
            runDiagnose(mask, instanceId);
          } catch (e) {
            btn.disabled = false;
            toast(`修复没有完成：${errMsg(e)}`, 'error', 5000);
          }
        };
      }
    }

    /* ---------- 优化模组推荐 ---------- */
    async function loadMods() {
      const box = $('#pf-mods');
      if (!box) return;
      if (!state.instances.length) {
        box.innerHTML = `<div class="card"><div class="small muted">创建实例后，这里会推荐值得安装的优化模组（如 Sodium、Lithium）。</div></div>`;
        return;
      }
      if (!state.instanceId) {
        box.innerHTML = `<div class="card"><div class="small muted">选择实例后，这里会推荐值得安装的优化模组。</div></div>`;
        return;
      }
      box.innerHTML = skeletonRows(2);
      let r = null, err = null;
      try { r = await api.perf.detectMods({ instanceId: state.instanceId }); } catch (e) { err = e; }
      if (!r) {
        box.innerHTML = `<div class="card"><div class="bold">优化模组检查失败</div>
          <div class="small muted mt-1">发生了什么：${escapeHtml(errMsg(err))}</div>
          <button class="btn mt-3" id="pf-mods-retry">重试</button></div>`;
        const b = box.querySelector('#pf-mods-retry');
        if (b) b.onclick = () => loadMods();
        return;
      }
      const missing = Array.isArray(r.missing) ? r.missing : [];
      if (!missing.length) {
        box.innerHTML = `<div class="card"><div class="row"><span>✅</span><span class="small">这个实例已经装好了常用的优化模组，无需再装。</span></div></div>`;
        return;
      }
      box.innerHTML = `<div class="card">
        <div class="row mb-2"><span class="bold">推荐安装这些优化模组</span>
          <span class="spacer"></span>
          <button class="btn sm primary" id="pf-mods-install">一键安装（${missing.length} 个）</button></div>
        ${missing.map((m) => `<div class="pf-advice-row"><span style="flex:0 0 auto">🧩</span>
          <div class="col" style="gap:2px"><span class="bold small">${escapeHtml(m.name || m.slug || '优化模组')}</span>
          <span class="tiny muted">${escapeHtml(m.desc || '')}</span></div></div>`).join('')}
        <div class="tiny muted mt-2">安装会自动匹配当前实例的游戏版本${state.instances.find((i) => i.id === state.instanceId)?.loader && state.instances.find((i) => i.id === state.instanceId).loader !== 'vanilla' ? '和模组加载器' : ''}，进度可在下载中心查看。</div>
      </div>`;
      const btn = box.querySelector('#pf-mods-install');
      if (btn) btn.onclick = () => installPerfMods(missing);
    }

    async function installPerfMods(missing) {
      if (state.installing) { toast('正在安装中，请稍等', 'info'); return; }
      if (needInstance()) return;
      const inst = state.instances.find((i) => i.id === state.instanceId);
      if (!inst) { toast('找不到当前实例，请重新选择', 'error'); return; }
      state.installing = true;
      const fails = [];
      let okCount = 0;
      for (let i = 0; i < missing.length; i++) {
        const m = missing[i] || {};
        const name = m.name || m.slug || '优化模组';
        toast(`（${i + 1}/${missing.length}）正在安装 ${name}…`, 'info', 2500);
        try {
          const found = await api.mods.search({
            query: m.slug || name,
            gameVersion: inst.versionId,
            loader: inst.loader && inst.loader !== 'vanilla' ? inst.loader : undefined,
            limit: 5,
          });
          const list = Array.isArray(found) ? found : [];
          const hit = list.find((x) => x && x.slug === m.slug) || list[0];
          if (!hit || hit.projectId == null) {
            fails.push({ name, reason: '没有找到适配当前游戏版本和加载器的版本，可以稍后在模组市场手动搜索安装。' });
            continue;
          }
          const res = await api.mods.install({ instanceId: inst.id, projectId: hit.projectId });
          okCount++;
          const warns = res && Array.isArray(res.warnings) ? res.warnings : [];
          if (warns.length) toast(`${name} 已安装，注意：${warns.join('；')}`, 'warn', 6000);
          else toast(`${name} 已安装`, 'ok');
        } catch (e) {
          fails.push({ name, reason: errMsg(e) });
        }
      }
      state.installing = false;
      if (okCount) toast(`已安装 ${okCount} 个优化模组，重启游戏后生效`, 'ok', 5000);
      if (fails.length) {
        showDialog({
          title: '部分模组没有装上',
          wide: true,
          body: fails.map((f) => `<div class="pf-diff"><div class="bold small">${escapeHtml(f.name)}</div>
            <div class="tiny muted mt-1">${escapeHtml(f.reason)}</div></div>`).join('') +
            '<div class="tiny muted">其余模组不受影响，已经装好的重启游戏即可生效。</div>',
          actions: [{ label: '知道了', value: true, primary: true }],
        });
      }
      loadMods();
    }

    /* ---------- 启动加载 ---------- */
    async function initInstances() {
      const errCard = el.querySelector('#pf-inst-err');
      if (errCard) errCard.remove();
      try {
        const list = await api.instances.list();
        state.instances = (Array.isArray(list) ? list : [])
          .slice()
          .sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
      } catch (e) {
        el.insertAdjacentHTML('afterbegin', `<div class="card mb-3" id="pf-inst-err"><div class="bold">实例列表加载失败</div>
          <div class="small muted mt-1">发生了什么：${escapeHtml(errMsg(e))}</div>
          <div class="small muted mt-1">没有实例列表就无法给出针对实例的建议，硬件画像和其他功能不受影响。</div>
          <button class="btn mt-3" id="pf-inst-retry">重试</button></div>`);
        const b = el.querySelector('#pf-inst-retry');
        if (b) b.onclick = () => initInstances();
        return;
      }
      renderInstSelect();
      updateRollbackBtn();
      loadAdvice();
      loadMods();
    }
    initInstances();
    loadProfile();
    loadPresets();

    // 实例变化（如安装模组、切换预设后）自动刷新下拉与建议
    sub('bb:instances-changed', async () => {
      try {
        const list = await api.instances.list();
        state.instances = (Array.isArray(list) ? list : [])
          .slice()
          .sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
        renderInstSelect();
        updateRollbackBtn();
        loadAdvice();
        loadMods();
      } catch { /* 静默：下次操作时会重试 */ }
    });
  },
};
