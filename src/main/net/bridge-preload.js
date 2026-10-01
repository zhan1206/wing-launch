const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('bridge', {
  on: (ch, cb) => ipcRenderer.on(ch, (_e, payload) => cb(payload)),
  send: (payload) => ipcRenderer.send('bridge:event', payload),
});
