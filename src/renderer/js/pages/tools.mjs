// 工具集：主入口 + 渐变文字 / 种子地图 / 投影工坊 / 模组翻译 / 配方生成器
import { api, on } from '../api.js';
import { toast, confirmDialog, showDialog, emptyState, skeletonRows, progressBar, setBreadcrumb, escapeHtml, dragPaths } from '../ui.js';
import { setDropText } from '../ui.js';

const $ = (s, r = document) => r.querySelector(s);
const emsg = (e) => (e && e.message ? String(e.message) : String(e));

/* ---------- 公共：清理与全局拖入文案 ---------- */
let offs = [];
const disposers = [];
function reg(fn) { if (typeof fn === 'function') offs.push(fn); }
function onDispose(fn) { if (typeof fn === 'function') disposers.push(fn); }
function cleanup() {
  offs.splice(0).forEach((f) => { try { f(); } catch { /* 忽略 */ } });
  disposers.splice(0).forEach((f) => { try { f(); } catch { /* 忽略 */ } });
}
function prepDrop(text) { setDropText(text || '松开鼠标，启动器会自动识别文件类型'); }

/* ================================================================
 * 主页面 /tools
 * ================================================================ */
const TOOLS = [
  { icon: '🎨', title: '渐变文字生成器', desc: '把文字染成 Minecraft 渐变色，生成可直接粘贴的 § 代码与 JSON 文本。', path: '/tools/gradient' },
  { icon: '🗺️', title: '种子地图', desc: '按种子预览生物群系分布，查找村庄、要塞等结构的位置。', path: '/tools/seedmap' },
  { icon: '🧊', title: '投影工坊', desc: '打开 .litematic / .schematic 投影，3D 预览、逐层查看、替换方块并导出。', path: '/tools/schematic' },
  { icon: '🌐', title: '模组翻译', desc: '用 AI 翻译模组中缺失的中文条目，生成资源包并自动装进实例。', path: '/tools/translate' },
  { icon: '📜', title: '配方生成器', desc: '可视化拼装合成 / 熔炼配方，一键导出为数据包。', path: '/tools/recipe' },
];

function crumb(sub) {
  const items = [{ label: '主页', onClick() { location.hash = '/'; } }, { label: '工具集', onClick() { location.hash = '/tools'; } }];
  if (sub) items.push({ label: sub });
  setBreadcrumb(items);
}

async function renderToolsMain(el) {
  cleanup(); prepDrop();
  crumb();
  el.innerHTML = `
    <div style="font-size:20px;font-weight:700">🧰 工具集</div>
    <div class="small muted mb-3">给玩家准备的实用小工具，用完即走。</div>
    <div class="grid auto">
      ${TOOLS.map((t, i) => `
        <div class="card hoverable" data-tool="${i}" style="min-height:132px">
          <div style="font-size:26px">${t.icon}</div>
          <div class="bold mt-1">${t.title}</div>
          <div class="tiny muted mt-1" style="line-height:1.7">${t.desc}</div>
        </div>`).join('')}
    </div>`;
  el.querySelectorAll('[data-tool]').forEach((c) => {
    c.onclick = () => { location.hash = TOOLS[Number(c.dataset.tool)].path; };
  });
}

/* ================================================================
 * 1. 渐变文字生成器 /tools/gradient（纯前端）
 * ================================================================ */
const grad = { text: '方块盒子', c1: '#ff5c5c', c2: '#4f8cff', dir: 'h', n: 2 };

function hexToRgb(hex) {
  const m = String(hex || '').replace('#', '');
  const n = parseInt(m.length === 3 ? m.split('').map((c) => c + c).join('') : m, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
}
function lerpRgb(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function gradStops() {
  const c1 = hexToRgb(grad.c1), c2 = hexToRgb(grad.c2), n = grad.n, out = [];
  for (let i = 0; i < n; i++) out.push(n === 1 ? c1 : lerpRgb(c1, c2, i / (n - 1)));
  return out;
}
function gradSample(stops, t) {
  const pos = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(pos));
  const f = pos - i;
  return lerpRgb(stops[i], stops[i + 1] === undefined ? stops[i] : stops[i + 1], f);
}
function gradLines() { return (grad.text || '').split('\n'); }
function gradT(dir, rowN, colN) {
  if (dir === 'v') return rowN;
  if (dir === 'd') return (rowN + colN) / 2;
  return colN;
}
function gradCharColors() {
  const stops = gradStops();
  const lines = gradLines();
  const maxLen = Math.max(1, ...lines.map((l) => l.length));
  const rows = lines.length;
  const out = [];
  for (let r = 0; r < rows; r++) {
    const rowN = rows > 1 ? r / (rows - 1) : 0;
    const line = lines[r];
    const row = [];
    for (let c = 0; c < line.length; c++) {
      const colN = line.length > 1 ? c / (line.length - 1) : (rows > 1 ? rowN : 0);
      row.push(rgbToHex(...gradSample(stops, gradT(grad.dir, rowN, colN))));
    }
    out.push(row);
  }
  return out;
}
function gradCodes() {
  const rows = gradCharColors();
  let modern = '', legacy = '';
  const json = [];
  rows.forEach((row, ri) => {
    if (ri > 0) { json.push({ text: '\n' }); modern += '\n'; legacy += '\n'; }
    for (let i = 0; i < row.length; i++) {
      const ch = gradLines()[ri][i];
      const hex = row[i];
      modern += '§x' + hex.slice(1).split('').map((c) => '§' + c).join('');
      legacy += '§#' + hex.slice(1);
      json.push({ text: ch, color: hex });
    }
  });
  return { modern, legacy, json: JSON.stringify(json) };
}

async function copyText(label, text) {
  if (!text) { toast('没有可复制的内容，先输入文字', 'warn'); return; }
  try {
    await api.clip.write({ text });
    toast(`${label}已复制到剪贴板`, 'ok', 2000);
  } catch (e) {
    toast('复制失败：' + emsg(e) + '。可以手动选中文本复制。', 'error');
  }
}

async function renderGradient(el) {
  cleanup(); prepDrop();
  crumb('渐变文字生成器');
  el.innerHTML = `
    <div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1.3fr);gap:14px" id="gr-wrap">
      <div class="card">
        <label class="field"><span class="field-label">文字（支持多行）</span>
          <textarea class="input" id="gr-text" rows="2">${escapeHtml(grad.text)}</textarea></label>
        <div class="row" style="gap:16px">
          <label class="field" style="margin-bottom:0"><span class="field-label">起始颜色</span>
            <input type="color" id="gr-c1" value="${grad.c1}" style="width:56px;height:34px;padding:2px;border:1px solid var(--border-2);border-radius:7px;background:var(--card)"></label>
          <label class="field" style="margin-bottom:0"><span class="field-label">结束颜色</span>
            <input type="color" id="gr-c2" value="${grad.c2}" style="width:56px;height:34px;padding:2px;border:1px solid var(--border-2);border-radius:7px;background:var(--card)"></label>
          <label class="field" style="margin-bottom:0"><span class="field-label">颜色数量</span>
            <select class="input sm" id="gr-n" style="width:96px">
              ${[2, 3, 4].map((n) => `<option value="${n}" ${grad.n === n ? 'selected' : ''}>${n} 色</option>`).join('')}
            </select></label>
        </div>
        <label class="field mt-3"><span class="field-label">渐变方向</span>
          <div class="row" id="gr-dir">
            <button class="btn sm" data-d="h">➡️ 水平</button>
            <button class="btn sm" data-d="v">⬇️ 垂直</button>
            <button class="btn sm" data-d="d">↗️ 对角</button>
          </div></label>
        <div class="field mt-3"><span class="field-label">插值出的颜色（起止之间均匀分布）</span>
          <div class="row" id="gr-swatches" style="gap:6px"></div></div>
        <div class="small muted" style="line-height:1.7">§ 代码可粘贴到游戏内告示牌、聊天框或命令中（需要相应权限）。JSON 文本组件可用在 /tellraw、/title 等命令与数据包里。</div>
      </div>
      <div class="col">
        <div class="card">
          <div class="small muted mb-2">实时预览</div>
          <div id="gr-preview" style="min-height:88px;font-size:34px;font-weight:800;letter-spacing:2px;line-height:1.5;white-space:pre-wrap;word-break:break-all"></div>
        </div>
        <div class="card">
          <div class="row mb-2"><span class="bold">§x 现代格式</span><div class="spacer"></div><button class="btn sm" id="gr-copy-modern">复制格式化代码</button></div>
          <pre id="gr-out-modern" class="small" style="font-family:'SF Mono',Menlo,monospace;white-space:pre-wrap;word-break:break-all;max-height:96px;overflow:auto;user-select:text;background:var(--card-2);border-radius:7px;padding:8px 10px"></pre>
          <div class="row mb-2 mt-3"><span class="bold">§# 格式（模组常用）</span><div class="spacer"></div><button class="btn sm" id="gr-copy-legacy">复制 §# 代码</button></div>
          <pre id="gr-out-legacy" class="small" style="font-family:'SF Mono',Menlo,monospace;white-space:pre-wrap;word-break:break-all;max-height:96px;overflow:auto;user-select:text;background:var(--card-2);border-radius:7px;padding:8px 10px"></pre>
          <div class="row mb-2 mt-3"><span class="bold">JSON 文本组件</span><div class="spacer"></div><button class="btn sm" id="gr-copy-json">复制 JSON</button></div>
          <pre id="gr-out-json" class="small" style="font-family:'SF Mono',Menlo,monospace;white-space:pre-wrap;word-break:break-all;max-height:96px;overflow:auto;user-select:text;background:var(--card-2);border-radius:7px;padding:8px 10px"></pre>
        </div>
      </div>
    </div>`;

  function sync() {
    const lines = gradLines();
    const colors = gradCharColors();
    const pv = $('#gr-preview');
    if (!grad.text) {
      pv.innerHTML = '<span class="muted" style="font-size:14px;font-weight:400">输入文字后，这里会显示逐字渐变的效果。</span>';
    } else {
      pv.innerHTML = colors.map((row, ri) => {
        const chars = row.map((hex, i) => `<span style="color:${hex}">${escapeHtml(lines[ri][i] || '')}</span>`).join('');
        return chars || '&nbsp;';
      }).join('\n');
    }
    const stops = gradStops();
    $('#gr-swatches').innerHTML = stops.map((c) => {
      const hex = rgbToHex(...c);
      return `<span title="${hex}" style="width:34px;height:22px;border-radius:5px;border:1px solid var(--border-2);background:${hex};display:inline-block"></span>`;
    }).join('');
    const has = !!grad.text;
    const codes = gradCodes();
    $('#gr-out-modern').textContent = has ? codes.modern : '';
    $('#gr-out-legacy').textContent = has ? codes.legacy : '';
    $('#gr-out-json').textContent = has ? codes.json : '';
    for (const id of ['gr-copy-modern', 'gr-copy-legacy', 'gr-copy-json']) $('#' + id).disabled = !has;
    $('#gr-dir').querySelectorAll('button').forEach((b) => {
      const on = b.dataset.d === grad.dir;
      b.className = 'btn sm' + (on ? ' primary' : '');
    });
  }

  $('#gr-text').oninput = (e) => { grad.text = e.target.value; sync(); };
  $('#gr-c1').oninput = (e) => { grad.c1 = e.target.value; sync(); };
  $('#gr-c2').oninput = (e) => { grad.c2 = e.target.value; sync(); };
  $('#gr-n').onchange = (e) => { grad.n = Number(e.target.value) || 2; sync(); };
  $('#gr-dir').querySelectorAll('button').forEach((b) => { b.onclick = () => { grad.dir = b.dataset.d; sync(); }; });
  $('#gr-copy-modern').onclick = () => copyText('格式化代码', $('#gr-out-modern').textContent);
  $('#gr-copy-legacy').onclick = () => copyText('§# 代码', $('#gr-out-legacy').textContent);
  $('#gr-copy-json').onclick = () => copyText('JSON', $('#gr-out-json').textContent);
  sync();
}

/* ================================================================
 * 2. 种子地图 /tools/seedmap
 * ================================================================ */
// cx/cz 视作地图中心的世界方块坐标（与结构返回的 x/z 同一坐标系）
const sm = {
  seed: '', version: '1.21', size: 512, scale: 8, cx: 0, cz: 0,
  data: null, off: null, offData: null, structures: [], highlights: [],
  hits: [], structWarned: false, reqId: 0, el: null, wheelPending: null, wheelTimer: null,
};
const SM_VERSIONS = ['1.21', '1.20.4', '1.19.4', '1.18.2', '1.16.5', '1.12.2'];
const SM_SCALES = [4, 8, 16, 32];
const STRUCT_TYPES = [
  { id: 'village', zh: '村庄', icon: '🏠' },
  { id: 'stronghold', zh: '要塞', icon: '🟣' },
  { id: 'desert_pyramid', zh: '沙漠神殿', icon: '🟡' },
  { id: 'desert_temple', zh: '沙漠神殿', icon: '🟡' },
  { id: 'ocean_monument', zh: '海底神殿', icon: '🔵' },
  { id: 'monument', zh: '海底神殿', icon: '🔵' },
  { id: 'mansion', zh: '林地府邸', icon: '🟤' },
  { id: 'nether_fortress', zh: '下界要塞', icon: '🟠' },
  { id: 'fortress', zh: '下界要塞', icon: '🟠' },
  { id: 'pillager_outpost', zh: '掠夺者前哨站', icon: '🗼' },
  { id: 'shipwreck', zh: '沉船', icon: '🚢' },
  { id: 'ruin', zh: '遗迹', icon: '🏛️' },
];
function structZh(type) { const t = STRUCT_TYPES.find((x) => x.id === String(type)); return t ? t.zh : String(type || '未知结构'); }
function structIcon(type) { const t = STRUCT_TYPES.find((x) => x.id === String(type)); return t ? t.icon : '📍'; }
function findStructType(q) {
  const s = String(q || '').trim().toLowerCase();
  return STRUCT_TYPES.find((x) => x.zh === q) || STRUCT_TYPES.find((x) => x.id === s)
    || STRUCT_TYPES.find((x) => x.id.includes(s) || x.zh.includes(q));
}
function dir8(dx, dz) {
  const deg = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
  return ['北', '东北', '东', '东南', '南', '西南', '西', '西北'][Math.round(deg / 45) % 8];
}
function parseColor(c) {
  if (typeof c === 'number') return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  const m = String(c || '').trim().match(/^#?([0-9a-fA-F]{6})$/);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function smDisp() {
  const wrap = $('#sm-map-wrap');
  return Math.max(280, Math.min(640, wrap ? wrap.clientWidth : 560));
}
function smX0() { return sm.cx - (sm.size * sm.scale) / 2; }
function smZ0() { return sm.cz - (sm.size * sm.scale) / 2; }

function smBuildOff() {
  const d = sm.data;
  if (!d) return;
  const arr = d.biomes || [];
  let size = typeof d.size === 'number' && d.size > 0 ? d.size : Math.round(Math.sqrt(arr.length));
  if (!size || !Number.isFinite(size)) size = 256;
  sm.size = size;
  const pal = new Map();
  for (const p of d.palette || []) { const rgb = parseColor(p && p.color); if (rgb) pal.set(p.id, rgb); }
  const off = document.createElement('canvas');
  off.width = off.height = size;
  const octx = off.getContext('2d');
  const img = octx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const rgb = pal.get(arr[i]);
    const o = i * 4;
    if (rgb) { img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2]; }
    else { img.data[o] = 32; img.data[o + 1] = 36; img.data[o + 2] = 44; }
    img.data[o + 3] = 255;
  }
  octx.putImageData(img, 0, 0);
  sm.off = off; sm.offData = d;
}

