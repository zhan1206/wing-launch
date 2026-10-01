// 广播事件到渲染进程
const { BrowserWindow } = require('electron');
function broadcast(channel, payload) {
  if (!BrowserWindow?.getAllWindows) return; // 无 UI 环境（CLI/核心测试）下跳过广播
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
  }
}
function toast(text, type = 'info', ms = 3000) { broadcast('bb:toast', { text, type, ms }); }
module.exports = { broadcast, toast };
