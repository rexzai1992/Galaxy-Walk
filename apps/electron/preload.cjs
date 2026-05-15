const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('moonwalkRuntime', {
  isElectron: true,
})
