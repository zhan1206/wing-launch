// 增强：更新检查 / 数据管理（导出导入、重置）/ 代理测试 / 离线模式
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { dirs } = require('./paths');
const { UserError } = require('./ipc-gateway');
const { broadcast, toast } = require('./emitter');
const sources = require('./download/sources');
const trash = require('./trash');
const shell = require('electron').shell;

function registerAll(register) {
  register({
    // ---------- 更新检查（有更新源才可用；不强制更新） ----------
    'update.check': async () => {
      const s = config.get();
      const url = s.update?.url;
      if (!url) {
        return { available: false, unconfigured: true, currentVersion: require('electron').app.getVersion(), message: '还没有配置更新源。当前版本 v' + require('electron').app.getVersion() + ' 就是发布版本。' };
      }
      try {
        const j = await sources.fetchJson(url, { timeout: 10000 });
        const latest = String(j.version || '');
        const current = require('electron').app.getVersion();
        const available = latest && latest !== current && latest !== s.update?.skipVersion;
        return { available, currentVersion: current, latestVersion: latest, notes: String(j.notes || '（暂无更新说明）'), downloadUrl: j.url || null, skipped: latest === s.update?.skipVersion };
      } catch {
        return { available: false, error: true, message: '无法获取更新信息：暂时连不上更新服务器。当前版本仍可正常使用。', currentVersion: require('electron').app.getVersion() };
      }
    },
    'update.skip': ({ version }) => { config.set({ update: { skipVersion: version } }); return true; },
    'update.openPage': ({ url }) => { shell.openExternal(url); return true; },

    // ---------- 代理测试 ----------
    'proxy.test': async () => {
      const t0 = Date.now();
      try {
        await sources.fetchText('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json', { timeout: 10000 });
        return { ok: true, ms: Date.now() - t0, message: '连接成功（' + (Date.now() - t0) + ' 毫秒）。' };
      } catch (e) {
        return { ok: false, message: '连接失败：' + (e.userMessage || e.message) + '。请检查代理地址或网络。' };
      }
    },

    // ---------- 数据管理 ----------
    'data.export': async () => {
      const s = config.get();
      const accountsRaw = config.readJson(dirs().accountsFile, { accounts: [] });
      // 敏感凭据默认不导出：令牌本来就在系统钥匙串，导出文件中再明确剔除
      const data = {
        format: 'blockbox-config', version: 1, exportedAt: new Date().toISOString(),
        settings: { ...s, translate: { ...s.translate, apiKey: '' } },
        accounts: (accountsRaw.accounts || []).map((a) => ({ id: a.id, type: a.type, name: a.name, displayName: a.displayName, serverName: a.serverName })),
        note: '此文件不含密码、令牌与 API Key。令牌保存在本机系统钥匙串，不会随文件导出。',
      };
      return data;
    },
    'data.save': ({ path: p, text }) => {
      if (!p) throw new UserError('没有选择保存位置。');
      const hasExt = /\.[A-Za-z0-9]+$/.test(p);
      const out = hasExt ? p : p + '.json';
      fs.writeFileSync(out, String(text ?? ''), 'utf8');
      return { path: out };
    },
    'data.import': ({ data }) => {
      if (data?.format !== 'blockbox-config') throw new UserError('这个文件不是本启动器导出的配置文件。');
      const patch = data.settings || {};
      delete patch.theme?.background; // 背景图可能来自旧机器路径，避免引用失效
      config.set(patch);
      broadcast('bb:settings-changed', config.get());
      if (Array.isArray(data.accounts) && data.accounts.length) {
        const cur = config.readJson(dirs().accountsFile, { accounts: [], currentId: null });
        for (const a of data.accounts) {
          if (!cur.accounts.find((x) => x.id === a.id && x.type === a.type)) cur.accounts.push({ ...a, note: a.note || '（从配置导入：需要重新登录）' });
        }
        config.writeJson(dirs().accountsFile, cur);
        broadcast('bb:accounts-changed', {});
      }
      return { message: '配置已导入。注意：导入的账户只保留昵称等信息，需要重新登录。' };
    },

    // ---------- 分级重置 ----------
    'data.reset': async ({ level }) => {
      if (level === 'ui') {
        const s = config.get();
        config.set({ ...config.DEFAULTS, wizardDone: true });
        broadcast('bb:settings-changed', config.get());
        return { message: '已恢复所有设置为默认值（账户、实例、下载内容都不受影响）。' };
      }
      if (level === 'cache') {
        for (const dir of [dirs().objects, dirs().partial, dirs().logs]) {
          try { fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true }); } catch { /* */ }
        }
        toast('缓存已清理。已下载的游戏库会在下次启动时按需重新下载。', 'ok', 5000);
        return { message: '已清理缓存（资源文件与日志）。实例、存档、账户都完好。' };
      }
      if (level === 'instances') {
        const d = config.readJson(dirs().instancesFile, { instances: [] });
        for (const inst of d.instances || []) {
          try { trash.deleteToTrash(inst.dir, '实例'); } catch { /* */ }
        }
        config.writeJson(dirs().instancesFile, { instances: [] });
        broadcast('bb:instances-changed', []);
        return { message: '全部实例已移入回收站（可在资源管理器恢复）。' };
      }
      if (level === 'all') {
        // 全部：ui + cache + instances + accounts + skins
        for (const dir of [dirs().objects, dirs().partial]) {
          try { fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true }); } catch { /* */ }
        }
        const instData = config.readJson(dirs().instancesFile, { instances: [] });
        for (const inst of instData.instances || []) { try { trash.deleteToTrash(inst.dir, '实例'); } catch { /* */ } }
        config.writeJson(dirs().instancesFile, { instances: [] });
        try { fs.renameSync(dirs().accountsFile, dirs().accountsFile + '.bak-' + Date.now()); } catch { /* */ }
        try { fs.rmSync(dirs().skins, { recursive: true, force: true }); fs.mkdirSync(dirs().skins, { recursive: true }); } catch { /* */ }
        config.set({ ...config.DEFAULTS, wizardDone: false });
        broadcast('bb:settings-changed', config.get());
        return { message: '启动器已重置。账户、实例已备份到回收站/备份文件，皮肤库已清空。' };
      }
      throw new UserError('未知的重置级别。');
    },
  });
}
module.exports = { registerAll };
