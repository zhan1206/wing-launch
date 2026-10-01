// 统一下载管理器：队列 / 暂停继续 / 断点续传 / 校验 / 速度统计 / 失败重试
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { dirs } = require('../paths');
const config = require('../config');
const sources = require('./sources');
const { broadcast } = require('../emitter');
const { UserError } = require('../ipc-gateway');

let SEQ = 1;
const tasks = new Map(); // id -> task

const taskView = (t) => ({
  id: t.id, name: t.name, type: t.type, state: t.state,
  received: t.received, total: t.total, speed: t.speed,
  etaText: t.etaText || '', error: t.error, quiet: t.quiet,
});

let bcTimer = null;
function broadcastProgress(t) {
  broadcast('bb:download-progress', taskView(t));
}
function broadcastProgressThrottled(t) {
  if (t.quiet) return; // 大批量小文件（如资源文件）静默聚合
  const now = Date.now();
  if (now - (t._lastBc || 0) > 180) { t._lastBc = now; broadcastProgress(t); }
}
function broadcastChanged() {
  clearTimeout(bcTimer);
  bcTimer = setTimeout(() => {
    broadcast('bb:downloads-changed', list());
    persist();
  }, 200);
}
function list() { return [...tasks.values()].map(taskView); }
function persist() {
  try {
    const data = [...tasks.values()].filter((t) => t.state === 'downloading' || t.state === 'paused' || t.state === 'pending')
      .map((t) => ({ id: t.id, name: t.name, type: t.type, urls: t.urls, dest: t.dest, sha1: t.sha1, size: t.total, received: t.received, meta: t.meta, quiet: t.quiet }));
    config.writeJson(dirs().downloadsFile, data);
  } catch { /* */ }
}
function restorePersisted() {
  let arr = [];
  try { arr = config.readJson(dirs().downloadsFile, []); } catch { /* */ }
  for (const d of arr) {
    const t = makeTask({ ...d, type: d.type || '其他', resumeFrom: d.received || 0 });
    t.state = 'paused';
    t.error = '上次启动器退出时下载未完成，已暂停。点击“继续”即可从断点继续。';
    tasks.set(t.id, t);
  }
}
function makeTask(opt) {
  if (!opt.dest) throw new UserError('下载任务缺少保存位置（内部配置错误）。');
  return {
    id: 'dl-' + (SEQ++) + '-' + Date.now().toString(36),
    name: opt.name || '未命名任务', type: opt.type || '其他',
    urls: opt.urls || [], dest: opt.dest, sha1: opt.sha1 || null, sha256: opt.sha256 || null,
    state: 'pending', received: opt.resumeFrom || 0, total: opt.size || 0,
    speed: 0, etaText: '', error: null, quiet: !!opt.quiet,
    meta: opt.meta || {}, onDone: opt.onDone || null,
    _ctl: null, _acceptRanges: false,
  };
}

async function pump() {
  const max = Math.max(2, Number(config.get().maxConcurrentDownloads) || 4);
  const active = [...tasks.values()].filter((t) => t.state === 'downloading').length;
  let slots = max - active;
  if (slots <= 0) return;
  for (const t of tasks.values()) {
    if (t.state !== 'pending' || t._running) continue;
    if (slots-- <= 0) break;
    t.state = 'downloading';
    t.error = null;
    broadcastChanged();
    runTask(t).catch((e) => { /* 已在 runTask 内处理 */ });
  }
}

function fmtSize(n) { return n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(0, Math.round(n / 1e3)) + ' KB'; }

function checkHash(t) {
  try {
    if (t.sha256) return crypto.createHash('sha256').update(fs.readFileSync(t.dest)).digest('hex') !== t.sha256;
    if (t.sha1) return crypto.createHash('sha1').update(fs.readFileSync(t.dest)).digest('hex') !== t.sha1;
  } catch { return false; }
  return false;
}