function drawMap(offX = 0, offY = 0) {
  const cv = $('#sm-canvas');
  if (!cv || !sm.data) return;
  if (!sm.off || sm.offData !== sm.data) smBuildOff();
  if (!sm.off) return;
  if (cv.style.display === 'none') cv.style.display = '';
  const disp = smDisp();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Math.round(disp * dpr); cv.height = Math.round(disp * dpr);
  cv.style.width = disp + 'px'; cv.style.height = disp + 'px';
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#14161b';
  ctx.fillRect(0, 0, disp, disp);
  ctx.drawImage(sm.off, offX, offY, disp, disp);
  const unit = disp / sm.size;
  sm.hits = [];
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const s of sm.structures || []) {
    const sx = ((s.x - smX0()) / sm.scale) * unit + offX;
    const sy = ((s.z - smZ0()) / sm.scale) * unit + offY;
    if (sx < -20 || sy < -20 || sx > disp + 20 || sy > disp + 20) continue;
    sm.hits.push({ s, sx, sy });
    ctx.beginPath(); ctx.arc(sx, sy, 10, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,.72)'; ctx.fill();
    ctx.font = '14px sans-serif';
    ctx.fillText(structIcon(s.type), sx, sy + 1);
  }
  for (const h of sm.highlights || []) {
    const sx = ((h.x - smX0()) / sm.scale) * unit + offX;
    const sy = ((h.z - smZ0()) / sm.scale) * unit + offY;
    ctx.beginPath(); ctx.arc(sx, sy, 13, 0, Math.PI * 2);
    ctx.strokeStyle = '#4f8cff'; ctx.lineWidth = 2.5;
    ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]);
  }
  const info = $('#sm-viewinfo');
  if (info) info.textContent = `中心 X ${Math.round(sm.cx)}，Z ${Math.round(sm.cz)} · 1 像素 ≈ ${sm.scale} 格 · ${sm.structures.length} 个结构`;
}

async function smRequest() {
  if (!String(sm.seed).trim()) { toast('请先输入地图种子', 'warn'); return; }
  const myReq = ++sm.reqId;
  const load = $('#sm-loading');
  if (load) load.style.display = 'grid';
  try {
    const r = await api.seedmap.map({ seed: sm.seed, mcVersion: sm.version, cx: sm.cx, cz: sm.cz, scale: sm.scale, size: sm.size });
    if (myReq !== sm.reqId) return;
    sm.data = r || {};
    if (!$('#sm-canvas')) { renderSeedmap(sm.el); return; }
    const ph = $('#sm-placeholder');
    if (ph) ph.remove();
    drawMap(0, 0);
    smRenderLegend();
    smLoadStructures();
  } catch (e) {
    if (myReq !== sm.reqId) return;
    if (!sm.data) smRenderError(emsg(e));
    else toast('刷新地图失败：' + emsg(e) + '。可以点击「生成地图」重试。', 'error', 5000);
  } finally {
    if (myReq === sm.reqId && load) load.style.display = 'none';
  }
}

async function smLoadStructures() {
  const half = (sm.size * sm.scale) / 2;
  try {
    const r = await api.seedmap.structures({
      seed: sm.seed, mcVersion: sm.version,
      x0: Math.floor(sm.cx - half), z0: Math.floor(sm.cz - half),
      x1: Math.floor(sm.cx + half), z1: Math.floor(sm.cz + half),
    });
    sm.structures = Array.isArray(r) ? r : (r && r.list) || [];
  } catch (e) {
    sm.structures = [];
    if (!sm.structWarned) { sm.structWarned = true; toast('结构标注没有加载出来：' + emsg(e) + '。地图仍可正常浏览。', 'warn', 5000); }
  }
  drawMap(0, 0);
}

function smRenderLegend() {
  const box = $('#sm-legend');
  if (!box) return;
  const pal = (sm.data && sm.data.palette) || [];
  if (!pal.length) { box.innerHTML = '<div class="tiny muted">这次没有返回生物群系图例。</div>'; return; }
  box.innerHTML = pal.slice(0, 8).map((p) => {
    const c = parseColor(p.color);
    const bg = c ? `rgb(${c[0]},${c[1]},${c[2]})` : 'var(--card-2)';
    const nm = String(p.name || p.id || '未知');
    return `<div class="row tiny" style="gap:8px"><span style="width:14px;height:14px;border-radius:4px;background:${bg};border:1px solid var(--border-2);flex:0 0 auto"></span><span class="ellipsis">${escapeHtml(nm)}</span></div>`;
  }).join('') + (pal.length > 8 ? `<div class="tiny muted-3">…共 ${pal.length} 种</div>` : '');
}

function smRenderError(msg) {
  const wrap = $('#sm-map-body');
  if (!wrap) return;
  wrap.innerHTML = emptyState({
    icon: '🗺️', title: '地图引擎还没有就绪',
    text: '地图引擎还没有就绪。启动器会在首次使用时自动准备，或者稍后再试。' + (msg ? `（${msg}）` : ''),
    actionsHtml: '<button class="btn primary" id="sm-retry">重试</button>',
  });
  const b = $('#sm-retry');
  if (b) b.onclick = () => smRequest();
}

function smShowBubble(hit) {
  const wrap = $('#sm-map-wrap');
  const b = $('#sm-bubble');
  if (!wrap || !b) return;
  const { s, sx, sy } = hit;
  const dist = Math.round(Math.hypot(s.x, s.z));
  b.innerHTML = `
    <div class="row" style="gap:6px"><span>${structIcon(s.type)}</span><b class="small">${escapeHtml(structZh(s.type))}</b>
      <div class="spacer"></div><button class="btn ghost sm" id="sm-bubble-x" style="padding:0 6px">✕</button></div>
    <div class="small mt-1">坐标：X ${s.x}，Z ${s.z}</div>
    <div class="tiny muted">位于出生点${dir8(s.x, s.z)}方向 · 直线距离约 ${dist} 格</div>`;
  b.style.display = 'block';
  const bw = b.offsetWidth, bh = b.offsetHeight;
  let left = Math.min(Math.max(sx - bw / 2, 6), Math.max(6, wrap.clientWidth - bw - 6));
  let top = sy - bh - 14;
  if (top < 6) top = sy + 16;
  b.style.left = left + 'px'; b.style.top = top + 'px';
  $('#sm-bubble-x').onclick = () => { b.style.display = 'none'; };
}

function smRenderResults(type) {
  const box = $('#sm-results');
  if (!box) return;
  if (!sm.highlights.length) { box.innerHTML = `<div class="tiny muted">当前中心点附近没有找到「${escapeHtml(type.zh)}」，可以拖动地图换个区域再搜。</div>`; return; }
  box.innerHTML = sm.highlights.map((h, i) => `
    <div class="list-row" data-h="${i}" style="padding:6px 8px;cursor:pointer">
      <span>${structIcon(h.type)}</span>
      <div style="min-width:0"><div class="small">${escapeHtml(structZh(h.type))}</div>
      <div class="tiny muted">X ${h.x}，Z ${h.z} · 距中心约 ${Math.round(Math.hypot(h.x - sm.cx, h.z - sm.cz))} 格</div></div>
    </div>`).join('');
  box.querySelectorAll('[data-h]').forEach((r) => {
    r.onclick = () => {
      const h = sm.highlights[Number(r.dataset.h)];
      sm.cx = h.x; sm.cz = h.z;
      $('#sm-bubble').style.display = 'none';
      smRequest();
    };
  });
}

async function smSearch() {
  const inp = $('#sm-search');
  const q = (inp.value || '').trim();
  if (!q) { toast('先输入结构名称，例如：村庄', 'warn'); return; }
  if (!String(sm.seed).trim()) { toast('请先填写种子并生成一次地图', 'warn'); return; }
  const t = findStructType(q);
  if (!t) {
    const all = [...new Set(STRUCT_TYPES.map((x) => x.zh))].join('、');
    toast(`没有识别「${q}」这个结构。可以试试：${all}`, 'warn', 5000);
    return;
  }
  try {
    const r = await api.seedmap.nearest({ seed: sm.seed, mcVersion: sm.version, type: t.id, x: sm.cx, z: sm.cz, count: 8 });
    sm.highlights = (Array.isArray(r) ? r : []).slice(0, 8);
    if (sm.data) drawMap(0, 0);
    smRenderResults(t);
    if (sm.data && !sm.highlights.length) toast(`中心点 8 格附近没有找到${t.zh}，试试拖动地图到别的区域`, 'info', 4000);
  } catch (e) {
    toast('搜索失败：' + emsg(e) + '。请确认已生成过一次地图后重试。', 'error', 5000);
  }
}

