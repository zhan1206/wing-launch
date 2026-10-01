// IPC 网关：所有渲染层调用统一走 'bb:invoke'，由各模块 register 路由
const { ipcMain } = require('electron');
const log = require('./log');

const routes = new Map();
function register(map) { for (const [k, fn] of Object.entries(map)) routes.set(k, fn); }

function install() {
  ipcMain.handle('bb:invoke', async (_e, { ch, payload }) => {
    const fn = routes.get(ch);
    if (!fn) return { __unimplemented: true };
    try {
      return { __ok: true, v: await fn(payload || {}) };
    } catch (err) {
      log.error(`IPC ${ch}:`, err.userMessage || err.stack || String(err));
      return { __err: err.userMessage || err.message || String(err), __category: err.category || null, __fixes: err.fixes || null };
    }
  });
}

class UserError extends Error {
  constructor(msg) { super(msg); this.userMessage = msg; }
}

module.exports = { register, install, UserError, routes };