async function runTask(t) {
  const attempt = async () => {
    let lastErr = null;
    for (const url of t.urls) {
      try {
        await downloadOne(t, url);
        return;
      } catch (e) {
        if (t.state === 'paused' || t.state === 'canceled') throw e;
        sources.noteFailure(url, config.get().downloadSource);
        lastErr = e;
      }
    }
    throw lastErr || new Error('下载失败');
  };
  t._running = true;
  try {
    await attempt();
    // 校验失败：自动删除重下一次，仍失败才报错（保持 downloading 状态，防止 pump 重复启动）
    if (checkHash(t) && !t._reverified) {
      t._reverified = true;
      fs.rmSync(t.dest, { force: true });
      t.received = 0;
      broadcastChanged();
      const r = await runTask(t);
      t._running = false;
      return r;
    }
    if (checkHash(t)) throw new Error('文件校验失败：已自动重新下载过一次仍不一致。可能是下载源或网络有问题，建议稍后重试。');
    t.state = 'done';
    t.etaText = '';
    t.speed = 0;
    broadcastProgress(t);
    try { if (t.onDone) await t.onDone(t); } catch (e) { t.state = 'error'; t.error = '下载完成，但后续处理失败：' + (e.userMessage || e.message); t._reject && t._reject(e); }
    if (t.state === 'done') t._resolve && t._resolve(t.dest);
    t._running = false;
    broadcastChanged();
  } catch (e) {
    t._running = false;
    if (t.state === 'paused') { broadcastProgress(t); t._reject && t._reject(new UserError('下载已暂停')); return; }
    if (t.state === 'canceled') { t._reject && t._reject(new UserError('下载已取消')); return; }
    t.state = 'error';
    t.speed = 0;
    t.error = friendlyDlError(e, t) || ('下载失败：' + String(e.message || e));
    broadcastProgress(t);
    t._reject && t._reject(new UserError(t.error));
    broadcastChanged();
  }
}

function friendlyDlError(e, task) {
  const m = String(e.message || e);
  if (task && task.state === 'paused') return '';
  if (m.includes('space')) return '磁盘空间不足。请清理一些空间后，点击“继续下载”。';
  if (m.includes('ENOTFOUND') || m.includes('EAI_AGAIN')) return '网络连不上（域名解析失败）。请检查网络连接或稍后重试。';
  if (m.includes('ECONNRESET') || m.includes('aborted') || m.includes('EPIPE')) return '下载中断了。已下载的部分还在，点击“继续下载”可以从断点继续。';
  if (m.includes('404')) return '下载地址已失效（404）。可以尝试切换下载源后重试。';
  if (m.includes('403')) return '下载被拒绝（403）。换个下载源通常能解决。';
  if (m.includes('abort')) return '下载超时了。网络不稳定时会出现，点击“继续”再试一次。';
  return '下载失败：' + m;
}
const t_state = (t) => t.state;

