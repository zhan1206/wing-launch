const { contextBridge, ipcRenderer, webUtils } = require('electron');

const listeners = new Map();

contextBridge.exposeInMainWorld('bb', {
  // 语义化网关：bb.settings.get({...}) → invoke('settings.get')
  make: (ch) => (payload) => ipcRenderer.invoke('bb:invoke', { ch, payload }),
  raw: {
    invoke: (ch, payload) => ipcRenderer.invoke('bb:invoke', { ch, payload }),
    on: (channel, cb) => {
      const wrapped = (_e, data) => cb(data);
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel).add(wrapped);
      ipcRenderer.on(channel, wrapped);
      return () => {
        const set = listeners.get(channel);
        if (set) { set.delete(wrapped); if (!set.size) listeners.delete(channel); }
        ipcRenderer.removeListener(channel, wrapped);
      };
    },
    // 拖拽文件 → 真实路径（Electron 32+ 需要 webUtils）
    pathForFile: (file) => webUtils.getPathForFile(file),
  },
});
