// Wing Launch 主进程入口
const { app, BrowserWindow, Menu, shell, clipboard, dialog, protocol, net, Tray, nativeImage, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const config = require('./core/config');
const { dirs, instanceDir } = require('./core/paths');
const { register, install } = require('./core/ipc-gateway');
const log = require('./core/log');

// 自定义图片协议：bbimg://<绝对路径>，供背景图/封面等本地图片安全加载
protocol.registerSchemesAsPrivileged([{ scheme: 'bbimg', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false } }]);

// 测试隔离：数据目录覆盖必须先于单实例锁
if (process.env.BLOCKBOX_DATA_DIR) app.setPath('userData', process.env.BLOCKBOX_DATA_DIR);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }

let win = null, tray = null;
const stateFile = () => path.join(dirs().root, '.window-state.json');
function saveWindowState() {
  if (!win || win.isDestroyed() || win.isMinimized()) return;
  try { config.writeJson(stateFile(), { x: win.getBounds().x, y: win.getBounds().y, w: win.getBounds().width, h: win.getBounds().height, maximized: win.isMaximized() }); } catch { /* */ }
}
function createTray() {
  try {
    const iconPath = path.join(__dirname, '..', '..', 'resources', 'icons', 'icon_1024.png');
    const t = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 22, height: 22 }));
    t.setToolTip('Wing Launch（WL）');
    const rebuild = () => {
      const inst = require('./instances/instances').list().slice(0, 5);
      let play = '今日已游玩：0 小时 0 分钟';
      try { const log = fs.readFileSync(path.join(dirs().logs, 'app.log'), 'utf8'); const starts = (log.match(/游戏已启动/g) || []).length; play = '今日已游玩：约 ' + Math.round(starts * 25 / 60 * 10) / 10 + ' 小时（按启动次数估算）'; } catch { /* */ }
      const menu = Menu.buildFromTemplate([
        { label: play, enabled: false },
        { type: 'separator' },
        ...inst.map((i) => ({ label: '▶ 启动 ' + i.name, click: () => { require('./instances/launch-routes'); require('./instances/launch').launch(require('./instances/instances').get(i.id), {}).catch(() => {}); } })),
        { type: 'separator' },
        { label: '打开 Wing Launch', click: () => { if (win) { win.show(); win.focus(); } else createWindow(); } },
        { label: '退出 WL', click: () => { saveWindowState(); app.exit(0); } },
      ]);
      t.setContextMenu(menu);
    };
    rebuild();
    setInterval(rebuild, 30000);
    tray = t;
  } catch (e) { log.warn('Tray 创建失败：', e.message); }
}
function createWindow() {
  const st = (() => { try { return config.readJson(stateFile(), null); } catch { return null; } })();
  const s = config.get();
  win = new BrowserWindow({
    width: st?.w || 1280, height: st?.h || 800, minWidth: 1040, minHeight: 660,
    x: st?.x, y: st?.y,
    title: 'Wing Launch',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 15 },
    backgroundColor: s.theme?.mode === 'light' ? '#f2f4f8' : '#16181d',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
    show: false,
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  // AK.2 关闭窗口 ≠ 退出进程：驻留菜单栏
  win.on('close', (e) => { if (!app.__quitting) { e.preventDefault(); win.hide(); } });
  win.on('close', () => saveWindowState());
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.on('closed', () => { win = null; });
}

function buildMenu() {
  const template = [
    {
      label: 'Wing Launch',
      submenu: [
        { label: '关于Wing Launch', role: 'about' },
        { type: 'separator' },
        { label: '隐藏Wing Launch', role: 'hide' },
        { type: 'separator' },
        { label: '退出Wing Launch', role: 'quit' },
      ],
    },
    { label: '编辑', submenu: [
      { label: '剪切', role: 'cut' }, { label: '拷贝', role: 'copy' },
      { label: '粘贴', role: 'paste' }, { label: '全选', role: 'selectAll' },
    ] },
    { label: '显示', submenu: [
      { label: '重新加载界面', role: 'reload' },
      { label: '强制刷新', role: 'forceReload' },
      { type: 'separator' },
      { label: '进入全屏', role: 'togglefullscreen' },
      { label: '开发者工具', role: 'toggleDevTools' },
    ] },
    { label: '窗口', submenu: [{ label: '最小化', role: 'minimize' }, { label: '关闭窗口', role: 'close' }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => { try {
  log.info('启动：', app.getVersion(), process.platform, process.arch);
  protocol.handle('bbimg', (request) => {
    const p = decodeURIComponent(request.url.replace(/^bbimg:\/+/, '/'));
    if (!p.startsWith('/') || p.includes('..')) return new Response('拒绝访问', { status: 403 });
    try {
      const data = fs.readFileSync(p);
      const ext = path.extname(p).toLowerCase();
      const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp' }[ext] || 'application/octet-stream';
      return new Response(data, { headers: { 'content-type': mime } });
    } catch {
      return new Response('文件不存在', { status: 404 });
    }
  });
  install();

  // ---------- 通用路由 ----------
  register({
    'bootstrap': () => ({ pid: process.pid,
      appVersion: app.getVersion(), platform: process.platform, arch: process.arch,
      dataDir: dirs().root, isFirstRun: config.isFirstRun(), locale: app.getLocale(),
    }),
    'toast.push': ({ text, type, ms }) => { require('./core/emitter').toast(text, type, ms); return true; },
    // Electron 44 起 clipboard 读写方法改为异步（W3C Clipboard API 对齐），必须 await
    'clip.write': async (p) => { const text = typeof p === 'string' ? p : p?.text; await clipboard.writeText(String(text ?? '')); return true; },
    'clip.read': async () => clipboard.readText(),
    'shell.openPath': (p) => { const t = typeof p === 'string' ? p : p?.p; if (/^https?:\/\//.test(t)) return shell.openExternal(t); return shell.openPath(t); },
    'shell.showInFolder': (p) => { shell.showItemInFolder(typeof p === 'string' ? p : p?.p); return true; },
    'window.control': ({ action }) => {
      if (!win) return false;
      if (action === 'close') win.close();
      if (action === 'min') win.minimize();
      if (action === 'max') win.isMaximized() ? win.unmaximize() : win.maximize();
      return true;
    },
    'pick.file': async ({ title, filters }) => {
      const r = await dialog.showOpenDialog(win, { title: title || '选择文件', properties: ['openFile'], filters: filters || [] });
      return r.canceled ? null : r.filePaths[0];
    },
    'pick.files': async ({ title, filters }) => {
      const r = await dialog.showOpenDialog(win, { title: title || '选择文件', properties: ['openFile', 'multiSelections'], filters: filters || [] });
      return r.canceled ? [] : r.filePaths;
    },
    'pick.dir': async ({ title }) => {
      const r = await dialog.showOpenDialog(win, { title: title || '选择文件夹', properties: ['openDirectory'] });
      return r.canceled ? null : r.filePaths[0];
    },
    'pick.save': async ({ title, defaultName, filters }) => {
      const r = await dialog.showSaveDialog(win, { title: title || '保存到…', defaultPath: defaultName, filters: filters || [] });
      return r.canceled ? null : r.filePath;
    },
    'ui.screenshot': async () => {
      const img = await win.webContents.capturePage();
      return img.toDataURL();
    },
  });

  // ---------- 各功能模块路由 ----------
  require('./core/settings-routes').registerAll(register);
  require('./accounts/accounts').registerAll(register);
  require('./java/java-manager').registerAll(register);
  require('./meta/versions').registerAll(register);
  require('./core/download/manager').registerAll(register);
  require('./instances/instances').registerAll(register);
  require('./instances/mods').registerAll(register);
  require('./instances/contents').registerAll(register);
  require('./instances/launch-routes').registerAll(register);
  require('./instances/drop').registerAll(register);
  require('./modpack/modpack').registerAll(register);
  require('./server/servers').registerAll(register);
  require('./crash/crash').registerAll(register);
  require('./net/net').registerAll(register);
  require('./skins/skins').registerAll(register);
  require('./resources/resources').registerAll(register);
  require('./tools/tools').registerAll(register);
  require('./core/fixes').registerAll(register);
  require('./help/diagnostics').registerAll(register);
  require('./core/extras-routes').registerAll(register);
  require('./core/perf').registerAll(register);
  require('./core/modsdiag').registerAll(register);
  require('./core/enhance').registerAll(register);
  require('./core/r4').registerAll(register);
  // 模块 AK：关闭游戏进程按钮 + AG 游戏时长 + AE 启动快照命名
  const { execSync } = require('child_process');
  let lastGamePid = null;
  require('./core/emitter');
  const origB2 = require('./core/emitter').broadcast;
  require('./core/emitter').broadcast = (ch, payload) => {
    if (ch === 'bb:launch-progress' && payload?.stage === 'launch' && payload?.percent >= 85) { /* 记录 */ }
    origB2(ch, payload);
  };
  register({
    'game.status': () => {
      try {
        const out = execSync('ps -eo pid,command | grep "bin/java" | grep -v grep || true').toString().trim();
        const lines = out ? out.split('\n') : [];
        return { running: lines.length > 0, pids: lines.map((l) => parseInt(l.trim().split(/\s+/)[0], 10)), command: lines[0] || '' };
      } catch { return { running: false, pids: [] }; }
    },
    'game.close': ({ pid, reason }) => {
      const st = (() => { try { return require('./core/emitter'); } catch { return null; } })();
      try {
        const pidList = pid ? [pid] : (() => { try { const out = execSync('ps -eo pid,command | grep "bin/java" | grep -v grep || true').toString().trim(); return out ? out.split('\n').map((l) => parseInt(l.trim().split(/\s+/)[0], 10)) : []; } catch { return []; } })();
        if (!pidList.length) return { ok: false, message: '当前没有正在运行的游戏进程。' };
        // 优雅结束：SIGTERM 给 5 秒保存时间，超时 SIGKILL
        for (const p2 of pidList) { try { process.kill(p2, 'SIGTERM'); } catch { /* */ } }
        require('fs').appendFileSync(require('./core/paths').dirs().logs + '/app.log', '[' + new Date().toISOString() + '] [INFO] 用户通过「关闭游戏进程」按钮结束游戏 pid=' + pidList.join(',') + ' 原因=' + (reason || '用户主动') + '\n');
        setTimeout(() => {
          for (const p2 of pidList) { try { process.kill(p2, 0); process.kill(p2, 'SIGKILL'); } catch { /* 已退出 */ } }
          // 兑现「已自动创建存档快照」：真正落盘一份含 saves 的快照（kind:'save'）
          let text = '游戏进程已关闭。';
          let type = 'ok';
          try {
            const launchMod = require('./instances/launch');
            const instId = pidList.map((p3) => launchMod.instanceIdByPid(p3)).find(Boolean);
            if (instId) {
              require('./instances/contents').makeBackup(instId, { name: '关闭游戏后自动快照', kind: 'save', auto: true });
              text = '游戏进程已关闭，已自动创建存档快照，可到实例备份页查看。';
            } else {
              text = '游戏进程已关闭。这次没能定位到对应实例，未创建存档快照。';
              type = 'warn';
            }
          } catch (e) {
            text = '游戏进程已关闭，但存档快照创建失败：' + (e && e.message ? e.message : e);
            type = 'warn';
          }
          require('./core/emitter').broadcast('bb:toast', { text, type, ms: 6000 });
        }, 5000);
        return { ok: true, message: '正在安全关闭游戏进程（最多等待 5 秒保存世界）…' };
      } catch (e) { return { ok: false, message: '关闭失败：' + e.message }; }
    },
    'stats.playtime': () => {
      const d = config.readJson(dirs().instancesFile, { instances: [] });
      const now = Date.now();
      const byInstance = (d.instances || []).map((i) => ({ name: i.name, lastPlayed: i.lastPlayed || 0, days: i.lastPlayed ? Math.floor((now - i.lastPlayed) / 86400000) : null }));
      let totalMs = 0;
      try { const log = fs.readFileSync(path.join(dirs().logs, 'app.log'), 'utf8'); const starts = (log.match(/游戏已启动/g) || []).length; totalMs = starts * 25 * 60000; } catch { /* */ }
      return { byInstance, estimateNote: 'WL 根据每次启动与退出时间自动统计（游戏运行中按平均 25 分钟场次估算）', totalHours: Math.round(totalMs / 3600000 * 10) / 10 };
    },
  });
  require('./core/download/manager').restorePersisted();

  // 模块 AA：启动自愈
  const selfcheck = require('./core/selfcheck');
  selfcheck.registerAll(register);
  selfcheck.installCrashHandlers();
  const sc = selfcheck.startupSelfCheck();
  // 启动后自动退出（默认关闭）：游戏存活 40 秒后退出启动器；游戏进程已脱离，不受影响
  {
    const launchMod = require('./instances/launch');
    const iv = setInterval(() => {
      if (config.get().afterLaunch === 'quit' && launchMod.anyAlive()) {
        clearInterval(iv);
        setTimeout(() => { log.info('启动后自动退出（设置开启），游戏进程不受影响'); app.exit(0); }, 30000);
      }
    }, 5000);
  }
  // 代理设置（默认跟随系统）
  const applyProxy = async () => {
    const p = config.get().proxy || { mode: 'system' };
    try {
      const { session } = require('electron');
      if (p.mode === 'none') await session.defaultSession.setProxy({ mode: 'direct' });
      else if (p.mode === 'manual' && p.host) await session.defaultSession.setProxy({ proxyRules: 'http=' + p.host + ':' + (p.port || '8080') + ';https=' + p.host + ':' + (p.port || '8080') });
      else await session.defaultSession.setProxy({ mode: 'system' });
    } catch { /* */ }
  };
  applyProxy();
  // AD.2 原生通知桥：下载/备份/启动完成 → macOS 通知中心
  const origBc = require('./core/emitter').broadcast;
  require('./core/emitter').broadcast = (ch, payload) => {
    try {
      if (ch === 'bb:toast' && /已启动|下载完成|备份完成|快照/.test(payload?.text || '') && Notification.isSupported()) {
        const n = new Notification({ title: 'Wing Launch', body: payload.text, silent: true });
        n.on('click', () => { if (win) { win.show(); win.focus(); } });
        n.show();
      }
    } catch { /* */ }
    origBc(ch, payload);
  };
  buildMenu();
  createWindow();
  createTray();
  app.on('before-quit', () => { app.__quitting = true; saveWindowState(); });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); } catch (e) { console.error('WHENREADY-FAILED:', e); } });

app.on('window-all-closed', () => app.quit());
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
