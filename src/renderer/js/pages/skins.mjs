// 皮肤库页：本地导入 / 在线搜索 / 2D 缩略图 / 3D 预览 / 应用到账户
import { api } from '../api.js';
import { toast, confirmDialog, showDialog, emptyState, setBreadcrumb, escapeHtml } from '../ui.js';
import * as THREE from '../../vendor/three.module.js';

let cleanups = [];
function addCleanup(fn) { cleanups.push(fn); }
function runCleanups() { for (const f of cleanups) { try { f(); } catch { /* 忽略 */ } } cleanups = []; }

const TYPE_LABEL = { offline: '离线', microsoft: '微软正版', yggdrasil: '皮肤站' };

function errMsg(e) { const m = e && e.message ? String(e.message) : String(e || ''); return m || '未知错误'; }
function srcLabel(s) { return s === 'littleskin' ? 'LittleSkin' : s === 'elyby' ? 'Ely.by' : '本地'; }
function modelLabel(m) { return m === 'slim' ? '细臂' : '宽臂'; }

function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}

// 2D 缩略图：把 64x64 皮肤正面的头/身/四肢区域贴到 4:5 画布上
async function renderSkinThumb(canvas, dataUrl, opts = {}) {
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, canvas.width, canvas.height);
  const W = canvas.width, H = canvas.height;
  const s = Math.max(1, Math.floor(H / 32));
  const x0 = Math.round((W - 16 * s) / 2);
  let img = null;
  if (dataUrl) { try { img = await loadImage(dataUrl); } catch { img = null; } }
  if (!img) { drawPlaceholder(g, x0, s); return; }
  const legacy = img.height <= 32;
  const aw = opts.model === 'slim' ? 3 : 4;
  const px = (sx, sy, sw, sh, ux, uy) => g.drawImage(img, sx, sy, sw, sh, x0 + ux * s, uy * s, sw * s, sh * s);
  px(4, 20, 4, 12, 4, 20);          // 右腿
  if (!legacy) px(4, 52, 4, 12, 8, 20);
  px(20, 20, 8, 12, 4, 8);          // 身体
  px(44, 20, aw, 12, 4 - aw, 8);    // 右臂
  if (!legacy) px(36, 52, aw, 12, 12, 8);
  px(8, 8, 8, 8, 4, 0);             // 头
  px(40, 8, 8, 8, 4, 0);            // 帽子层
  if (!legacy) {
    px(20, 36, 8, 12, 4, 8);
    px(44, 36, aw, 12, 4 - aw, 8);
    px(52, 52, aw, 12, 12, 8);
    px(4, 36, 4, 12, 4, 20);
    px(4, 52, 4, 12, 8, 20);
  }
}

function drawPlaceholder(g, x0, s) {
  const rect = (ux, uy, uw, uh, c) => { g.fillStyle = c; g.fillRect(x0 + ux * s, uy * s, uw * s, uh * s); };
  rect(4, 20, 4, 12, '#3949ab'); rect(8, 20, 4, 12, '#3949ab');
  rect(4, 8, 8, 12, '#3d8f6f');
  rect(0, 8, 4, 12, '#c98f65'); rect(12, 8, 4, 12, '#c98f65');
  rect(4, 0, 8, 8, '#c98f65');
  g.fillStyle = '#5a3d28'; g.fillRect(x0 + 4 * s, 0, 8 * s, 2 * s);
  g.fillStyle = '#ffffff'; g.fillRect(x0 + 5 * s, 4 * s, 2 * s, s); g.fillRect(x0 + 9 * s, 4 * s, 2 * s, s);
  g.fillStyle = '#4a3f8f'; g.fillRect(x0 + 6 * s, 4 * s, s, s); g.fillRect(x0 + 9 * s, 4 * s, s, s);
}

// 3D 预览缺图时的默认皮肤纹理
function drawSkinPlaceholder(g) {
  g.clearRect(0, 0, 64, 64);
  const F = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
  F(0, 0, 32, 16, '#c98f65');
  F(8, 0, 8, 8, '#5a3d28');
  F(16, 16, 24, 16, '#3d8f6f');
  F(40, 16, 16, 16, '#c98f65');
  F(0, 16, 16, 16, '#3949ab');
  F(32, 48, 16, 16, '#c98f65');
  F(16, 48, 16, 16, '#3949ab');
}