async function downloadOne(t, url) {
  // 从断点续传
  let headers = { 'user-agent': 'BlockBox/1.0' };
  const partial = t.dest + '.part';
  fs.mkdirSync(path.dirname(partial), { recursive: true });
  const tmpFile = partial;
  let startFrom = 0;
  if (fs.existsSync(tmpFile)) startFrom = fs.statSync(tmpFile).size;
  if (startFrom > 0) headers['range'] = `bytes=${startFrom}-`;

  const ctl = new AbortController();
  t._ctl = ctl;
  const timer = setTimeout(() => ctl.abort(), 30000); // 连接超时
  let res;
  try {
    res = await fetch(url, { signal: ctl.signal, headers });
  } finally { clearTimeout(timer); }

  if (res.status === 416) { // 断点越界：重下
    fs.rmSync(tmpFile, { force: true });
    return downloadOne(t, url);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const acceptRanges = res.headers.get('accept-ranges') === 'bytes' && startFrom > 0 && res.status === 206;
  if (!acceptRanges) startFrom = 0;
  t._acceptRanges = acceptRanges;
  const total = parseInt(res.headers.get('content-length') || '0', 10) + startFrom;
  if (total > 0) t.total = total;
  else if (res.headers.get('content-range')) {
    const m = /\/(\d+)/.exec(res.headers.get('content-range'));
    if (m) t.total = parseInt(m[1], 10);
  }

  let received = startFrom;
  t.received = received;
  let lastTick = Date.now(), lastRecv = received, idleTimer = null;
  const idle = () => { idleTimer = setTimeout(() => ctl.abort(new Error('下载超时了。网络不稳定时会出现，点击“继续”再试一次。')), 20000); };
  idle();

  const stream = fs.createWriteStream(tmpFile, { flags: startFrom > 0 ? 'a' : 'w' });
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (t.state === 'paused' || t.state === 'canceled') { ctl.abort(new Error('paused')); }
      await new Promise((resolve, reject) => {
        stream.write(Buffer.from(value), (err) => (err ? reject(err) : resolve()));
      });
      received += value.byteLength;
      t.received = received;
      clearTimeout(idleTimer); idle();
      const now = Date.now();
      if (now - lastTick > 400) {
        const dt = (now - lastTick) / 1000;
        const inst = (received - lastRecv) / dt;
        t.speed = t.speed ? t.speed * 0.6 + inst * 0.4 : inst;
        lastTick = now; lastRecv = received;
        const remain = t.total > received ? (t.total - received) / (t.speed || 1) : 0;
        t.etaText = t.total > received && t.speed > 0
          ? (remain > 90 ? Math.round(remain / 60) + ' 分钟' : Math.round(remain) + ' 秒')
          : '';
        broadcastProgressThrottled(t);
      }
    }
  } catch (e) {
    clearTimeout(idleTimer);
    stream.close();
    if (t.state === 'paused' || t.state === 'canceled') { broadcastProgressThrottled(t); return; } // 保持 .part
    throw e;
  }
  clearTimeout(idleTimer);
  await new Promise((r) => stream.end(r));
  fs.renameSync(tmpFile, t.dest);
}

// ---------- 对外 API ----------
function freeBytes(dir) {
  try { const st = fs.statfsSync(dir); return st.bsize * st.bavail; } catch { return Infinity; }
}
// 添加任务并返回 Promise（内部流程等待用）；同时在下载中心可见
function download(opt) {
  // 磁盘空间预检：已知大小时要求 剩余 ≥ 大小 + 200MB
  if (opt.dest && opt.size && opt.size > 50 * 1024 * 1024) {
    const need = opt.size + 200 * 1024 * 1024;
    const free = freeBytes(path.dirname(opt.dest));
    if (free < need) {
      const needGB = (need / 1e9).toFixed(1), freeGB = (free / 1e9).toFixed(1);
      return Promise.reject(new UserError('磁盘空间不足：这个下载需要约 ' + needGB + 'GB 空间，当前目标磁盘只剩约 ' + freeGB + 'GB。请清理一些空间（比如删除旧备份或没用的实例）后再试。'));
    }
  }
  // 已有完整目标文件（校验通过）→ 秒回
  if (opt.dest && fs.existsSync(opt.dest)) {
    try {
      if (!opt.sha1 && !opt.sha256) return Promise.resolve(opt.dest);
      if (opt.sha256) {
        const h = crypto.createHash('sha256').update(fs.readFileSync(opt.dest)).digest('hex');
        if (h === opt.sha256) return Promise.resolve(opt.dest);
      } else {
        const h = crypto.createHash('sha1').update(fs.readFileSync(opt.dest)).digest('hex');
        if (h === opt.sha1) return Promise.resolve(opt.dest);
      }
    } catch { /* 重新下载 */ }
  }
  const urls = opt.urls || sources.candidates(opt.url, opt.source || config.get().downloadSource);
  const t = makeTask({ ...opt, urls });
  tasks.set(t.id, t);
  broadcastChanged();
  const p = new Promise((resolve, reject) => {
    t._resolve = resolve; t._reject = reject;
  });
  t.onDone = async (tt) => { tt._resolve && tt._resolve(tt.dest); };
  pump();
  return p;
}

