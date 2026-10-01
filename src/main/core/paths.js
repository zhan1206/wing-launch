const path = require('path');
const fs = require('fs');


function ensure(dir) { fs.mkdirSync(dir, { recursive: true }); }

let electronApp = null;
try { electronApp = require('electron').app || null; } catch { electronApp = null; }
const userData = () => {
  if (process.env.BLOCKBOX_DATA_DIR) return process.env.BLOCKBOX_DATA_DIR;
  if (electronApp) return electronApp.getPath('userData');
  return path.join(require('os').homedir(), '.blockbox-core'); // 无 UI 环境（CLI/测试）
};
let C = null;
function dirs() {
  if (C) return C;
  const root = userData();
  C = {
    root,
    instances: path.join(root, 'instances'),
    versions: path.join(root, 'versions'),
    libraries: path.join(root, 'libraries'),
    assets: path.join(root, 'assets'),
    assetsIndexes: path.join(root, 'assets', 'indexes'),
    objects: path.join(root, 'assets', 'objects'),
    skins: path.join(root, 'skins'),
    java: path.join(root, 'java'),
    servers: path.join(root, 'servers'),
    meta: path.join(root, 'meta'),
    trash: path.join(root, '回收站'),
    logs: path.join(root, 'logs'),
    partial: path.join(root, 'downloads-partial'),
    settingsFile: path.join(root, 'settings.json'),
    accountsFile: path.join(root, 'accounts.json'),
    instancesFile: path.join(root, 'instances.json'),
    serversFile: path.join(root, 'servers.json'),
    downloadsFile: path.join(root, 'downloads-state.json'),
  };
  for (const k of ['instances', 'versions', 'libraries', 'assets', 'assetsIndexes', 'objects', 'skins', 'java', 'servers', 'meta', 'trash', 'logs', 'partial']) ensure(C[k]);
  return C;
}
function instanceDir(id) { return path.join(dirs().instances, id); }
function serverDir(id) { return path.join(dirs().servers, id); }

module.exports = { dirs, ensure, instanceDir, serverDir };