function ensureStyle() {
  if (document.getElementById('skins-style')) return;
  const s = document.createElement('style');
  s.id = 'skins-style';
  s.textContent = `
    .skin-card { text-align: center; padding: 12px; }
    .skin-thumb { width: 100%; display: block; image-rendering: pixelated; border-radius: 8px; border: 1px solid var(--border); background: color-mix(in srgb, var(--card-2) 65%, transparent); }
    .skin-detail { display: flex; gap: 18px; flex-wrap: wrap; }
    .skin-3d-wrap { flex: 0 0 320px; max-width: 100%; }
    .skin-detail-side { flex: 1; min-width: 220px; }
    #sk3d { width: 100%; height: auto; cursor: grab; touch-action: none; border-radius: 10px; background: color-mix(in srgb, var(--card-2) 50%, transparent); }
    #sk3d:active { cursor: grabbing; }
    .os-thumb { width: 100%; aspect-ratio: 1; object-fit: contain; image-rendering: pixelated; border-radius: 8px; background: var(--card-2); }
  `;
  document.head.appendChild(s);
}

export default {
  id: 'skins',
  title: '皮肤库',
  icon: '🧑‍🎤',
  routes: ['/skins'],
  order: 5,
  async render(el) {
    runCleanups();
    ensureStyle();
    setBreadcrumb([{ label: '主页', onClick() { location.hash = '/'; } }, { label: '皮肤库' }]);
    el.innerHTML = `
      <div class="row mb-3">
        <div>
          <div class="section-title" style="margin:0">皮肤库</div>
          <div class="small muted mt-1">导入或下载皮肤，再应用到账户；离线账户会在下次启动游戏时生效。</div>
        </div>
        <div class="spacer"></div>
        <button class="btn" id="skin-online-btn">在线搜索</button>
        <button class="btn primary" id="skin-import-btn">导入皮肤</button>
      </div>
      <div id="skin-grid"></div>`;
    const grid = el.querySelector('#skin-grid');
    let itemsCache = [];

    async function load() {
      grid.innerHTML = `<div class="grid auto">${'<div class="skeleton skl-card"></div>'.repeat(4)}</div>`;
      let items;
      try { items = await api.skins.list(); }
      catch (e) {
        grid.innerHTML = `<div class="empty-state"><div class="big">⚠️</div><div class="title">皮肤库加载失败</div>
          <div class="small">${escapeHtml(errMsg(e))}</div>
          <div class="mt-3"><button class="btn" id="sk-retry">重试</button></div></div>`;
        const r = grid.querySelector('#sk-retry');
        if (r) r.onclick = load;
        return;
      }
      itemsCache = Array.isArray(items) ? items : [];
      if (!itemsCache.length) {
        grid.innerHTML = emptyState({
          icon: '🧑‍🎤',
          title: '皮肤库是空的',
          text: '你还没有导入过皮肤。可以从本地选一张图片，或者去皮肤站下载。',
          actionsHtml: '<button class="btn" id="es-online">在线搜索</button> <button class="btn primary" id="es-import">导入皮肤</button>',
        });
        grid.querySelector('#es-online').onclick = openOnlineDialog;
        grid.querySelector('#es-import').onclick = importSkin;
        return;
      }
      grid.innerHTML = `<div class="grid auto">${itemsCache.map(cardHtml).join('')}</div>`;
      for (const c of grid.querySelectorAll('.skin-card')) {
        const it = itemsCache.find((x) => String(x.id) === c.dataset.id);
        renderSkinThumb(c.querySelector('canvas'), it && it.thumbDataUrl, { model: it && it.model });
      }
    }

    function cardHtml(it) {
      return `<div class="card hoverable skin-card" data-id="${escapeHtml(it.id)}">
        <canvas class="skin-thumb" width="128" height="160"></canvas>
        <div class="bold ellipsis mt-2" title="${escapeHtml(it.name)}">${escapeHtml(it.name)}</div>
        <div class="row mt-1" style="gap:6px;justify-content:center">
          <span class="badge">${srcLabel(it.source)}</span>
          <span class="badge">${modelLabel(it.model)}</span>
        </div>
      </div>`;
    }

    grid.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const card = e.target.closest('.skin-card');
      if (!card) return;
      const it = itemsCache.find((x) => String(x.id) === String(card.dataset.id));
      if (it) openDetail(it);
    });

    async function importSkin() {
      let p;
      try {
        p = await api.pick.file({ title: '选择皮肤图片', filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }] });
      } catch (e) { toast(errMsg(e), 'error'); return; }
      if (!p) return;
      try {
        const r = await api.skins.importFile(p);
        if (r && r.needCrop) { await cropDialog(p, r); return; }
        toast('皮肤已导入皮肤库', 'ok');
        load();
      } catch (e) { toast(errMsg(e), 'error'); }
    }

    async function cropDialog(p, r) {
      const v = await showDialog({
        title: '需要调整尺寸',
        body: `<p>这张图片尺寸是 ${escapeHtml(String(r.width))}×${escapeHtml(String(r.height))}，MC 皮肤需要 64×64 或 64×32。要尝试自动裁剪吗？</p>
          <div class="center mt-2"><img src="${escapeHtml(r.previewDataUrl || '')}" alt="预览" style="max-width:220px;max-height:220px;image-rendering:pixelated;border-radius:8px;border:1px solid var(--border-2)"></div>`,
        actions: [
          { label: '算了', value: null },
          { label: '拉伸到 64×64', value: 'stretch' },
          { label: '自动居中裁剪', value: 'center', primary: true },
        ],
      });
      if (!v) return;
      try {
        await api.skins.importCropped({ path: p, mode: v });
        toast('皮肤已导入皮肤库', 'ok');
        load();
      } catch (e) { toast(errMsg(e), 'error'); }
    }

    function openOnlineDialog() {
      showDialog({
        title: '在线搜索皮肤',
        wide: true,
        body: `
          <div class="row">
            <select class="input" id="os-site" style="width:140px;flex:0 0 auto">
              <option value="littleskin">LittleSkin</option>
              <option value="elyby">Ely.by</option>
            </select>
            <input class="input" id="os-q" placeholder="输入玩家的完整昵称">
            <button class="btn primary" id="os-go" style="flex:0 0 auto">搜索</button>
          </div>
          <div id="os-results" class="mt-3"><div class="small muted-3">输入昵称搜一搜，选中后保存到皮肤库。</div></div>`,
        actions: [{ label: '关闭', value: true }],
        onMount(mask) {
          const q = mask.querySelector('#os-q');
          const res = mask.querySelector('#os-results');
          const site = mask.querySelector('#os-site');
          async function run() {
            const query = q.value.trim();
            if (!query) { toast('先输入要搜索的玩家昵称', 'warn'); return; }
            res.innerHTML = '<div class="row small muted"><div class="spinner sm"></div>正在搜索…</div>';
            let list;
            try { list = await api.skins.search({ site: site.value, query }); }
            catch (e) {
              res.innerHTML = `<div class="small" style="color:var(--err)">搜索失败：${escapeHtml(errMsg(e))}</div>
                <button class="btn sm mt-2" id="os-retry">重试</button>`;
              const b = res.querySelector('#os-retry');
              if (b) b.onclick = run;
              return;
            }
            list = Array.isArray(list) ? list : [];
            if (!list.length) {
              res.innerHTML = `<div class="small muted">没有找到叫“${escapeHtml(query)}”的皮肤。试试完整昵称。</div>`;
              return;
            }
            res.innerHTML = `<div class="grid cols-3">${list.map((r) => `
              <div class="card center">
                <img class="os-thumb" src="${escapeHtml(r.thumbUrl || '')}" alt="" onerror="this.style.opacity=.15">
                <div class="small ellipsis mt-1" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</div>
                <button class="btn sm block mt-1" data-sid="${escapeHtml(r.id)}" data-name="${escapeHtml(r.name)}">保存到皮肤库</button>
              </div>`).join('')}</div>`;
            res.querySelectorAll('[data-sid]').forEach((b) => {
              b.onclick = async () => {
                b.disabled = true; b.textContent = '保存中…';
                try {
                  await api.skins.downloadOnline({ site: site.value, skinId: b.dataset.sid, name: b.dataset.name });
                  toast(`已把「${b.dataset.name}」保存到皮肤库`, 'ok');
                  load();
                  b.textContent = '已保存';
                } catch (e) {
                  b.disabled = false; b.textContent = '保存到皮肤库';
                  toast(errMsg(e), 'error');
                }
              };
            });
          }
          mask.querySelector('#os-go').onclick = run;
          q.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
          q.focus();
        },
      });
    }

    async function openDetail(it) {
      const body = `
        <div class="skin-detail">
          <div class="skin-3d-wrap">
            <canvas id="sk3d" width="320" height="320"></canvas>
            <div class="tiny muted-3 center mt-1">拖动旋转 · 滚轮缩放</div>
          </div>
          <div class="skin-detail-side">
            <div class="bold" style="font-size:16px">${escapeHtml(it.name)}</div>
            <div class="row mt-1" style="gap:6px">
              <span class="badge">${srcLabel(it.source)}</span>
              <span class="badge">${modelLabel(it.model)}</span>
            </div>
            <label class="field mt-3"><span class="field-label">应用到账户</span>
              <select class="input" id="sk-acc"><option value="">加载账户中…</option></select></label>
            <div class="row wrap mt-2" style="gap:8px">
              <button class="btn primary" id="sk-apply">应用到账户</button>
              <button class="btn" id="sk-export">导出</button>
              <button class="btn danger" id="sk-del">删除</button>
            </div>
            <div id="sk-msg" class="small muted mt-2"></div>
          </div>
        </div>`;
      await showDialog({
        title: '皮肤详情',
        body,
        wide: true,
        actions: [{ label: '关闭', value: true }],
        onMount(mask, close) {
          init3D(mask, it);
          let accounts = [];
          (async () => {
            const sel = mask.querySelector('#sk-acc');
            if (!sel) return;
            try { accounts = (await api.accounts.list()) || []; }
            catch { sel.innerHTML = '<option value="">账户列表暂时无法获取，稍后再试</option>'; return; }
            if (!accounts.length) { sel.innerHTML = '<option value="">还没有账户，先去账户页添加一个</option>'; return; }
            sel.innerHTML = accounts.map((a) =>
              `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}（${TYPE_LABEL[a.type] || a.type}）</option>`).join('');
          })();
          mask.querySelector('#sk-apply').onclick = async () => {
            const sel = mask.querySelector('#sk-acc');
            const accId = sel && sel.value;
            if (!accId) { toast('先选择一个账户，或去账户页添加一个', 'warn'); return; }
            const acc = accounts.find((a) => String(a.id) === String(accId));
            try {
              await api.skins.applyToAccount({ skinId: it.id, accountId: accId, model: it.model || 'classic' });
              toast(`已为账户 ${acc ? acc.name : ''} 应用皮肤。离线账户会在下次启动游戏时生效。`, 'ok', 4500);
            } catch (e) { toast(errMsg(e), 'error'); }
          };
          mask.querySelector('#sk-export').onclick = async () => {
            try {
              const dest = await api.pick.save({
                title: '导出皮肤',
                defaultName: `${it.name || 'skin'}.png`,
                filters: [{ name: 'PNG 图片', extensions: ['png'] }],
              });
              if (!dest) return;
              await api.skins.export({ skinId: it.id, destPath: dest });
              toast(`皮肤已导出到 ${dest}`, 'ok');
            } catch (e) { toast(errMsg(e), 'error'); }
          };
          mask.querySelector('#sk-del').onclick = async () => {
            const ok = await confirmDialog('删除皮肤', `确定删除皮肤「${it.name}」吗？删除后无法恢复。`, { danger: true, okLabel: '删除' });
            if (!ok) return;
            try {
              await api.skins.remove(it.id);
              toast('皮肤已删除', 'ok');
              close(true);
              load();
            } catch (e) { toast(errMsg(e), 'error'); }
          };
        },
      });
    }

    // three.js 盒状模型：头/身/双臂/双腿按皮肤 UV 贴图，自转 + 拖拽 + 滚轮缩放
    async function init3D(mask, item) {
      const cnv = mask.querySelector('#sk3d');
      if (!cnv) return;
      let dead = false, raf = 0;
      const disposables = [];
      const texCanvas = document.createElement('canvas');
      texCanvas.width = 64; texCanvas.height = 64;
      const tg = texCanvas.getContext('2d');
      tg.imageSmoothingEnabled = false;
      let loaded = false;
      if (item.thumbDataUrl) {
        try {
          const img = await loadImage(item.thumbDataUrl);
          if (dead) return;
          if (img.width === 64 && img.height === 64) {
            tg.drawImage(img, 0, 0);
          } else if (img.width === 64 && img.height === 32) {
            tg.drawImage(img, 0, 0);
            tg.save(); tg.translate(48, 48); tg.scale(-1, 1); tg.drawImage(img, 40, 16, 16, 16, 0, 0, 16, 16); tg.restore();
            tg.save(); tg.translate(32, 48); tg.scale(-1, 1); tg.drawImage(img, 0, 16, 16, 16, 0, 0, 16, 16); tg.restore();
          } else {
            tg.drawImage(img, 0, 0, img.width, img.height, 0, 0, 64, 64);
          }
          loaded = true;
        } catch { loaded = false; }
      }
      if (!loaded) drawSkinPlaceholder(tg);

      const tex = new THREE.CanvasTexture(texCanvas);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
      disposables.push(tex);
      const material = new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5 });
      disposables.push(material);

      const renderer = new THREE.WebGLRenderer({ canvas: cnv, alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(320, 320, false);
      disposables.push(renderer);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500);
      const group = new THREE.Group();
      group.position.y = -16;
      scene.add(group);

      function part(w, h, d, x, y, z, ox, oy, inflate = 0) {
        const geo = new THREE.BoxGeometry(w + inflate, h + inflate, d + inflate);
        const uv = geo.attributes.uv;
        const faceUV = (fi, sx, sy, sw, sh) => {
          const u0 = sx / 64, u1 = (sx + sw) / 64;
          const v1 = 1 - sy / 64, v0 = 1 - (sy + sh) / 64;
          const i = fi * 4;
          uv.setXY(i, u0, v1); uv.setXY(i + 1, u1, v1);
          uv.setXY(i + 2, u0, v0); uv.setXY(i + 3, u1, v0);
        };
        // BoxGeometry 面顺序：+x -x +y -y +z -z；角色面向 +z
        faceUV(0, ox + d + w, oy + d, d, h);
        faceUV(1, ox, oy + d, d, h);
        faceUV(2, ox + d, oy, w, d);
        faceUV(3, ox + d + w, oy, w, d);
        faceUV(4, ox + d, oy + d, w, h);
        faceUV(5, ox + d + w + d, oy + d, w, h);
        uv.needsUpdate = true;
        const mesh = new THREE.Mesh(geo, material);
        mesh.position.set(x, y, z);
        group.add(mesh);
        disposables.push(geo);
      }

      const slim = item.model === 'slim';
      const aw = slim ? 3 : 4;
      part(4, 12, 4, -2, 6, 0, 0, 16);
      part(4, 12, 4, -2, 6, 0, 0, 32, 1);
      part(4, 12, 4, 2, 6, 0, 16, 48);
      part(4, 12, 4, 2, 6, 0, 0, 48, 1);
      part(8, 12, 4, 0, 18, 0, 16, 16);
      part(8, 12, 4, 0, 18, 0, 16, 32, 1);
      part(aw, 12, 4, -(4 + aw / 2), 18, 0, 40, 16);
      part(aw, 12, 4, -(4 + aw / 2), 18, 0, 40, 32, 1);
      part(aw, 12, 4, 4 + aw / 2, 18, 0, 32, 48);
      part(aw, 12, 4, 4 + aw / 2, 18, 0, 48, 48, 1);
      part(8, 8, 8, 0, 28, 0, 0, 0);
      part(8, 8, 8, 0, 28, 0, 32, 0, 1);

      let rotY = 0.5, auto = true, dragging = false, lastX = 0, zoom = 68;
      const onDown = (e) => { dragging = true; auto = false; lastX = e.clientX; try { cnv.setPointerCapture(e.pointerId); } catch { /* 忽略 */ } };
      const onMove = (e) => { if (!dragging) return; rotY += (e.clientX - lastX) * 0.012; lastX = e.clientX; };
      const onUp = () => { dragging = false; };
      const onWheel = (e) => { e.preventDefault(); zoom = Math.max(40, Math.min(140, zoom + e.deltaY * 0.06)); };
      cnv.addEventListener('pointerdown', onDown);
      cnv.addEventListener('pointermove', onMove);
      cnv.addEventListener('pointerup', onUp);
      cnv.addEventListener('pointercancel', onUp);
      cnv.addEventListener('wheel', onWheel, { passive: false });

      const tick = () => {
        if (dead) return;
        raf = requestAnimationFrame(tick);
        if (auto && !dragging) rotY += 0.012;
        group.rotation.y = rotY;
        camera.position.set(0, 4, zoom);
        camera.lookAt(0, 0, 0);
        renderer.render(scene, camera);
      };
      tick();

      function dispose3D() {
        if (dead) return;
        dead = true;
        cancelAnimationFrame(raf);
        for (const d of disposables) { try { d.dispose && d.dispose(); } catch { /* 忽略 */ } }
      }
      const obs = new MutationObserver(() => { if (!mask.isConnected) { obs.disconnect(); dispose3D(); } });
      obs.observe(document.getElementById('modal-holder'), { childList: true });
      addCleanup(dispose3D);
    }

    el.querySelector('#skin-online-btn').onclick = openOnlineDialog;
    el.querySelector('#skin-import-btn').onclick = importSkin;
    await load();
  },
};