function add(opt) { // 只入队，不等待（用于批量）
  const urls = opt.urls || sources.candidates(opt.url, opt.source || config.get().downloadSource);
  const t = makeTask({ ...opt, urls });
  tasks.set(t.id, t);
  broadcastChanged();
  setImmediate(pump);
  return t.id;
}
async function addBulk(items, { concurrency = 12 } = {}) {
  // 批量小文件：静默聚合进度
  let done = 0, failed = 0;
  const failures = [];
  const queue = [...items];
  broadcast('bb:downloads-changed', list());
  async function worker() {
    while (queue.length) {
      const it = queue.shift();
      const t = makeTask({ ...it, urls: it.urls || sources.candidates(it.url, config.get().downloadSource), quiet: true });
      tasks.set(t.id, t);
      try {
        t.state = 'downloading';
        await downloadOne(t, t.urls[0]).catch(async () => { await downloadOne(t, t.urls[1]); });
        if (t.sha1) {
          const h = crypto.createHash('sha1').update(fs.readFileSync(t.dest)).digest('hex');
          if (h !== t.sha1) throw new Error('校验不一致');
        }
        t.state = 'done';
      } catch (e) {
        if (t.state === 'paused') { t.state = 'paused'; failures.push({ name: t.name, error: '已暂停' }); continue; }
        t.state = 'error';
        t.error = friendlyDlError(e, t) || '下载失败';
        failed++; failures.push({ name: t.name, error: t.error, id: t.id });
      }
      done++;
      if (done % 50 === 0) {
        broadcast('bb:download-progress', {
          id: 'bulk-' + (items._bulkId || ''), name: `资源文件 ${done}/${items.length}`,
          type: '批量', state: 'downloading', received: done, total: items.length, speed: 0, etaText: '', quiet: true,
        });
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  broadcast('bb:downloads-changed', list());
  return { done: done - failed, failed, failures };
}

function pause(id) {
  const t = tasks.get(id);
  if (!t || t.state !== 'downloading') return false;
  t.state = 'paused';
  try { t._ctl && t._ctl.abort(new Error('paused')); } catch { /* */ }
  broadcastProgress(t); broadcastChanged();
  return true;
}
function resume(id) {
  const t = tasks.get(id);
  if (!t) return false;
  if (t.state !== 'paused' && t.state !== 'error') return false;
  t.state = 'pending'; t.error = null;
  broadcastChanged();
  pump();
  return true;
}
function retry(id) { return resume(id); }
function cancel(id) {
  const t = tasks.get(id);
  if (!t) return false;
  t.state = 'canceled';
  try { t._ctl && t._ctl.abort(new Error('canceled')); } catch { /* */ }
  if (!t.quiet) setTimeout(() => { tasks.delete(id); broadcastChanged(); }, 100);
  else tasks.delete(id);
  broadcastChanged();
  return true;
}
function pauseAll() { for (const t of tasks.values()) if (t.state === 'downloading' || t.state === 'pending') pause(t.id); }
function resumeAll() { for (const t of tasks.values()) if (t.state === 'paused' || t.state === 'error') resume(t.id); }
function clearFinished() {
  for (const [id, t] of [...tasks]) if (t.state === 'done' || t.state === 'canceled') tasks.delete(id);
  broadcastChanged();
}

function registerAll(register) {
  register({
    'downloads.list': () => list(),
    'downloads.pause': ({ id }) => pause(id),
    'downloads.resume': ({ id }) => resume(id),
    'downloads.retry': ({ id }) => resume(id),
    'downloads.cancel': ({ id }) => cancel(id),
    'downloads.pauseAll': () => { pauseAll(); return true; },
    'downloads.resumeAll': () => { resumeAll(); return true; },
    'downloads.clear': () => { clearFinished(); return true; },
    // 测试辅助：可控下载（指定 URL/目标/校验/自动取消延时）
    'downloads.testDownload': ({ url, dest, sha1, cancelAfterMs }) => {
      const p = download({ name: '测试下载', type: '其他', url, dest, sha1, size: 0 });
      if (cancelAfterMs) {
        setTimeout(() => {
          const hit = [...tasks.entries()].find(([, t]) => t.dest === dest);
          if (hit) cancel(hit[0]);
        }, cancelAfterMs);
      }
      return p;
    },
  });
}

module.exports = { download, add, addBulk, list, pause, resume, retry, cancel, pauseAll, resumeAll, restorePersisted, registerAll, getTask: (id) => tasks.get(id) };
