const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  platform: process.platform,
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (obj) => ipcRenderer.invoke('config:set', obj),
  offlineList: () => ipcRenderer.invoke('offline:list'),
  offlineSave: (payload) => ipcRenderer.invoke('offline:save', payload),
  offlineRemove: (id) => ipcRenderer.invoke('offline:remove', id),
  offlineClear: () => ipcRenderer.invoke('offline:clear'),
  dislikesGet: () => ipcRenderer.invoke('dislikes:get'),
  dislikesSet: (list) => ipcRenderer.invoke('dislikes:set', list),
  dislikesPath: () => ipcRenderer.invoke('dislikes:path'),
  dislikesReveal: () => ipcRenderer.invoke('dislikes:reveal'),
  coverGet: (payload) => ipcRenderer.invoke('cover:get', payload),
  coverStats: () => ipcRenderer.invoke('cover:stats'),
  coverClear: () => ipcRenderer.invoke('cover:clear'),
  toggleFullscreen: () => ipcRenderer.invoke('win:toggleFullscreen'),
  minimize: () => ipcRenderer.invoke('win:minimize'),
  maximizeToggle: () => ipcRenderer.invoke('win:maximizeToggle'),
  closeWindow: () => ipcRenderer.invoke('win:close'),
  isMaximized: () => ipcRenderer.invoke('win:isMaximized'),
  // мини-плеер
  setMini: (on, size) => ipcRenderer.invoke('win:mini', { on, ...(size || {}) }),
  isMini: () => ipcRenderer.invoke('win:isMini'),
  setAlwaysOnTop: (on) => ipcRenderer.invoke('win:setAlwaysOnTop', on),
  isAlwaysOnTop: () => ipcRenderer.invoke('win:isAlwaysOnTop'),
  resizeWindow: (width, height) => ipcRenderer.invoke('win:resize', { width, height }),
  // масштаб интерфейса — родной зум Chromium
  setZoom: (factor) => {
    const z = Math.min(1.6, Math.max(0.7, Number(factor) || 1));
    webFrame.setZoomFactor(z);
    return z;
  },
  getZoom: () => webFrame.getZoomFactor(),
  // приняла ли система кнопки на превью в панели задач
  taskbarStatus: () => ipcRenderer.invoke('win:taskbarStatus'),
  onWindowState: (cb) => {
    const h = (_e, state) => cb(state);
    ipcRenderer.on('win:state', h);
    return () => ipcRenderer.removeListener('win:state', h);
  },
  // состояние плеера для кнопок на панели задач / трея / MPRIS
  sendPlayerState: (state) => ipcRenderer.send('player:state', state),
  onMediaKey: (cb) => {
    const h = (_e, action) => cb(action);
    ipcRenderer.on('media-key', h);
    return () => ipcRenderer.removeListener('media-key', h);
  },
});
