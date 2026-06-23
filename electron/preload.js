/**
 * preload.js — LiangLLM Electron Preload Script
 *
 * Exposes safe, limited APIs from Electron main process to the renderer.
 * Uses contextBridge to avoid exposing Node.js directly.
 */

const { contextBridge, ipcRenderer, dialog } = require('electron');

contextBridge.exposeInMainWorld('liangllm', {
  getBackendUrl: () => ipcRenderer.invoke('get-backend-url'),
  getBackendStatus: () => ipcRenderer.invoke('get-backend-status'),
  restartBackend: () => ipcRenderer.invoke('restart-backend'),

  onBackendLog: (callback) => {
    ipcRenderer.on('backend-log', (event, msg) => callback(msg));
  },
  onBackendStatus: (callback) => {
    ipcRenderer.on('backend-status', (event, status) => callback(status));
  },

  selectFolder: (opts) => ipcRenderer.invoke('select-folder', opts || {}),
  selectFile: (opts) => ipcRenderer.invoke('select-file', opts || {}),

  platform: process.platform,
  arch: process.arch,
});
