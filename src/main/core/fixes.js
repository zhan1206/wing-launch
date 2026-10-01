// 通用"怎么解决"修复动作路由：崩溃报告、启动失败、诊断共用
const { UserError } = require('./ipc-gateway');
const { dirs, instanceDir } = require('./paths');
const config = require('./config');
const { broadcast } = require('./emitter');
const javaMgr = require('../java/java-manager');
const shell = require('electron').shell;

async function applyFix(instanceId, fix) {
  fix = fix || {};
  switch (fix.type) {
    case 'setMemory': {
      const d = config.readJson(dirs().instancesFile, { instances: [] });
      const inst = d.instances.find((x) => x.id === instanceId);
      if (inst) {
        inst.settings = { ...inst.settings, memory: fix.value };
        config.writeJson(dirs().instancesFile, d);
        return `已把内存调高到 ${fix.value >= 1024 ? (fix.value / 1024) + 'GB' : fix.value + 'MB'}，重新启动游戏即可生效。`;
      }
      throw new UserError('找不到这个实例。');
    }
    case 'downloadJava': {
      const j = await javaMgr.ensure(fix.major);
      return `Java ${fix.major} 已就绪（${j.source === 'system' ? '使用系统已有的' : '自动下载安装的'}），可以重新启动游戏了。`;
    }
    case 'openMods': broadcast('bb:goto', `/instances/${instanceId}/mods`); return '已打开模组页面。';
    case 'openInstanceSettings': broadcast('bb:goto', `/instances/${instanceId}`); return '已打开实例页面。';
    case 'openJavaSettings': broadcast('bb:goto', '/settings/java'); return '已打开 Java 管理页面。';
    case 'openAccounts': broadcast('bb:goto', '/accounts'); return '已打开账户页面。';
    case 'openDownloads': broadcast('bb:goto', '/downloads'); return '已打开下载中心。';
    case 'openHelp': broadcast('bb:goto', '/help' + (fix.topic ? '/' + fix.topic : '')); return '已打开帮助中心。';
    case 'openFolder': shell.openPath(instanceDir(instanceId)); return '已打开实例文件夹。';
    case 'openSettings': broadcast('bb:goto', '/settings'); return '已打开设置页面。';
    case 'openDiskSettings': broadcast('bb:goto', '/resources'); return '已打开资源管理器，可以在这里清理不需要的文件。';
    case 'disableMods': {
      // 禁用指定的可疑模组（可撤销：只是重命名）
      const files = fix.files || [];
      const modsDir = instanceDir(instanceId) + '/mods';
      const fs = require('fs');
      let n = 0;
      for (const f of files) {
        const src = modsDir + '/' + f;
        if (fs.existsSync(src) && !f.endsWith('.disabled')) { fs.renameSync(src, src + '.disabled'); n++; }
      }
      broadcast('bb:instances-changed', {});
      return `已禁用 ${n} 个可疑模组（可在模组页随时重新打开），重新启动游戏试试。`;
    }
    case 'openSystemSettings': shell.openExternal('x-apple.systempreferences:com.apple.preference.security'); return '已为你打开系统设置。';
    default:
      throw new UserError('这个修复暂时不能一键执行，请按提示中的说明处理。');
  }
}
function registerAll(register) {
  register({
    'fixes.apply': async ({ instanceId, fix }) => ({ message: await applyFix(instanceId, fix) }),
  });
}
module.exports = { registerAll, applyFix };
