// Bridge between the AcrobatDesk page and the desktop shell. Exposes only file dialogs,
// writing files the user chose, and menu commands — no general file system or Node access.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApi', {
  isDesktop: true,
  platform: process.platform,
  openPdf: () => ipcRenderer.invoke('desktop:open-pdf'),
  takePendingFiles: () => ipcRenderer.invoke('desktop:take-pending-files'),
  writeFile: (filePath, bytes) => ipcRenderer.invoke('desktop:write-file', filePath, bytes),
  saveDialog: (suggestedName, kind, bytes) => ipcRenderer.invoke('desktop:save-dialog', suggestedName, kind, bytes),
  saveToFolder: (files) => ipcRenderer.invoke('desktop:save-to-folder', files),
  setDocumentState: (state) => ipcRenderer.send('desktop:document-state', state),
  onOpenFile: (callback) => {
    const listener = (_e, file) => callback(file);
    ipcRenderer.on('desktop:open-file', listener);
    return () => ipcRenderer.removeListener('desktop:open-file', listener);
  },
  onMenu: (callback) => {
    const listener = (_e, command) => callback(command);
    ipcRenderer.on('desktop:menu', listener);
    return () => ipcRenderer.removeListener('desktop:menu', listener);
  }
});
