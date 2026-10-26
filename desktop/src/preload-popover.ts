// Built to build/preload-popover.cjs. Exposes the minimal IPC surface the
// popover UI needs — no Node access in the renderer.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('fluzyai', {
  snapshot: () => ipcRenderer.invoke('fluzyai:snapshot'),
  openDashboard: () => ipcRenderer.invoke('fluzyai:open-dashboard'),
  copyBaseUrl: () => ipcRenderer.invoke('fluzyai:copy-base-url'),
  copyApiKey: () => ipcRenderer.invoke('fluzyai:copy-api-key'),
  setLoginItem: (open: boolean) => ipcRenderer.invoke('fluzyai:set-login-item', open),
  quit: () => ipcRenderer.invoke('fluzyai:quit'),
  onRefresh: (cb: () => void) => ipcRenderer.on('fluzyai:refresh', cb),
});
