// 渲染层 API 封装：所有页面通过这里访问主进程
const raw = window.bb.raw;
export const on = raw.on;
export const pathForFile = raw.pathForFile;

async function call(ch, payload) {
  const res = await raw.invoke(ch, payload);
  if (res && res.__unimplemented) {
    throw new Error('该功能的后台正在接通中，稍后再试');
  }
  if (res && res.__err) {
    const err = new Error(res.__err);
    if (res.__category) err.category = res.__category;
    if (res.__fixes) err.fixes = res.__fixes;
    throw err;
  }
  return res ? res.v : undefined;
}

// api.settings.get → call('settings.get')
export const bare = (ch) => (payload) => call(ch, payload);

export const api = new Proxy({}, {
  get: (_t, nsName) => new Proxy({}, {
    get: (_t2, method) => (...args) => call(`${String(nsName)}.${String(method)}`, args.length > 1 ? { __pos: args } : args[0]),
  }),
});

export async function tryCall(fn, fallback = null) {
  try { return await fn(); } catch (e) { console.warn('[api]', e); return fallback; }
}
