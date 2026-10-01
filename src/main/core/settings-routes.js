// 设置与主题路由（模块1 的主进程部分）
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { dirs } = require('./paths');
const { broadcast, toast } = require('./emitter');
const { UserError } = require('./ipc-gateway');
const secrets = require('./secrets');

const PRESETS = [
  { id: 'builtin-default', name: '赛博蓝', mode: 'dark', color: '#4f8cff', blur: 6, dim: 0.45 },
  { id: 'builtin-white', name: '简约白', mode: 'light', color: '#3d7dff', blur: 0, dim: 0.2 },
  { id: 'builtin-black', name: '深空黑', mode: 'dark', color: '#8b5cf6', blur: 4, dim: 0.6 },
  { id: 'builtin-jade', name: '翡翠绿', mode: 'dark', color: '#2bb673', blur: 4, dim: 0.5 },
  { id: 'builtin-sakura', name: '樱花粉', mode: 'light', color: '#ff7fa4', blur: 3, dim: 0.3 },
  { id: 'builtin-amber', name: '琥珀暖', mode: 'light', color: '#e8961e', blur: 3, dim: 0.3 },
];

function registerAll(register) {
  register({
    'settings.get': () => {
      const s = config.get();
      const masked = { ...s, translate: { ...s.translate, apiKey: secrets.get('translate:apikey') ? '********' : '' } };
      return masked;
    },
    'settings.set': (patch) => {
      if (patch?.translate?.apiKey && patch.translate.apiKey !== '********') {
        secrets.set('translate:apikey', patch.translate.apiKey);
        patch = { ...patch, translate: { ...patch.translate, apiKey: '********' } };
      }
      const s = config.set(patch);
      broadcast('bb:settings-changed', s);
      return s;
    },
    'settings.autoMemory': () => config.autoMemoryMB(),

    'theme.presets': () => PRESETS,
    'theme.importFile': (pp) => { const p = typeof pp === 'string' ? { p: pp } : pp;
      let raw;
      try { raw = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {
        return { ok: false, severity: 'broken', message: '这个主题文件看起来不完整，可能来自其他版本的启动器。你仍然可以尝试导入基础配色。' };
      }
      const t = raw.theme || raw;
      if (!t || typeof t !== 'object' || !t.color) {
        return { ok: false, severity: 'broken', message: '这个主题文件看起来不完整，可能来自其他版本的启动器。你仍然可以尝试导入基础配色。' };
      }
      const clean = {
        name: String(t.name || '导入的主题').slice(0, 30),
        mode: t.mode === 'light' ? 'light' : 'dark',
        color: /^#[0-9a-fA-F]{6}$/.test(t.color) ? t.color : '#4f8cff',
        blur: Math.max(0, Math.min(30, Number(t.blur) || 0)),
        dim: Math.max(0, Math.min(1, Number(t.dim) || 0)),
      };
      const partial = !raw.format || raw.format !== 'mctheme';
      return { ok: true, theme: clean, partial, message: partial ? '这个主题文件带有一些额外信息，已按基础配色导入。' : '' };
    },
    'theme.exportTo': (pp) => { const p = typeof pp === 'string' ? { p: pp } : pp;
      const s = config.get();
      const data = { format: 'mctheme', version: 1, theme: { name: s.currentThemeName || '我的主题', ...s.theme } };
      let file = p.endsWith('.mctheme') ? p : p + '.mctheme';
      fs.writeFileSync(file, JSON.stringify(data, null, 2));
      return { path: file };
    },
    'theme.processBackground': async (pp) => { const p = typeof pp === 'string' ? { p: pp } : pp;
      const stat = fs.statSync(p);
      if (!/\.(png|jpe?g|webp|gif|bmp)$/i.test(p)) throw new UserError('请选择一张图片文件（PNG / JPG / WebP）。');
      let finalPath = p;
      try {
        if (stat.size > 20 * 1024 * 1024) {
          const Jimp = (await import('jimp')).Jimp;
          const img = await Jimp.read(p);
          if (img.bitmap.width > 2560) img.resize({ w: 2560 });
          const out = path.join(dirs().root, '背景图-已压缩.jpg');
          await img.quality(80).write(out);
          finalPath = out;
        } else if (stat.size > 6 * 1024 * 1024) {
          const Jimp = (await import('jimp')).Jimp;
          const img = await Jimp.read(p);
          if (img.bitmap.width > 2560) img.resize({ w: 2560 });
          const out = path.join(dirs().root, '背景图-已压缩.jpg');
          await img.quality(85).write(out);
          finalPath = out;
        }
      } catch (e) {
        throw new UserError('这张图片无法读取，可能已损坏。换一张试试吧。');
      }
      return { path: finalPath };
    },
  });
}
module.exports = { registerAll, PRESETS };
