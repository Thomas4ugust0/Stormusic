const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('stormusicDesktop', {
  setCompact: (compact) => ipcRenderer.invoke('stormusic:set-compact', compact),
})