async function renderSeedmap(el) {
  cleanup(); prepDrop();
  crumb('种子地图');
  sm.el = el;
  el.innerHTML = `
    <div class="card mb-3">
      <div class="row wrap" style="gap:10px">
        <label style="flex:1;min-width:200px"><span class="field-label">种子（数字或任意文字）</span>
          <input class="input" id="sm-seed" value="${escapeHtml(sm.seed)}" placeholder="例如：12345 或 blockbox"></label>
        <label style="width:130px"><span class="field-label">游戏版本</span>
          <select class="input" id="sm-version">${SM_VERSIONS.map((v) => `<option value="${v}" ${sm.version === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label style="width:110px"><span class="field-label">地图尺寸</span>
          <select class="input" id="sm-size">${[256, 512, 1024].map((s) => `<option value="${s}" ${sm.size === s ? 'selected' : ''}>${s} px</option>`).join('')}</select></label>
        <div style="align-self:flex-end"><button class="btn primary" id="sm-go">生成地图</button></div>
      </div>
      <div class="field-hint" id="sm-seed-hint" style="display:none">⚠️ 种子不是纯数字，将使用文字的哈希值作为种子。</div>
    </div>
    <div class="grid" style="grid-template-columns:minmax(0,1fr) 280px;gap:14px">
      <div class="card" style="padding:12px">
        <div class="row mb-2" style="gap:8px">
          <button class="btn sm" id="sm-zoom-out" data-tip="缩小（看更大范围）">➖</button>
          <button class="btn sm" id="sm-zoom-in" data-tip="放大（看更小范围）">➕</button>
          <button class="btn ghost sm" id="sm-reset">重置视野</button>
          <div class="spacer"></div>
          <span class="tiny muted" id="sm-viewinfo"></span>
        </div>
          <div id="sm-map-body">
          <div id="sm-map-wrap" style="position:relative;display:flex;justify-content:center">
            <canvas id="sm-canvas" style="border-radius:8px;display:none;touch-action:none;cursor:grab"></canvas>
            <div id="sm-bubble" class="card" style="position:absolute;display:none;z-index:5;padding:10px 12px;min-width:190px;box-shadow:var(--shadow)"></div>
            <div id="sm-loading" style="display:none;position:absolute;inset:0;place-items:center;background:color-mix(in srgb,var(--card) 62%,transparent);border-radius:8px;z-index:4">
              <div class="col" style="align-items:center"><div class="spinner"></div><div class="small muted">正在推算地图…</div></div>
            </div>
          </div>
          </div>
        <div class="tiny muted mt-2" style="text-align:center">鼠标拖拽平移 · ➖➕ 缩放 · 点击图标查看结构信息</div>
      </div>
      <div class="col">
        <div class="card"><div class="bold small mb-2">生物群系图例</div><div class="col" id="sm-legend" style="gap:5px">
          <div class="tiny muted">生成地图后显示前 8 种生物群系。</div></div></div>
        <div class="card">
          <div class="bold small mb-2">找结构</div>
          <input class="input sm" id="sm-search" list="sm-struct-list" placeholder="输入结构名，如：村庄" style="width:100%">
          <datalist id="sm-struct-list">${[...new Set(STRUCT_TYPES.map((x) => x.zh))].map((z) => `<option value="${z}"></option>`).join('')}</datalist>
          <button class="btn sm block mt-2" id="sm-search-btn">搜索最近 8 个</button>
          <div class="col mt-2" id="sm-results" style="gap:2px"><div class="tiny muted">还没有搜索结果。</div></div>
        </div>
      </div>
    </div>
    <div class="tiny muted mt-3" style="text-align:center">这张地图是根据种子推算出来的，实际游戏中的结构位置可能和地图上标注的有小幅偏差。</div>`;

  const seedInp = $('#sm-seed');
  const hintSync = () => {
    const v = seedInp.value.trim();
    $('#sm-seed-hint').style.display = v && !/^-?\d+$/.test(v) ? 'block' : 'none';
  };
  hintSync();
  seedInp.oninput = () => { sm.seed = seedInp.value; hintSync(); };
  $('#sm-version').onchange = (e) => { sm.version = e.target.value; };
  $('#sm-size').onchange = (e) => { sm.size = Number(e.target.value) || 512; if (sm.data) smRequest(); };
  $('#sm-go').onclick = () => smRequest();
  seedInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') smRequest(); });

  const scaleBtns = () => {
    $('#sm-zoom-in').disabled = sm.scale <= SM_SCALES[0];
    $('#sm-zoom-out').disabled = sm.scale >= SM_SCALES[SM_SCALES.length - 1];
  };
  $('#sm-zoom-in').onclick = () => {
    const i = SM_SCALES.indexOf(sm.scale);
    if (i > 0) { sm.scale = SM_SCALES[i - 1]; scaleBtns(); if (sm.data) smRequest(); }
  };
  $('#sm-zoom-out').onclick = () => {
    const i = SM_SCALES.indexOf(sm.scale);
    if (i < SM_SCALES.length - 1) { sm.scale = SM_SCALES[i + 1]; scaleBtns(); if (sm.data) smRequest(); }
  };
  $('#sm-reset').onclick = () => { sm.cx = 0; sm.cz = 0; if (sm.data) smRequest(); };
  scaleBtns();
  $('#sm-search-btn').onclick = () => smSearch();
  $('#sm-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') smSearch(); });

  const cv = $('#sm-canvas');
  let drag = null;
  let dragOff = [0, 0];
  cv.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !sm.data) return;
    drag = { x: e.clientX, y: e.clientY, moved: false };
    dragOff = [0, 0];
    $('#sm-bubble').style.display = 'none';
    cv.style.cursor = 'grabbing';
    try { cv.setPointerCapture(e.pointerId); } catch { /* 忽略 */ }
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    dragOff = [dx, dy];
    if (drag.moved) drawMap(dx, dy);
  });
  const endDrag = () => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    cv.style.cursor = 'grab';
    if (moved) {
      const [dx, dy] = dragOff;
      const k = (sm.scale * sm.size) / smDisp();
      sm.cx -= dx * k; sm.cz -= dy * k;
      smRequest();
    }
  };
  cv.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const moved = drag.moved;
    if (moved) { endDrag(); return; }
    drag = null; cv.style.cursor = 'grab';
    const rect = cv.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const hit = (sm.hits || []).find((h) => Math.abs(h.sx - mx) < 12 && Math.abs(h.sy - my) < 12);
    if (hit) smShowBubble(hit);
  });
  cv.addEventListener('pointercancel', () => { drag = null; dragOff = [0, 0]; cv.style.cursor = 'grab'; drawMap(0, 0); });
  cv.addEventListener('wheel', (e) => {
    if (!sm.data) return;
    e.preventDefault();
    const i = SM_SCALES.indexOf(sm.scale);
    const ni = e.deltaY > 0 ? Math.min(SM_SCALES.length - 1, i + 1) : Math.max(0, i - 1);
    if (ni === i || ni === sm.wheelPending) return;
    sm.wheelPending = ni;
    clearTimeout(sm.wheelTimer);
    sm.wheelTimer = setTimeout(() => {
      sm.scale = SM_SCALES[sm.wheelPending];
      sm.wheelPending = null;
      scaleBtns();
      smRequest();
    }, 160);
  }, { passive: false });

  if (sm.data) { drawMap(0, 0); smRenderLegend(); }
  else {
    $('#sm-map-body').insertAdjacentHTML('afterbegin', emptyState({
      icon: '🌱', title: '还没有生成地图',
      text: '在上方输入种子（支持数字或任意文字），点击「生成地图」开始探索这个世界。',
    }));
    const ph = $('#sm-map-body .empty-state');
    if (ph) ph.id = 'sm-placeholder';
  }
}

/* ================================================================
 * 3. 投影工坊 /tools/schematic
 * ================================================================ */
const schem = {
  path: null, info: null, data: null, layerY: 0, onlyLayer: false, big: false,
  view: null, THREE: null, renderCount: 0, pageEl: null,
};
const SCHEM_EXTS = /\.(litematic|schematic|schem)$/i;
const REPLACE_BLOCKS = [
  ['stone', '石头'], ['deepslate', '深板岩'], ['quartz_block', '石英块'], ['iron_block', '铁块'],
  ['gold_block', '金块'], ['diamond_block', '钻石块'], ['glass', '玻璃'], ['white_concrete', '白色混凝土'],
  ['red_concrete', '红色混凝土'], ['black_concrete', '黑色混凝土'], ['oak_planks', '橡木木板'],
  ['birch_planks', '白桦木板'], ['spruce_planks', '云杉木板'], ['cobblestone', '圆石'], ['bricks', '砖块'],
  ['sandstone', '砂岩'], ['smooth_stone', '平滑石头'], ['packed_ice', '浮冰'], ['glowstone', '荧石'],
  ['sea_lantern', '海晶灯'], ['nether_bricks', '下界砖'], ['purpur_block', '紫珀块'],
].map(([id, name]) => ({ id: 'minecraft:' + id, name }));

function shortName(id) { return String(id || '').split(':').pop(); }
const AIR_NAMES = new Set(['air', 'cave_air', 'void_air']);

function colorWord(s) {
  const WORDS = {
    white: 0xe8e8e8, orange: 0xe08a2e, magenta: 0xc24fd8, light_blue: 0x5ab8e0, yellow: 0xe0c22e,
    lime: 0x6fc23a, pink: 0xe08ab0, gray: 0x6f7379, grey: 0x6f7379, light_gray: 0xa0a3a8, cyan: 0x2e8fa0,
    purple: 0x7b2fbe, blue: 0x2f4fc2, brown: 0x6e4a2a, green: 0x4f8a2a, red: 0xc03028, black: 0x23252a,
  };
  for (const k of Object.keys(WORDS)) {
    if (new RegExp('(^|_)' + k + '($|_)').test(s)) return WORDS[k];
  }
  return null;
}
// 方块名 → 稳定颜色：常见关键词映射，其余哈希
function colorForBlockName(raw) {
  const s = String(raw || '').toLowerCase();
  const cw = colorWord(s);
  if (cw) return cw;
  const RULES = [
    [/glass|ice|slime|honey/, 0xa9d9ea],
    [/water|kelp|seagrass/, 0x3f6fd0],
    [/lava|magma/, 0xe06018],
    [/leaves|vine|moss|hay|azalea|lily/, 0x4f9e33],
    [/planks|bookshelf|shelf|door|fence|sign/, 0x9a7648],
    [/log|wood|stem|hyphae/, 0x6e5230],
    [/dirt|soil|podzol|mud|clay|soul/, 0x79553a],
    [/grass_block|grass/, 0x5d9440],
    [/deepslate|blackstone|basalt|reinforced/, 0x3a3d44],
    [/stone|cobble|granite|diorite|andesite|tuff|dripstone|calcite|bedrock|cobblestone/, 0x8a8d92],
    [/iron|chain|anvil|cauldron|rail|weight/, 0xd8d8d8],
    [/gold/, 0xf0c33c],
    [/diamond/, 0x4fd8cf],
    [/emerald/, 0x2fc65e],
    [/redstone/, 0xd23b2f],
    [/lapis/, 0x2a4fc4],
    [/quartz|snow|bone/, 0xe9e9e4],
    [/copper/, 0xc06f49],
    [/netherite|nether_brick|warped/, 0x44383c],
    [/bricks|brick/, 0x9c5a4a],
    [/obsidian|end_stone|purpur/, 0x2b2035],
    [/netherrack|crimson/, 0x723038],
    [/sand|gravel|terracotta|concrete_powder/, 0xcbb98a],
    [/wool|carpet/, 0xd8d2c8],
  ];
  for (const [re, c] of RULES) if (re.test(s)) return c;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  const hue = ((h >>> 0) % 3600) / 3600;
  let r = 0, g = 0, b = 0;
  const i = Math.floor(hue * 6), f = hue * 6 - i, v = 0.62, p = 0.36, q = v * (1 - f * 0.45);
  switch (i % 6) {
    case 0: r = v; g = q; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = q; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = q; g = p; b = v; break;
    default: r = v; g = p; b = q;
  }
  return ((Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255)) >>> 0;
}

function disposeSchemView() {
  const v = schem.view;
  if (!v) return;
  schem.view = null;
  try { cancelAnimationFrame(v.raf); } catch { /* 忽略 */ }
  try { v.ro.disconnect(); } catch { /* 忽略 */ }
  for (const m of v.meshes) { try { v.scene.remove(m); m.dispose(); } catch { /* 忽略 */ } }
  try { v.scene.remove(v.grid); v.grid.geometry.dispose(); v.grid.material.dispose(); } catch { /* 忽略 */ }
  try { v.geo.dispose(); } catch { /* 忽略 */ }
  for (const mat of v.mats.values()) { try { mat.dispose(); } catch { /* 忽略 */ } }
  try { v.renderer.dispose(); } catch { /* 忽略 */ }
}

function collectVisible() {
  const { data, layerY, onlyLayer } = schem;
  const { size, blocks, palette } = data;
  const groups = new Map();
  let count = 0;
  for (let y = 0; y < size.y; y++) {
    if (onlyLayer ? y !== layerY : y > layerY) continue;
    for (let z = 0; z < size.z; z++) {
      for (let x = 0; x < size.x; x++) {
        const pi = blocks[(y * size.z + z) * size.x + x];
        if (!pi) continue;
        const nm = String(palette[pi] || '').split(':').pop();
        if (AIR_NAMES.has(nm)) continue;
        let arr = groups.get(pi);
        if (!arr) groups.set(pi, arr = []);
        arr.push(x, y, z);
        count++;
      }
    }
  }
  schem.renderCount = count;
  return groups;
}

function buildSchemMeshes() {
  const v = schem.view;
  if (!v || !schem.data) return;
  for (const m of v.meshes) { v.scene.remove(m); m.dispose(); }
  v.meshes = [];
  const { size, palette } = schem.data;
  const groups = collectVisible();
  const mtx = new v.THREE.Matrix4();
  for (const [pi, list] of groups) {
    const name = String(palette[pi] || 'block_' + pi);
    let mat = v.mats.get(name);
    if (!mat) {
      mat = new v.THREE.MeshLambertMaterial({ color: colorForBlockName(name) });
      if (/glass|ice|water|slime|stained/.test(name.toLowerCase())) { mat.transparent = true; mat.opacity = 0.62; }
      v.mats.set(name, mat);
    }
    const mesh = new v.THREE.InstancedMesh(v.geo, mat, list.length / 3);
    for (let i = 0; i < list.length; i += 3) {
      mtx.setPosition(list[i] + 0.5 - size.x / 2, list[i + 1] + 0.5, list[i + 2] + 0.5 - size.z / 2);
      mesh.setMatrixAt(i / 3, mtx);
    }
    mesh.instanceMatrix.needsUpdate = true;
    v.scene.add(mesh);
    v.meshes.push(mesh);
  }
  const cnt = $('#sch-count');
  if (cnt) cnt.textContent = `已渲染 ${schem.renderCount.toLocaleString('zh-CN')} 个方块`;
}

async function initSchemView(container) {
  const THREE = schem.THREE || (schem.THREE = await import('../../vendor/three.module.js'));
  disposeSchemView();
  const canvas = container.querySelector('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 5000);
  scene.add(new THREE.AmbientLight(0xffffff, 0.68));
  const sun = new THREE.DirectionalLight(0xffffff, 1.25);
  sun.position.set(1, 1.8, 0.9);
  scene.add(sun);
  const { size } = schem.data;
  const dim = Math.max(2, Math.max(size.x, size.z));
  const grid = new THREE.GridHelper(dim, dim, 0x5b6680, 0x394050);
  grid.position.y = 0.01;
  scene.add(grid);
  const st = {
    theta: Math.PI / 4, phi: 1.05,
    radius: Math.max(size.x, size.y, size.z) * 1.75,
    target: new THREE.Vector3(0, size.y / 2, 0),
  };
  const v = schem.view = { THREE, renderer, scene, camera, grid, st, meshes: [], mats: new Map(), geo: new THREE.BoxGeometry(1, 1, 1), raf: 0, ro: null };
  onDispose(disposeSchemView);

  // 简易轨道相机：左键旋转 / 滚轮缩放 / 右键或 Shift 拖拽平移
  let mode = 0, px = 0, py = 0;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    mode = (e.button === 2 || e.shiftKey) ? 2 : 1;
    px = e.clientX; py = e.clientY;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* 忽略 */ }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!mode) return;
    const dx = e.clientX - px, dy = e.clientY - py;
    px = e.clientX; py = e.clientY;
    if (mode === 1) {
      st.theta -= dx * 0.008;
      st.phi = Math.max(0.08, Math.min(Math.PI - 0.08, st.phi - dy * 0.008));
    } else {
      const k = st.radius * 0.0016;
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
      st.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
    }
  });
  const stop = () => { mode = 0; };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    st.radius = Math.max(3, Math.min(4000, st.radius * (e.deltaY > 0 ? 1.12 : 0.9)));
  }, { passive: false });

  const ro = v.ro = new ResizeObserver(() => {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });
  ro.observe(container);
  const loop = () => {
    v.raf = requestAnimationFrame(loop);
    const sp = Math.sin(st.phi), cp = Math.cos(st.phi);
    camera.position.set(
      st.target.x + st.radius * sp * Math.sin(st.theta),
      st.target.y + st.radius * cp,
      st.target.z + st.radius * sp * Math.cos(st.theta),
    );
    camera.lookAt(st.target);
    renderer.render(scene, camera);
  };
  loop();
}

async function schemLoadPath(p) {
  const el = schem.pageEl;
  if (el) el.innerHTML = '<div class="page-loading"><div class="spinner"></div><div>正在读取投影文件…</div></div>';
  try {
    const info = await api.schematic.open({ path: p }).catch(() => null);
    const data = await api.schematic.load({ path: p });
    if (!data || !data.size || !Array.isArray(data.palette)) throw new Error('投影数据结构不符合预期，缺少尺寸或调色板');
    schem.path = p;
    schem.info = info;
    schem.data = { blocks: data.blocks, palette: data.palette.map(String), size: data.size, metadata: data.metadata };
    const total = (data.size.x || 0) * (data.size.y || 0) * (data.size.z || 0);
    const wasBig = schem.big;
    schem.big = total > 200000;
    schem.onlyLayer = schem.big;
    schem.layerY = Math.max(0, Math.min(schem.layerY || data.size.y - 1, data.size.y - 1));
    if (schem.big && !wasBig) toast('结构较大，已进入逐层模式', 'info', 4000);
    schemRender();
  } catch (e) {
    schem.path = null; schem.data = null; schem.info = null;
    schemRender();
    toast('载入投影失败：' + emsg(e) + '。请确认这是有效的投影文件（.litematic / .schematic / .schem）后重试。', 'error', 6000);
  }
}

async function schemPickAndLoad() {
  try {
    const p = await api.pick.file({ title: '选择投影文件', filters: [{ name: '投影文件', extensions: ['litematic', 'schematic', 'schem'] }] });
    if (p) schemLoadPath(p);
  } catch (e) {
    toast('打开文件选择器失败：' + emsg(e), 'error');
  }
}

function schemRender() {
  const el = schem.pageEl;
  if (!el) return;
  if (!schem.data) {
    el.innerHTML = `
      <div class="card hoverable" id="sch-zone" style="border:2px dashed var(--border-2);text-align:center;padding:44px 20px;cursor:pointer">
        <div style="font-size:42px">🧊</div>
        <div class="bold mt-2" style="font-size:16px">把投影文件拖到这里，或点击选择文件</div>
        <div class="small muted mt-1">支持 .litematic（投影 mod）与 .schematic / .schem（MCEdit / Sponge）格式。</div>
        <button class="btn primary mt-3" id="sch-open">打开投影文件</button>
      </div>
      <div class="grid cols-3 mt-3">
        <div class="card"><div class="bold small">👁️ 3D 预览</div><div class="tiny muted mt-1">按方块类型分批渲染，颜色按方块名固定；玻璃等半透明方块会透出后面。</div></div>
        <div class="card"><div class="bold small">🪜 逐层查看</div><div class="tiny muted mt-1">超大结构自动进入逐层模式，也可以用滑块逐层搭建对照。</div></div>
        <div class="card"><div class="bold small">🔁 方块替换</div><div class="tiny muted mt-1">把某种方块全部换成另一种，导出新的投影文件。</div></div>
      </div>`;
    $('#sch-zone').onclick = schemPickAndLoad;
    return;
  }
  const { data, info } = schem;
  const size = data.size;
  const fmt = (info && info.format) || (SCHEM_EXTS.test(schem.path) ? shortName(schem.path).split('.').pop() : '');
  const name = (info && info.name) || shortName(schem.path);
  const blockCount = info && info.blockCount != null ? info.blockCount : schem.renderCount;
  const palNames = [...new Set(data.palette.filter(Boolean))];
  el.innerHTML = `
    <div class="card">
      <div class="row wrap" style="gap:10px">
        <div class="bold ellipsis" style="font-size:16px;max-width:340px">🧊 ${escapeHtml(name)}</div>
        ${fmt ? `<span class="badge accent">${escapeHtml(String(fmt))}</span>` : ''}
        <span class="badge">${size.x} × ${size.y} × ${size.z}</span>
        <span class="badge">${Number(blockCount || 0).toLocaleString('zh-CN')} 个方块</span>
        <span class="badge">${palNames.length} 种方块</span>
        <div class="spacer"></div>
        <button class="btn sm ghost" id="sch-change">更换投影文件</button>
        <button class="btn sm" id="sch-export">导出投影</button>
      </div>
    </div>
    <div class="card mt-3" style="padding:10px">
      <div id="sch-viewport" style="height:470px;border-radius:8px;overflow:hidden;background:var(--card-2);position:relative">
        <canvas style="width:100%;height:100%;display:block;touch-action:none"></canvas>
        <div class="tiny" id="sch-count" style="position:absolute;left:10px;top:8px;background:color-mix(in srgb,var(--card) 82%,transparent);padding:2px 8px;border-radius:99px"></div>
        <div class="tiny muted" style="position:absolute;right:10px;top:8px;background:color-mix(in srgb,var(--card) 82%,transparent);padding:2px 8px;border-radius:99px">左键拖拽旋转 · 滚轮缩放 · 右键 / Shift 拖拽平移</div>
      </div>
      <div class="row mt-2" style="gap:12px">
        <span class="small muted" id="sch-layer-label" style="flex:0 0 auto;min-width:150px"></span>
        <input type="range" class="slider" id="sch-layer" min="0" max="${Math.max(0, size.y - 1)}" value="${schem.layerY}" style="flex:1">
        <label class="row small" style="gap:6px;flex:0 0 auto"><input type="checkbox" id="sch-onlylayer" ${schem.onlyLayer ? 'checked' : ''}> 只显示当前层</label>
      </div>
    </div>
    <div class="card mt-3">
      <div class="bold small mb-2">方块替换</div>
      <div class="row wrap" style="gap:10px">
        <select class="input sm" id="sch-from" style="width:220px" data-tip="要被替换掉的方块（来自投影调色板）">
          <option value="">选择原方块…</option>
          ${palNames.slice(0, 500).map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(shortName(n))}</option>`).join('')}
        </select>
        <span class="muted">➜</span>
        <select class="input sm" id="sch-to" style="width:220px">
          ${REPLACE_BLOCKS.map((b) => `<option value="${escapeHtml(b.id)}">${b.name}（${escapeHtml(shortName(b.id))}）</option>`).join('')}
        </select>
        <button class="btn primary sm" id="sch-replace">全部替换</button>
      </div>
      <div class="tiny muted mt-2">替换会生成一份新的临时投影并立即载入，不会改动你的原文件。</div>
    </div>`;

  $('#sch-change').onclick = schemPickAndLoad;
  $('#sch-export').onclick = async () => {
    try {
      const base = name.replace(/\.[^.]+$/, '') || 'schematic';
      const dest = await api.pick.save({ title: '导出投影文件', defaultName: base + '.litematic', filters: [{ name: '投影文件', extensions: ['litematic'] }] });
      if (!dest) return;
      await api.schematic.exportSchematic({ path: schem.path, dest });
      toast('导出成功：' + dest, 'ok', 5000);
    } catch (e) {
      toast('导出失败：' + emsg(e) + '。请检查保存位置是否可写后重试。', 'error', 6000);
    }
  };
  const layerLabel = () => {
    $('#sch-layer-label').textContent = schem.onlyLayer
      ? `仅显示第 ${schem.layerY} 层 / 共 ${size.y} 层`
      : `显示第 0–${schem.layerY} 层 / 共 ${size.y} 层`;
  };
  $('#sch-layer').oninput = (e) => {
    schem.layerY = Number(e.target.value);
    layerLabel();
    buildSchemMeshes();
  };
  $('#sch-onlylayer').onchange = (e) => {
    schem.onlyLayer = e.target.checked;
    layerLabel();
    buildSchemMeshes();
  };
  layerLabel();
  $('#sch-replace').onclick = async () => {
    const from = $('#sch-from').value, to = $('#sch-to').value;
    if (!from) { toast('先在左边选择要被替换的方块', 'warn'); return; }
    const toLabel = (REPLACE_BLOCKS.find((b) => b.id === to) || {}).name || shortName(to);
    try {
      const r = await api.schematic.replace({ path: schem.path, from, to });
      const newPath = typeof r === 'string' ? r : (r && r.path);
      if (!newPath) throw new Error('后台没有返回替换后的文件路径');
      toast(`已把 ${escapeHtml(shortName(from))} 全部替换为 ${escapeHtml(toLabel)}`, 'ok', 4000);
      await schemLoadPath(newPath);
    } catch (e) {
      toast('替换失败：' + emsg(e) + '。可以再试一次，或换个目标方块。', 'error', 6000);
    }
  };

  initSchemView($('#sch-viewport'))
    .then(() => buildSchemMeshes())
    .catch((e) => {
      $('#sch-viewport').innerHTML = emptyState({
        icon: '🧊', title: '3D 视口没能启动',
        text: '初始化 3D 渲染时出现问题：' + emsg(e) + '。可以重试，或检查显卡驱动是否正常。',
        actionsHtml: '<button class="btn primary" id="sch-view-retry">重试</button>',
      });
      const b = $('#sch-view-retry');
      if (b) b.onclick = () => schemRender();
    });
}

async function renderSchematic(el) {
  cleanup(); prepDrop('松手后载入投影文件');
  crumb('投影工坊');
  schem.pageEl = el;
  // 整页拖入：抢在全局拖拽处理前接住投影文件
  const interceptor = (e) => {
    e.preventDefault(); e.stopPropagation();
    const ov = document.getElementById('drop-overlay');
    if (ov) ov.classList.remove('active');
    try { window.dispatchEvent(new Event('dragleave')); } catch { /* 忽略 */ }
    const paths = dragPaths(e);
    if (!paths.length) return;
    const ok = paths.find((p) => SCHEM_EXTS.test(p));
    if (!ok) { toast('这不是投影文件。支持 .litematic、.schematic、.schem 三种格式。', 'warn', 5000); return; }
    schemLoadPath(ok);
  };
  window.addEventListener('drop', interceptor, true);
  reg(() => window.removeEventListener('drop', interceptor, true));
  schemRender();
}

/* ================================================================
 * 4. 模组翻译 /tools/translate
 * ================================================================ */
const tr = { instanceId: '', jarPath: '', jarName: '', taskId: null, total: 0, done: 0, failedCount: 0, stage: '', paused: false, finished: false, hasKey: false, started: false };
const TR_STAGES = { pending: '排队中', translating: '翻译中', packing: '正在打包资源包', installing: '正在安装资源包', done: '完成' };

function trUpdateProgress() {
  const root = document.getElementById('tr-progress');
  if (!root) return;
  const pct = tr.total > 0 ? Math.round((tr.done / tr.total) * 100) : null;
  const bar = document.getElementById('tr-bar');
  if (bar) bar.innerHTML = progressBar(pct);
  const cnt = document.getElementById('tr-count');
  if (cnt) cnt.textContent = `已翻译 ${tr.done} / 共 ${tr.total || '?'} 条`;
  const stage = document.getElementById('tr-stage');
  if (stage) stage.textContent = tr.paused ? '已暂停' : (TR_STAGES[tr.stage] || (tr.stage ? String(tr.stage) : '翻译中'));
  const fail = document.getElementById('tr-fail');
  if (fail) fail.innerHTML = tr.failedCount > 0 ? `<span class="badge err">失败 ${tr.failedCount} 条</span>` : '';
  const pauseBtn = document.getElementById('tr-pause');
  if (pauseBtn) {
    pauseBtn.style.display = tr.finished ? 'none' : '';
    pauseBtn.textContent = tr.paused ? '▶ 继续' : '⏸ 暂停';
  }
  const doneBox = document.getElementById('tr-done');
  if (doneBox) {
    if (tr.finished) {
      doneBox.innerHTML = `<div class="row wrap mt-2" style="gap:10px">
        <span class="badge ok">✅ 翻译完成</span>
        ${tr.failedCount > 0 ? `<span class="small" style="color:var(--warn)">有 ${tr.failedCount} 条翻译失败了，可以重新翻译这些条目。</span>
        <button class="btn sm" id="tr-retry">重试失败条目</button>` : ''}
      </div>
      <div class="small muted mt-2">质量检查：译文按术语库与翻译记忆逐条生成并写入资源包，失败条目已在上方标注，可用「重试失败条目」修复后再次检查。也可以把完成的译文导出为社区翻译包分享给其他玩家。</div>
      <div class="row mt-2"><button class="btn sm" id="tr-export-pack">📤 导出为社区翻译包</button></div>`;
      const rb = document.getElementById('tr-retry');
      if (rb) rb.onclick = trStartRetry;
      const ep = document.getElementById('tr-export-pack');
      if (ep) ep.onclick = trExportPackFlow;
    } else doneBox.innerHTML = '';
  }
}

async function trTogglePause() {
  if (tr.taskId == null) return;
  try {
    if (tr.paused) {
      await api.translate.resume({ taskId: tr.taskId });
      tr.paused = false;
      toast('已继续翻译', 'info', 1500);
    } else {
      await api.translate.pause({ taskId: tr.taskId });
      tr.paused = true;
      toast('已暂停，随时可以继续', 'info', 1500);
    }
    trUpdateProgress();
  } catch (e) {
    toast((tr.paused ? '继续' : '暂停') + '失败：' + emsg(e), 'error');
  }
}

async function trStartRetry() {
  if (!tr.jarPath || !tr.instanceId) return;
  try {
    const r = await api.translate.start({ jarPath: tr.jarPath, instanceId: tr.instanceId, retry: true });
    tr.taskId = r && r.taskId;
    tr.total = (r && r.total) || tr.failedCount || 0;
    tr.done = 0; tr.stage = ''; tr.paused = false; tr.finished = false; tr.started = true;
    trUpdateProgress();
    trUpdateStart();
    toast('正在重试翻译失败的条目…', 'info');
  } catch (e) {
    toast('重试失败：' + emsg(e) + '。请确认实例和模组文件还在原位置。', 'error', 5000);
  }
}

function trUpdateStart() {
  const btn = document.getElementById('tr-start');
  if (!btn) return;
  const ok = tr.instanceId && tr.jarPath && tr.hasKey && !tr.started;
  btn.disabled = !ok;
}

function trKeyDialog() {
  showDialog({
    title: '如何获取 AI API Key',
    body: `
      <p>模组翻译通过 OpenAI 兼容接口调用 AI 模型，下面任意一个平台都可以申请：</p>
      <p class="mt-2"><b>DeepSeek</b>：打开 platform.deepseek.com 注册并登录，在「API Keys」页面创建一个 Key，新账号有免费额度。</p>
      <p class="mt-2"><b>SiliconFlow（硅基流动）</b>：打开 cloud.siliconflow.cn 注册，在「API 密钥」页面创建，部分模型免费调用。</p>
      <p class="mt-2"><b>其他服务</b>：任何提供 OpenAI 兼容接口的服务都可以，只要能拿到 Base URL 和 Key。</p>
      <p class="mt-2 muted small">拿到 Key 后，到「设置 → AI 翻译」粘贴保存，再回到本页开始翻译。</p>`,
    actions: [{ label: '我知道了', value: true, primary: true }],
  });
}

/* ---------- 翻译辅助：术语库 / 翻译记忆 / 社区翻译包 ---------- */
async function pasteJsonDialog(title, hint) {
  const parsed = await showDialog({
    title,
    wide: true,
    body: `<p class="small muted" style="margin-top:0">${escapeHtml(hint)}</p>
      <textarea class="input" rows="8" style="width:100%;resize:vertical" placeholder="粘贴 JSON 文本…"></textarea>`,
    actions: [{ label: '取消', value: null }, { label: '导入', value: true, primary: true }],
    onMount(mask, close) {
      const ta = mask.querySelector('textarea');
      setTimeout(() => ta.focus(), 60);
      const okBtn = [...mask.querySelectorAll('.dialog-actions .btn')].pop();
      okBtn.onclick = () => {
        const t = ta.value.trim();
        if (!t) { toast('请先粘贴 JSON 文本', 'warn'); return; }
        let obj;
        try { obj = JSON.parse(t); } catch { toast('粘贴的内容不是有效的 JSON，请确认复制完整后再试。', 'error', 4000); return; }
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { toast('内容格式不对：需要形如 {"原文":"译文"} 的 JSON 对象。', 'error', 4500); return; }
        close(obj);
      };
    },
  });
  return parsed;
}

async function trGlossaryDialog() {
  let gl = null;
  try { gl = await api.translate.glossary(); } catch (e) { toast('术语库读取失败：' + emsg(e), 'error', 5000); return; }
  if (!gl || typeof gl !== 'object' || Array.isArray(gl)) gl = {};
  const rows = Object.entries(gl).map(([en, zh]) => ({ en: String(en), zh: String(zh ?? '') }));
  const r = await showDialog({
    title: '术语库',
    wide: true,
    body: `
      <div id="gl-community" class="mb-3"></div>
      <p class="small" style="margin-top:0">翻译时术语库里的词条会强制使用固定译名，保证专有名词前后一致，例如 Creeper→苦力怕。</p>
      <div class="row small bold" style="padding:0 4px"><span style="flex:1">英文原文</span><span style="flex:1">中文译名</span><span style="width:58px"></span></div>
      <div id="gl-rows" class="col" style="gap:6px;max-height:300px;overflow:auto"></div>
      <div class="row wrap mt-2">
        <button class="btn sm" id="gl-add">＋ 添加词条</button>
        <button class="btn sm" id="gl-export">导出术语库</button>
        <button class="btn sm" id="gl-import">导入术语库</button>
      </div>`,
    actions: [{ label: '取消', value: false }, { label: '保存术语库', value: true, primary: true }],
    onMount(mask, close) {
      const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
      // 社区术语库区：加载失败时整块隐藏，不影响个人词条编辑
      const cgBox = mask.querySelector('#gl-community');
      (async () => {
        let cg = null;
        try { cg = await api.translate.communityGlossary(); } catch { if (cgBox) cgBox.innerHTML = ''; return; }
        if (!cgBox || !isObj(cg)) { if (cgBox) cgBox.innerHTML = ''; return; }
        const community = isObj(cg.community) ? cg.community : {};
        const count = Object.keys(community).filter((k) => k !== '_meta').length;
        const personal = isObj(cg.personal) ? cg.personal : null;
        const pCount = personal ? Object.keys(personal).filter((k) => k !== '_meta').length : 0;
        const upd = cg.updateAvailable;
        let updHtml = '';
        if (typeof upd === 'string' && upd.trim()) updHtml = `<span class="badge warn">${escapeHtml(upd)}</span>`;
        else if (upd === true) updHtml = '<span class="badge warn">有可用更新</span>';
        cgBox.innerHTML = `
          <div class="card" style="padding:10px 12px">
            <div class="row wrap" style="gap:8px; align-items:center">
              <span>🌍</span>
              <span class="bold small">社区术语库</span>
              <span class="badge accent">${count} 条内置术语</span>
              ${pCount ? `<span class="badge">${pCount} 条个人词条</span>` : ''}
              ${updHtml}
            </div>
            <div class="tiny muted mt-1">社区术语库随启动器内置，翻译时自动生效；你在下方添加的词条会覆盖同名术语（个人覆盖优先于社区术语库）。</div>
          </div>`;
      })();
      const holder = mask.querySelector('#gl-rows');
      const paint = () => {
        holder.innerHTML = '';
        if (!rows.length) {
          holder.innerHTML = '<div class="tiny muted">还没有词条，点「添加词条」开始。</div>';
          return;
        }
        rows.forEach((row, i) => {
          const div = document.createElement('div');
          div.className = 'row';
          div.style.gap = '6px';
          div.innerHTML = `<input class="input" data-en placeholder="英文原文，如 Creeper" style="flex:1"><input class="input" data-zh placeholder="中文译名，如 苦力怕" style="flex:1"><button class="btn sm danger" data-del style="width:58px">删除</button>`;
          const enInp = div.querySelector('[data-en]');
          const zhInp = div.querySelector('[data-zh]');
          enInp.value = row.en;
          zhInp.value = row.zh;
          enInp.oninput = (e) => { row.en = e.target.value; };
          zhInp.oninput = (e) => { row.zh = e.target.value; };
          div.querySelector('[data-del]').onclick = () => { rows.splice(i, 1); paint(); };
          holder.appendChild(div);
        });
      };
      paint();
      mask.querySelector('#gl-add').onclick = () => {
        rows.push({ en: '', zh: '' });
        paint();
        holder.lastElementChild?.querySelector('[data-en]')?.focus();
      };
      mask.querySelector('#gl-export').onclick = () => {
        const obj = {};
        for (const row of rows) if (row.en.trim() && row.zh.trim()) obj[row.en.trim()] = row.zh.trim();
        copyText('术语库 JSON', JSON.stringify(obj, null, 2));
      };
      mask.querySelector('#gl-import').onclick = async () => {
        const obj = await pasteJsonDialog('导入术语库', '粘贴之前导出的术语库 JSON 文本（形如 {"Creeper":"苦力怕"}），导入后与当前词条合并。');
        if (!obj) return;
        for (const [en, zh] of Object.entries(obj)) {
          if (!en) continue;
          const exist = rows.find((x) => x.en === en);
          if (exist) exist.zh = String(zh ?? '');
          else rows.push({ en, zh: String(zh ?? '') });
        }
        paint();
        toast(`已读入 ${Object.keys(obj).length} 条词条，保存后生效`, 'info', 3000);
      };
    },
  });
  if (!r) return;
  const glossary = {};
  for (const row of rows) if (row.en.trim() && row.zh.trim()) glossary[row.en.trim()] = row.zh.trim();
  try {
    await api.translate.saveGlossary({ glossary });
    toast(`术语库已保存（${Object.keys(glossary).length} 条），下次翻译生效`, 'ok', 3000);
  } catch (e) {
    toast('术语库保存失败：' + emsg(e), 'error', 5000);
  }
}

async function trTmDialog() {
  let tm = null;
  try { tm = await api.translate.tmExport(); } catch (e) { toast('翻译记忆读取失败：' + emsg(e), 'error', 5000); return; }
  if (!tm || typeof tm !== 'object' || Array.isArray(tm)) tm = {};
  const count = Object.keys(tm).length;
  await showDialog({
    title: '翻译记忆',
    wide: true,
    body: `
      <p class="small" style="margin-top:0">翻译记忆会自动记录每次翻译完成的「原文 → 译文」，下次遇到相同原文时直接复用，速度更快、译名风格一致，不会重复花 token。</p>
      <p class="small">当前共 <b>${count}</b> 条记录。</p>
      <div class="row wrap mt-2">
        <button class="btn sm" id="tm-export">导出（复制 JSON）</button>
        <button class="btn sm" id="tm-import">导入（粘贴 JSON）</button>
        <button class="btn sm danger" id="tm-clear" ${count ? '' : 'disabled'}>清空翻译记忆</button>
      </div>
      <p class="tiny muted mt-2">清空后已安装的译文不受影响，但下次遇到相同原文会重新翻译。</p>`,
    actions: [{ label: '关闭', value: true, primary: true }],
    onMount(mask) {
      const cntEl = mask.querySelector('b');
      mask.querySelector('#tm-export').onclick = () => copyText('翻译记忆 JSON', JSON.stringify(tm, null, 2));
      mask.querySelector('#tm-import').onclick = async () => {
        const map = await pasteJsonDialog('导入翻译记忆', '粘贴翻译记忆 JSON 文本（形如 {"Hello":"你好"}），导入后与现有记录合并。');
        if (!map) return;
        try {
          const r = await api.translate.tmImport({ map });
          Object.assign(tm, map);
          if (cntEl) cntEl.textContent = String(Object.keys(tm).length);
          toast(`已导入 ${r && r.count != null ? r.count : Object.keys(map).length} 条翻译记忆`, 'ok', 3000);
        } catch (e) {
          toast('翻译记忆导入失败：' + emsg(e), 'error', 5000);
        }
      };
      mask.querySelector('#tm-clear').onclick = async () => {
        const ok = await confirmDialog('清空翻译记忆', `将删除全部 ${Object.keys(tm).length} 条翻译记忆记录。已翻译安装的译文不受影响，但下次遇到相同原文会重新翻译。确定清空吗？`, { danger: true, okLabel: '清空' });
        if (!ok) return;
        try {
          await api.translate.tmClear();
          tm = {};
          if (cntEl) cntEl.textContent = '0';
          toast('翻译记忆已清空', 'ok', 2500);
        } catch (e) {
          toast('清空失败：' + emsg(e), 'error', 5000);
        }
      };
    },
  });
}

async function trExportPackFlow() {
  if (!tr.jarPath) { toast('还没有翻译过模组：先完成一次翻译，再导出社区翻译包。', 'warn', 4500); return; }
  let translated = null;
  try { translated = await api.translate.tmExport(); } catch { translated = null; }
  const count = translated && typeof translated === 'object' && !Array.isArray(translated) ? Object.keys(translated).length : 0;
  if (!count) { toast('翻译记忆里还没有可导出的译文，先完成一次翻译再试。', 'warn', 4500); return; }
  const ans = await showDialog({
    title: '导出为社区翻译包',
    body: `<p class="small" style="margin-top:0">将把翻译记忆中的 ${count} 条译文打包为社区翻译包（zip），包含元数据（模组名 / 语言 / 作者 / 完成度），可以分享给其他玩家导入使用。</p>
      <label class="field"><span class="field-label">作者署名（可选）</span><input class="input" id="tr-pack-author" placeholder="你的昵称，留空为「匿名」"></label>`,
    actions: [{ label: '取消', value: null }, { label: '导出', value: true, primary: true }],
    onMount(mask, close) {
      const inp = mask.querySelector('#tr-pack-author');
      setTimeout(() => inp.focus(), 60);
      const okBtn = [...mask.querySelectorAll('.dialog-actions .btn')].pop();
      okBtn.onclick = () => close({ author: inp.value.trim() });
    },
  });
  if (!ans) return;
  try {
    const r = await api.translate.exportPack({ jarPath: tr.jarPath, translated, author: ans.author || '' });
    toast('社区翻译包已导出：' + ((r && r.path) || '路径未知') + '，包含元数据（模组名/语言/作者/完成度）', 'ok', 9000);
  } catch (e) {
    toast('导出社区翻译包失败：' + emsg(e) + '。请稍后重试。', 'error', 6000);
  }
}

async function trImportPackFlow() {
  let p = null;
  try {
    p = await api.pick.file({ title: '选择社区翻译包', filters: [{ name: '社区翻译包', extensions: ['zip'] }] });
  } catch (e) { toast('打开文件选择器失败：' + emsg(e), 'error'); return; }
  if (!p) return;
  let res = null;
  try { res = await api.translate.importPack({ path: p }); } catch (e) { toast('导入失败：' + emsg(e) + '。请确认这是由本启动器导出的社区翻译包。', 'error', 6000); return; }
  const meta = (res && res.meta) || {};
  const count = (res && res.count) ?? Object.keys((res && res.translated) || {}).length;
  const act = await showDialog({
    title: '社区翻译包导入成功',
    wide: true,
    body: `
      <div class="col" style="gap:4px">
        <div class="small">模组：<b>${escapeHtml(String(meta.mod || '未知'))}</b></div>
        <div class="small">语言：${escapeHtml(String(meta.language || 'zh_CN'))} · 作者：${escapeHtml(String(meta.author || '匿名'))}</div>
        <div class="small">条目数：<b>${escapeHtml(String(count))}</b>${meta.entryCount != null ? `（元数据记录 ${escapeHtml(String(meta.entryCount))}）` : ''}</div>
      </div>
      <p class="small muted mt-2">导入的译文已就绪，可在翻译完成流程中使用。也可以直接把它应用到当前实例，启动器会把译文生成资源包并放入实例资源包列表。</p>`,
    actions: [{ label: '关闭', value: null }, { label: '应用到当前实例', value: 'apply', primary: true }],
  });
  if (act !== 'apply') return;
  try {
    const r = await api.translate.applyPack({ path: p, instanceId: tr.instanceId, translated: res.translated, meta: res.meta });
    toast((r && r.message) || '已把导入的译文应用为实例资源包', 'ok', 5000);
  } catch (e) {
    if (/接通中|__unimplemented/.test(emsg(e))) toast('导入的译文已就绪，可在翻译完成流程中使用。', 'info', 6000);
    else toast('应用失败：' + emsg(e) + '。请确认实例还在列表中。', 'error', 5000);
  }
}

async function renderTranslate(el, ctx) {
  cleanup(); prepDrop();
  crumb('模组翻译');
  el.innerHTML = `<div class="col">${skeletonRows(3)}</div>`;
  let insts = null, instErr = '', settings = null;
  try { insts = await api.instances.list(); } catch (e) { instErr = emsg(e); }
  try { settings = (await api.settings.get()) || null; } catch { settings = null; }
  if (!settings && ctx && ctx.settings) settings = ctx.settings; // 主进程暂时读不到时退回路由上下文
  tr.hasKey = !!(settings && settings.translate && settings.translate.apiKey);

  if (insts === null) {
    el.innerHTML = emptyState({
      icon: '😵', title: '实例列表加载失败',
      text: '读取实例列表时出现问题：' + instErr + '。请重试。',
      actionsHtml: '<button class="btn primary" id="tr-retry-load">重试</button>',
    });
    $('#tr-retry-load').onclick = () => renderTranslate(el);
    return;
  }
  if (!insts.length) {
    el.innerHTML = emptyState({
      icon: '📦', title: '还没有可用实例',
      text: '翻译生成的资源包会装进目标实例并启用，所以需要先有一个游戏实例。',
      actionsHtml: '<button class="btn primary" id="tr-go-inst">去创建实例</button>',
    });
    $('#tr-go-inst').onclick = () => { location.hash = '/instances'; };
    return;
  }
  if (!tr.instanceId || !insts.some((i) => i.id === tr.instanceId)) tr.instanceId = insts[0].id;

  el.innerHTML = `
    <div class="card">
      <div class="row mb-2"><span class="badge accent">步骤 1</span><span class="bold">选择实例与模组</span></div>
      <div class="row wrap" style="gap:12px">
        <label style="width:240px"><span class="field-label">目标实例</span>
          <select class="input" id="tr-inst">${insts.map((i) => `<option value="${escapeHtml(i.id)}" ${i.id === tr.instanceId ? 'selected' : ''}>${escapeHtml(i.name)}</option>`).join('')}</select></label>
        <div style="flex:1;min-width:220px"><span class="field-label">模组文件（.jar）</span>
          <div class="row"><button class="btn" id="tr-pick">选择模组 jar</button>
          <span class="small muted ellipsis" id="tr-jar-name" style="max-width:280px">${tr.jarPath ? escapeHtml(tr.jarName) : '未选择文件'}</span></div></div>
      </div>
      <div class="field-hint">翻译生成的资源包会装进该实例并启用。</div>
    </div>
    <div class="card mt-3" style="${tr.hasKey ? '' : 'border-left:3px solid var(--warn)'}">
      <div class="row mb-2"><span class="badge accent">步骤 2</span><span class="bold">检查 AI API Key</span></div>
      ${tr.hasKey
        ? '<div class="small">✅ 已配置 API Key，可以开始翻译。若翻译报错，请到设置里检查 Key 是否有效。</div>'
        : `<div class="small" style="color:var(--warn)">使用模组翻译需要先填入 AI API Key。你可以在设置中填入，或者点击「了解如何获取 Key」查看说明。</div>
           <div class="row mt-2" style="gap:10px">
             <button class="btn sm" id="tr-key-help">了解如何获取 Key</button>
             <button class="btn sm primary" id="tr-go-settings">去设置</button>
           </div>`}
    </div>
    <div class="card mt-3">
      <div class="row mb-2"><span class="badge accent">步骤 3</span><span class="bold">开始翻译</span></div>
      <div class="row"><button class="btn primary" id="tr-start">开始翻译</button>
        <span class="tiny muted">翻译需要一些时间，取决于模组里有多少条未翻译的文本。</span></div>
      <div id="tr-progress" class="mt-3" style="display:none">
        <div class="row small mb-2"><span id="tr-stage" class="bold">翻译中</span><div class="spacer"></div><span id="tr-count" class="muted"></span></div>
        <div id="tr-bar">${progressBar(null)}</div>
        <div class="row mt-2"><button class="btn sm" id="tr-pause">⏸ 暂停</button><div class="spacer"></div><span id="tr-fail"></span></div>
        <div id="tr-done"></div>
      </div>
    </div>
    <div class="card mt-3">
      <div class="row mb-2"><span class="badge accent">进阶</span><span class="bold">术语库 · 翻译记忆 · 社区翻译包</span></div>
      <div class="row wrap">
        <button class="btn sm" id="tr-glossary-btn">📖 术语库</button>
        <button class="btn sm" id="tr-tm-btn">🧠 翻译记忆</button>
        <button class="btn sm" id="tr-import-pack-btn">📥 从社区翻译包导入</button>
      </div>
      <div class="field-hint">术语库固定专有名词的译名（如 Creeper→苦力怕），翻译记忆自动复用已完成的译文；社区翻译包可以分享或导入他人的翻译成果。</div>
    </div>`;

  $('#tr-inst').onchange = (e) => { tr.instanceId = e.target.value; trUpdateStart(); };
  $('#tr-pick').onclick = async () => {
    try {
      const p = await api.pick.file({ title: '选择模组文件', filters: [{ name: '模组文件', extensions: ['jar'] }] });
      if (!p) return;
      tr.jarPath = p;
      tr.jarName = String(p).split('/').pop();
      $('#tr-jar-name').textContent = tr.jarName;
      trUpdateStart();
    } catch (e) { toast('打开文件选择器失败：' + emsg(e), 'error'); }
  };
  const helpBtn = $('#tr-key-help');
  if (helpBtn) helpBtn.onclick = trKeyDialog;
  const goBtn = $('#tr-go-settings');
  if (goBtn) goBtn.onclick = () => { location.hash = '/settings'; };

  $('#tr-start').onclick = async () => {
    try {
      const s = await api.settings.get();
      if (!(s && s.translate && s.translate.apiKey)) {
        toast('还没有配置 API Key，先去设置里填入吧', 'warn', 4000);
        return;
      }
    } catch { /* 设置读取失败时继续尝试开始翻译 */ }
    try {
      const r = await api.translate.start({ jarPath: tr.jarPath, instanceId: tr.instanceId });
      tr.taskId = r && r.taskId;
      tr.total = (r && r.total) || 0;
      tr.done = 0; tr.failedCount = 0; tr.stage = ''; tr.paused = false; tr.finished = false; tr.started = true;
      $('#tr-progress').style.display = 'block';
      trUpdateProgress();
      trUpdateStart();
      $('#tr-progress').scrollIntoView({ behavior: 'smooth', block: 'center' });
      toast(`翻译已开始${r && r.total ? `，共 ${r.total} 条` : ''}`, 'info');
    } catch (e) {
      toast('启动翻译失败：' + emsg(e) + '。请检查 API Key、实例与模组文件是否有效。', 'error', 6000);
    }
  };
  $('#tr-pause').onclick = trTogglePause;
  $('#tr-glossary-btn').onclick = () => trGlossaryDialog();
  $('#tr-tm-btn').onclick = () => trTmDialog();
  $('#tr-import-pack-btn').onclick = () => trImportPackFlow();
  trUpdateStart();
  if (tr.taskId != null) { $('#tr-progress').style.display = 'block'; trUpdateProgress(); }

  reg(on('bb:translate-progress', (d) => {
    if (!d || tr.taskId == null || d.taskId !== tr.taskId) return;
    if (d.done != null) tr.done = d.done;
    if (d.total != null) tr.total = d.total;
    if (d.failedCount != null) tr.failedCount = d.failedCount;
    if (d.stage) tr.stage = d.stage;
    if (d.stage === 'done' && !tr.finished) {
      tr.finished = true;
      tr.paused = false;
      tr.started = false;
      trUpdateStart();
      toast('翻译完成！资源包已放入实例资源包列表并启用。', 'ok', 5000);
      if (tr.failedCount > 0) toast(`有 ${tr.failedCount} 条翻译失败了，可以重新翻译这些条目。`, 'warn', 6000);
    }
    trUpdateProgress();
  }));
}

/* ================================================================
 * 5. 配方生成器 /tools/recipe
 * ================================================================ */
const COMMON_ITEMS = [
  ['stone', '石头'], ['cobblestone', '圆石'], ['oak_planks', '橡木木板'], ['spruce_planks', '云杉木板'],
  ['birch_planks', '白桦木板'], ['stick', '木棍'], ['coal', '煤炭'], ['iron_ingot', '铁锭'], ['gold_ingot', '金锭'],
  ['diamond', '钻石'], ['emerald', '绿宝石'], ['redstone', '红石'], ['lapis_lazuli', '青金石'], ['quartz', '石英'],
  ['glass', '玻璃'], ['sand', '沙子'], ['leather', '皮革'], ['paper', '纸'], ['book', '书'], ['string', '线'],
  ['feather', '羽毛'], ['gunpowder', '火药'], ['snowball', '雪球'], ['apple', '苹果'], ['bread', '面包'],
  ['wheat', '小麦'], ['carrot', '胡萝卜'], ['potato', '土豆'], ['iron_block', '铁块'], ['gold_block', '金块'],
  ['diamond_block', '钻石块'], ['netherite_ingot', '下界合金锭'], ['blaze_rod', '烈焰棒'], ['ender_pearl', '末影珍珠'],
  ['chest', '箱子'], ['crafting_table', '工作台'], ['furnace', '熔炉'], ['glass_bottle', '玻璃瓶'], ['bone', '骨头'],
  ['obsidian', '黑曜石'], ['netherrack', '下界岩'], ['end_stone', '末地石'],
].map(([id, name]) => ({ id: 'minecraft:' + id, name }));
function itemLabel(id) {
  const it = COMMON_ITEMS.find((x) => x.id === id);
  return it ? it.name : shortName(id);
}
const RECIPE_TYPES = [
  { id: 'shaped', name: '有序合成', icon: '🧩', desc: '材料的位置很重要，像工作台合成。' },
  { id: 'shapeless', name: '无序合成', icon: '🌀', desc: '材料位置不重要，像背包里的合成。' },
  { id: 'smelting', name: '熔炼', icon: '🔥', desc: '像熔炉烧炼。' },
  { id: 'blasting', name: '高炉冶炼', icon: '🏭', desc: '熔炉的强化版，烧金属矿石更快。' },
  { id: 'smoking', name: '烟熏', icon: '🍖', desc: '专门熏制食物。' },
  { id: 'stonecutting', name: '切石', icon: '🪚', desc: '像切石机把石料切成台阶、楼梯等。' },
];
const PACK_FORMATS = [
  [26, '1.20.2 – 1.20.4'], [41, '1.20.5 – 1.20.6'], [48, '1.21 – 1.21.1（默认）'], [57, '1.21.2 及以上'],
];
const rc = {
  type: 'shaped',
  grid: Array(9).fill(null),
  shapeless: [],
  single: null,
  resultId: null, resultCount: 1,
  name: 'recipe_1', namespace: 'blockbox',
  packName: 'blockbox_recipes', packFormat: 48,
  recipes: [],
};

function pickItem(title) {
  return new Promise((resolve) => {
    showDialog({
      title, wide: true,
      body: `
        <input class="input" id="item-search" placeholder="搜索物品（中文名或英文 id）…">
        <div id="item-list" style="margin-top:10px;max-height:44vh;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px"></div>
        <div class="row mt-2" style="gap:8px">
          <input class="input sm" id="item-custom" placeholder="或直接输入物品 id，如 minecraft:glowstone" style="flex:1">
          <button class="btn sm" id="item-custom-go">使用该 id</button>
        </div>`,
      actions: [{ label: '取消', value: null }],
      onMount(mask, close) {
        const list = mask.querySelector('#item-list');
        const search = mask.querySelector('#item-search');
        const renderList = () => {
          const q = search.value.trim().toLowerCase();
          const items = COMMON_ITEMS.filter((it) => !q || it.id.includes(q) || it.name.toLowerCase().includes(q));
          list.innerHTML = items.length
            ? items.map((it) => `<button class="btn sm" data-id="${escapeHtml(it.id)}" style="flex-direction:column;align-items:flex-start;gap:2px;justify-content:center">
                <span>${escapeHtml(it.name)}</span><span class="tiny muted">${escapeHtml(it.id)}</span></button>`).join('')
            : '<div class="tiny muted" style="grid-column:1/-1">没有匹配的常用物品，可以在下方直接输入物品 id。</div>';
          list.querySelectorAll('[data-id]').forEach((b) => { b.onclick = () => close(b.dataset.id); });
        };
        search.oninput = renderList;
        renderList();
        mask.querySelector('#item-custom-go').onclick = () => {
          let v = mask.querySelector('#item-custom').value.trim();
          if (!v) return;
          if (!v.includes(':')) v = 'minecraft:' + v;
          close(v);
        };
        setTimeout(() => search.focus(), 60);
      },
    }).then((v) => resolve(typeof v === 'string' ? v : null));
  });
}

function rcCellHtml(id, title) {
  return `<button class="rc-cell" title="${escapeHtml(title)}" style="width:58px;height:58px;border:1px solid var(--border-2);border-radius:8px;background:var(--card-2);color:${id ? 'var(--fg)' : 'var(--fg-3)'};font:inherit;font-size:${id ? '11px' : '16px'};line-height:1.3;padding:2px;cursor:pointer;overflow:hidden">${id ? escapeHtml(itemLabel(id)) : '＋'}</button>`;
}

function buildRecipe() {
  const t = rc.type;
  let ingredients = null;
  if (t === 'shaped') {
    const map = {};
    rc.grid.forEach((id, i) => { if (id) map[String(i)] = id; });
    if (!Object.keys(map).length) return null;
    ingredients = map;
  } else if (t === 'shapeless') {
    if (!rc.shapeless.length) return null;
    ingredients = rc.shapeless.slice();
  } else {
    if (!rc.single) return null;
    ingredients = rc.single;
  }
  if (!rc.resultId) return null;
  return {
    type: t,
    name: rc.name,
    namespace: rc.namespace || 'blockbox',
    ingredients,
    result: { id: rc.resultId, count: Math.max(1, Math.min(64, Math.round(rc.resultCount) || 1)) },
  };
}

function ingSummary(r) {
  if (r.type === 'shaped') {
    const vals = Object.values(r.ingredients || {});
    return `3×3 网格 · ${new Set(vals).size} 种材料 · ${vals.length} 格`;
  }
  if (r.type === 'shapeless') return (r.ingredients || []).map(itemLabel).join('、') || '（空）';
  return itemLabel(r.ingredients);
}

function normImported(r, i) {
  const idOf = (v) => {
    if (typeof v === 'string') return v.includes(':') ? v : 'minecraft:' + v;
    if (v && typeof v === 'object') return idOf(v.item || v.id || v.ingredient);
    return null;
  };
  const type = RECIPE_TYPES.some((t) => t.id === r.type) ? r.type : 'shaped';
  const out = { type, name: String(r.name || 'recipe_' + (i + 1)), namespace: r.namespace || 'blockbox' };
  const ing = r.ingredients ?? r.ingredient ?? r.key;
  if (type === 'shaped') {
    const map = {};
    if (Array.isArray(r.pattern) && r.key && typeof r.key === 'object') {
      let idx = 0;
      for (const row of r.pattern) {
        for (const ch of String(row)) {
          if (ch === ' ') { idx++; continue; }
          const v = idOf(r.key[ch]);
          if (v) map[String(idx)] = v;
          idx++;
        }
      }
    } else if (ing && typeof ing === 'object' && !Array.isArray(ing)) {
      for (const [k, v] of Object.entries(ing)) { const id = idOf(v); if (id) map[String(k)] = id; }
    } else if (Array.isArray(ing)) {
      const flat = ing.flatMap((x) => (Array.isArray(x) ? x : [x]));
      flat.forEach((v, idx) => { const id = idOf(v); if (id) map[String(idx)] = id; });
    }
    if (!Object.keys(map).length) return null;
    out.ingredients = map;
  } else if (type === 'shapeless') {
    const arr = Array.isArray(ing) ? ing.map(idOf).filter(Boolean) : [idOf(ing)].filter(Boolean);
    if (!arr.length) return null;
    out.ingredients = arr;
  } else {
    const id = idOf(ing);
    if (!id) return null;
    out.ingredients = id;
  }
  const rid = idOf(r.result);
  if (!rid) return null;
  out.result = { id: rid, count: Math.max(1, Math.min(64, Number((r.result && r.result.count) || r.count) || 1)) };
  return out;
}

function rcNextName() {
  let n = rc.recipes.length + 1;
  let name = 'recipe_' + n;
  while (rc.recipes.some((r) => r.name === name)) name = 'recipe_' + (++n);
  return name;
}

async function rcExport() {
  if (!rc.recipes.length) { toast('配方列表是空的，先在上方添加至少一条配方', 'warn'); return; }
  let dir = null;
  try { dir = await api.pick.dir({ title: '选择数据包导出位置' }); } catch (e) { toast('打开文件夹选择器失败：' + emsg(e), 'error'); return; }
  if (!dir) return;
  try {
    const r = await api.recipe.exportDatapack({
      name: (rc.packName || 'blockbox_recipes').trim() || 'blockbox_recipes',
      packFormat: Number(rc.packFormat) || 48,
      recipes: rc.recipes.map((x) => ({ ...x, namespace: rc.namespace || 'blockbox' })),
      destDir: dir,
    });
    const zip = typeof r === 'string' ? r : (r && (r.path || r.zip || r.file)) || dir;
    toast(`数据包已导出：${zip}。把它放进存档的 datapacks 文件夹即可使用。`, 'ok', 7000);
  } catch (e) {
    toast('导出数据包失败：' + emsg(e) + '。请检查目标文件夹是否可写后重试。', 'error', 6000);
  }
}

async function rcImport(el) {
  let p = null;
  try { p = await api.pick.file({ title: '选择数据包压缩包', filters: [{ name: '数据包（zip）', extensions: ['zip'] }] }); } catch (e) { toast('打开文件选择器失败：' + emsg(e), 'error'); return; }
  if (!p) return;
  try {
    const r = await api.recipe.importDatapack({ path: p });
    const list = ((Array.isArray(r) ? r : (r && r.recipes) || [])).map(normImported).filter(Boolean);
    if (!list.length) { toast('这个数据包里没有读到可编辑的配方，请确认它是本启动器导出的配方数据包。', 'warn', 5000); return; }
    if (rc.recipes.length) {
      const ok = await confirmDialog('导入数据包', `导入会替换当前的配方列表（现有 ${rc.recipes.length} 条，将导入 ${list.length} 条）。确定继续吗？`, { okLabel: '导入替换' });
      if (!ok) return;
    }
    rc.recipes = list;
    rcRender(el);
    toast(`已导入 ${list.length} 条配方，可以继续编辑或重新导出`, 'ok');
  } catch (e) {
    toast('导入失败：' + emsg(e) + '。请确认选择的是数据包 zip 文件。', 'error', 6000);
  }
}

function rcRender(el) {
  const t = RECIPE_TYPES.find((x) => x.id === rc.type) || RECIPE_TYPES[0];
  el.innerHTML = `
    <style>.rc-cell:hover { border-color: var(--accent) !important; }</style>
    <div class="grid cols-3">
      ${RECIPE_TYPES.map((x) => `
        <div class="card hoverable" data-type="${x.id}" style="padding:12px;${x.id === rc.type ? 'border-color:var(--accent)' : ''}">
          <div class="row" style="gap:8px"><span style="font-size:18px">${x.icon}</span><b>${x.name}</b>${x.id === rc.type ? '<span class="badge accent">当前</span>' : ''}</div>
          <div class="tiny muted mt-1">${x.desc}</div>
        </div>`).join('')}
    </div>
    <div class="card mt-3">
      <div class="bold small mb-2">${t.icon} ${t.name} — 材料设置</div>
      ${rc.type === 'shaped' ? `
        <div class="row" style="gap:14px;align-items:flex-start">
          <div style="display:grid;grid-template-columns:repeat(3,58px);gap:5px" id="rc-grid">
            ${rc.grid.map((id, i) => rcCellHtml(id, id ? `${itemLabel(id)}（${id}）\n点击更换，右键清空` : '点击选择材料，右键清空')).join('')}
          </div>
          <div class="tiny muted" style="max-width:280px;line-height:1.8">点击格子选择材料，右键清空。<br>对应工作台的 3×3 摆放位置（左上角是第 1 格）。<br>留空的格子不参与合成。</div>
        </div>` : ''}
      ${rc.type === 'shapeless' ? `
        <div class="row wrap" style="gap:8px" id="rc-chips">
          ${rc.shapeless.length
            ? rc.shapeless.map((id, i) => `<span class="badge" style="gap:6px;padding:5px 10px">${escapeHtml(itemLabel(id))}<button class="btn ghost sm" data-del="${i}" style="padding:0 4px;border:none">✕</button></span>`).join('')
            : '<span class="tiny muted">还没有材料，点击右侧按钮添加。</span>'}
          <button class="btn sm" id="rc-add-mat">＋ 添加材料</button>
        </div>
        <div class="tiny muted mt-2">材料顺序不影响结果，同一种材料可以添加多份。</div>` : ''}
      ${['smelting', 'blasting', 'smoking', 'stonecutting'].includes(rc.type) ? `
        <div class="row" style="gap:14px;align-items:center">
          <div id="rc-single">${rcCellHtml(rc.single, rc.single ? `${itemLabel(rc.single)}（${rc.single}）\n点击更换，右键清空` : '点击选择输入材料')}</div>
          <div class="tiny muted">这个配方类型只有一个输入格。</div>
        </div>` : ''}
    </div>
    <div class="card mt-3">
      <div class="bold small mb-2">产物与命名</div>
      <div class="row wrap" style="gap:12px;align-items:flex-end">
        <div><span class="field-label">产物</span><div id="rc-result">${rcCellHtml(rc.resultId, rc.resultId ? `${itemLabel(rc.resultId)}（${rc.resultId}）\n点击更换` : '点击选择产物')}</div></div>
        <label style="width:90px"><span class="field-label">数量（1-64）</span><input class="input sm" type="number" id="rc-count" min="1" max="64" value="${rc.resultCount}"></label>
        <label style="width:180px"><span class="field-label">配方名（小写英文 / 数字 / 下划线）</span><input class="input sm" id="rc-name" value="${escapeHtml(rc.name)}"></label>
        <label style="width:160px"><span class="field-label">命名空间</span><input class="input sm" id="rc-ns" value="${escapeHtml(rc.namespace)}"></label>
        <button class="btn primary" id="rc-add">添加到配方列表</button>
      </div>
    </div>
    <div class="card mt-3">
      <div class="row mb-2"><span class="bold small">配方列表（${rc.recipes.length} 条）</span><div class="spacer"></div></div>
      ${rc.recipes.length ? rc.recipes.map((r, i) => `
        <div class="list-row" style="padding:7px 10px">
          <span class="badge accent">${escapeHtml((RECIPE_TYPES.find((x) => x.id === r.type) || {}).name || r.type)}</span>
          <code class="small">${escapeHtml(r.name)}</code>
          <span class="small ellipsis" style="flex:1">${escapeHtml(ingSummary(r))} ➜ ${escapeHtml(itemLabel(r.result.id))} ×${r.result.count}</span>
          <button class="btn danger sm" data-rdel="${i}">删除</button>
        </div>`).join('') : '<div class="tiny muted">还没有配方。设置好材料与产物后，点击「添加到配方列表」。</div>'}
      <div class="row wrap mt-3" style="gap:10px;align-items:flex-end">
        <label style="width:180px"><span class="field-label">数据包名</span><input class="input sm" id="rc-packname" value="${escapeHtml(rc.packName)}"></label>
        <label style="width:220px"><span class="field-label">数据包版本（pack_format）</span>
          <select class="input sm" id="rc-packfmt">${PACK_FORMATS.map(([v, l]) => `<option value="${v}" ${Number(rc.packFormat) === v ? 'selected' : ''}>${v} · ${l}</option>`).join('')}</select></label>
        <button class="btn primary" id="rc-export">导出为数据包</button>
        <button class="btn" id="rc-import">导入现有数据包</button>
      </div>
      <div class="field-hint">不确定就选 48（1.21）。导出的 zip 放进存档的 datapacks 文件夹即可使用。</div>
    </div>`;

  el.querySelectorAll('[data-type]').forEach((c) => { c.onclick = () => { rc.type = c.dataset.type; rcRender(el); }; });

  if (rc.type === 'shaped') {
    el.querySelectorAll('#rc-grid .rc-cell').forEach((cell, i) => {
      cell.onclick = async () => {
        const v = await pickItem('选择第 ' + (i + 1) + ' 格的材料');
        if (v) { rc.grid[i] = v; rcRender(el); }
      };
      cell.oncontextmenu = (e) => { e.preventDefault(); rc.grid[i] = null; rcRender(el); };
    });
  } else if (rc.type === 'shapeless') {
    const add = el.querySelector('#rc-add-mat');
    if (add) add.onclick = async () => {
      const v = await pickItem('添加材料');
      if (v) { rc.shapeless.push(v); rcRender(el); }
    };
    el.querySelectorAll('[data-del]').forEach((b) => { b.onclick = () => { rc.shapeless.splice(Number(b.dataset.del), 1); rcRender(el); }; });
  } else {
    const cell = el.querySelector('#rc-single .rc-cell');
    if (cell) {
      cell.onclick = async () => { const v = await pickItem('选择输入材料'); if (v) { rc.single = v; rcRender(el); } };
      cell.oncontextmenu = (e) => { e.preventDefault(); rc.single = null; rcRender(el); };
    }
  }
  const resCell = el.querySelector('#rc-result .rc-cell');
  if (resCell) resCell.onclick = async () => { const v = await pickItem('选择产物'); if (v) { rc.resultId = v; rcRender(el); } };
  el.querySelector('#rc-count').onchange = (e) => { rc.resultCount = Math.max(1, Math.min(64, Number(e.target.value) || 1)); e.target.value = rc.resultCount; };
  el.querySelector('#rc-name').oninput = (e) => { rc.name = e.target.value.trim(); };
  el.querySelector('#rc-ns').oninput = (e) => { rc.namespace = e.target.value.trim(); };
  el.querySelector('#rc-add').onclick = () => {
    const cntInput = el.querySelector('#rc-count');
    if (cntInput) rc.resultCount = Math.max(1, Math.min(64, Number(cntInput.value) || 1));
    if (!rc.resultId) { toast('先选择产物，配方需要知道做出什么', 'warn'); return; }
    if (!/^[a-z0-9_]+$/.test(rc.name)) { toast('配方名只能用小写英文、数字和下划线，例如 my_recipe_1', 'warn', 4000); return; }
    const rec = buildRecipe();
    if (!rec) { toast(t.name + '还没有设置材料', 'warn'); return; }
    let base = rec.name, n = 1;
    while (rc.recipes.some((r) => r.name === rec.name)) rec.name = base + '_' + (++n);
    rc.recipes.push(rec);
    rc.name = rcNextName();
    rcRender(el);
    toast(`已添加配方 ${rec.name}`, 'ok', 2000);
  };
  el.querySelector('#rc-packname').oninput = (e) => { rc.packName = e.target.value; };
  el.querySelector('#rc-packfmt').onchange = (e) => { rc.packFormat = Number(e.target.value) || 48; };
  el.querySelector('#rc-export').onclick = rcExport;
  el.querySelector('#rc-import').onclick = () => rcImport(el);
  el.querySelectorAll('[data-rdel]').forEach((b) => {
    b.onclick = async () => {
      const r = rc.recipes[Number(b.dataset.rdel)];
      const ok = await confirmDialog('删除配方', `确定从列表中移除「${r.name}」吗？删除后导出的数据包将不再包含它。`, { okLabel: '删除', danger: true });
      if (!ok) return;
      rc.recipes.splice(Number(b.dataset.rdel), 1);
      rcRender(el);
      toast('已删除配方 ' + r.name, 'info', 2000);
    };
  });
}

async function renderRecipe(el) {
  cleanup(); prepDrop();
  crumb('配方生成器');
  rcRender(el);
}

/* ---------- 导出 ---------- */
export default [
  { id: 'tools', title: '工具集', icon: '🧰', routes: ['/tools'], order: 9, render: renderToolsMain },
  { id: 'tools-gradient', title: '渐变文字生成器', icon: '🎨', routes: ['/tools/gradient'], hiddenNav: true, render: renderGradient },
  { id: 'tools-seedmap', title: '种子地图', icon: '🗺️', routes: ['/tools/seedmap'], hiddenNav: true, render: renderSeedmap },
  { id: 'tools-schematic', title: '投影工坊', icon: '🧊', routes: ['/tools/schematic'], hiddenNav: true, render: renderSchematic },
  { id: 'tools-translate', title: '模组翻译', icon: '🌐', routes: ['/tools/translate'], hiddenNav: true, render: renderTranslate },
  { id: 'tools-recipe', title: '配方生成器', icon: '📜', routes: ['/tools/recipe'], hiddenNav: true, render: renderRecipe },
];
