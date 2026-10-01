// 通用 UI 组件：toast / 弹窗 / 确认框 / 骨架屏 / 空状态 / 进度
const $ = (sel, el = document) => el.querySelector(sel);

export function toast(text, type = 'info', ms = 3000) {
  const holder = $('#toast-holder');
  const icons = { ok: '✅', warn: '⚠️', error: '❌', info: '💡' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.innerHTML = `<span class="t-icon" aria-hidden="true">${icons[type] || icons.info}</span><span class="ellipsis-2">${escapeHtml(text)}</span>`;
  holder.appendChild(el);
  const remove = () => { el.classList.add('out'); setTimeout(() => el.remove(), 260); };
  const timer = setTimeout(remove, ms);
  el.addEventListener('click', () => { clearTimeout(timer); remove(); });
  while (holder.children.length > 5) holder.firstChild.remove();
}
// 主进程主动推送的 toast
export function listenMainToasts() {
  window.bb.raw.on('bb:toast', (t) => toast(t.text, t.type || 'info', t.ms || 3000));
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 弹窗：showDialog({title, body(html), actions:[{label, value, primary, danger}], wide})
export function showDialog({ title, body = '', actions = [{ label: '知道了', value: true, primary: true }], wide = false, onMount }) {
  return new Promise((resolve) => {
    const mask = document.createElement('div');
    mask.className = 'mask';
    mask.setAttribute('role', 'dialog');
    mask.setAttribute('aria-modal', 'true');
    mask.setAttribute('aria-label', title || '对话框');
    const prevFocus = document.activeElement;
    mask.innerHTML = `<div class="dialog ${wide ? 'wide' : ''}">
      ${title ? `<h3>${escapeHtml(title)}</h3>` : ''}
      <div class="dialog-body">${body}</div>
      <div class="dialog-actions"></div>
    </div>`;
    const acts = $('.dialog-actions', mask);
    for (const a of actions) {
      const btn = document.createElement('button');
      btn.className = `btn ${a.primary ? 'primary' : ''} ${a.danger ? 'danger' : ''}`;
      btn.textContent = a.label;
      btn.onclick = () => { mask.remove(); resolve(a.value); };
      acts.appendChild(btn);
    }
    mask.addEventListener('click', (e) => { if (e.target === mask) { mask.remove(); resolve(null); } });
    // 键盘：Esc 关闭 + Tab 焦点圈定
    const focusables = () => [...mask.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"`)')].filter((x) => !x.disabled);
    mask.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); mask.remove(); resolve(null); return; }
      if (e.key === 'Tab') {
        const f = focusables(); if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    setTimeout(() => { const f = focusables(); (actions[0] && actions[0].primary ? f.find((x) => x.classList.contains('primary')) || f[0] : f[0])?.focus?.(); }, 60);
    const origRemove = mask.remove.bind(mask);
    mask.remove = () => { try { prevFocus?.focus?.(); } catch { /* */ } origRemove(); };
    $('#modal-holder').appendChild(mask);
    if (onMount) onMount(mask, (v) => { mask.remove(); resolve(v); });
  });
}

export function confirmDialog(title, message, { danger = false, okLabel = '确定', cancelLabel = '取消' } = {}) {
  return showDialog({
    title,
    body: `<p>${escapeHtml(message)}</p>`,
    actions: [
      { label: cancelLabel, value: false },
      { label: okLabel, value: true, primary: !danger, danger },
    ],
  });
}

// 表单弹窗：onMount 里自己放置控件，调用 close(value) 返回
export function formDialog(opts) { return showDialog(opts); }

export function skeletonRows(n = 3) {
  let html = '<div class="col">';
  for (let i = 0; i < n; i++) html += `<div class="skeleton skl-card" style="height:64px"></div>`;
  return html + '</div>';
}

export function emptyState({ icon = '📦', title, text, actionsHtml = '' }) {
  return `<div class="empty-state"><div class="big">${icon}</div>
    <div class="title">${escapeHtml(title)}</div>
    ${text ? `<div class="small">${escapeHtml(text)}</div>` : ''}
    ${actionsHtml ? `<div class="mt-3">${actionsHtml}</div>` : ''}</div>`;
}

export function progressBar(percent, { thin = false, indeterminate = false } = {}) {
  if (indeterminate || percent == null) {
    return `<div class="progress ${thin ? 'thin' : ''} indeterminate"><div class="bar"></div></div>`;
  }
  const p = Math.max(0, Math.min(100, percent));
  return `<div class="progress ${thin ? 'thin' : ''}" role="progressbar" aria-valuenow="${Math.round(p)}" aria-valuemin="0" aria-valuemax="100" aria-label="进度 ${Math.round(p)}%"><div class="bar" style="width:${p}%"></div></div>`;
}

// 渐变主题色文字（工具内部也用）
export function setBreadcrumb(items) {
  const bc = $('#breadcrumb');
  bc.innerHTML = '';
  items.forEach((it, i) => {
    const span = document.createElement('span');
    const last = i === items.length - 1;
    span.className = last ? 'crumb-current' : 'crumb-link';
    span.textContent = it.label;
    if (!last && it.onClick) span.onclick = it.onClick;
    bc.appendChild(span);
    if (!last) { const sep = document.createElement('span'); sep.textContent = '›'; bc.appendChild(sep); }
  });
}

// 右键菜单：attachContextMenu(el容器, items(触发对象)=>[{label, action, danger}])
export function attachContextMenu(selector, buildItems) {
  document.addEventListener('contextmenu', (e) => {
    const target = e.target.closest(selector);
    if (!target) return;
    e.preventDefault();
    const items = buildItems(target, e);
    if (!items?.length) return;
    closeContextMenu();
    const menu = document.createElement('div');
    menu.id = 'ctx-menu';
    menu.setAttribute('role', 'menu');
    Object.assign(menu.style, { position: 'fixed', zIndex: 1500, minWidth: '160px', background: 'var(--card)', border: '1px solid var(--border-2)', borderRadius: '10px', boxShadow: 'var(--shadow)', padding: '5px', left: Math.min(e.clientX, innerWidth - 190) + 'px', top: Math.min(e.clientY, innerHeight - items.length * 36 - 16) + 'px' });
    for (const it of items) {
      const b = document.createElement('button');
      b.setAttribute('role', 'menuitem');
      b.textContent = it.label;
      b.style.cssText = 'display:block;width:100%;text-align:left;padding:7px 12px;border:none;background:none;color:' + (it.danger ? 'var(--err)' : 'var(--fg)') + ';font:inherit;cursor:pointer;border-radius:6px;';
      b.onmouseenter = () => b.style.background = 'var(--hover)';
      b.onmouseleave = () => b.style.background = 'none';
      b.onclick = () => { closeContextMenu(); it.action?.(); };
      menu.appendChild(b);
    }
    document.body.appendChild(menu);
    menu.querySelector('button')?.focus?.();
    const close = (ev) => { if (!menu.contains(ev.target)) closeContextMenu(); };
    setTimeout(() => {
      document.addEventListener('click', close, { once: true });
      document.addEventListener('keydown', (ev2) => { if (ev2.key === 'Escape') closeContextMenu(); }, { once: true });
    }, 0);
  });
}
export function closeContextMenu() { document.getElementById('ctx-menu')?.remove(); }

// 拖拽文件路径收集
export function dragPaths(e) {
  const out = [];
  for (const f of e.dataTransfer.files) {
    try { out.push(window.bb.raw.pathForFile(f)); } catch { /* 忽略 */ }
  }
  return out;
}

// 全局拖拽文案（放在 ui 层避免与 main.mjs 循环引用）
export function setDropText(text) { const el = document.querySelector('#drop-text'); if (el) el.textContent = text; }
