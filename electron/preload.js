/**
 * preload.js — LiangLLM Electron Preload Script
 *
 * Exposes safe, limited APIs from Electron main process to the renderer.
 * Uses contextBridge to avoid exposing Node.js directly.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('liangllm', {
  // Backend information
  getBackendUrl: () => ipcRenderer.invoke('get-backend-url'),
  getBackendStatus: () => ipcRenderer.invoke('get-backend-status'),
  restartBackend: () => ipcRenderer.invoke('restart-backend'),

  // Listen for backend events
  onBackendLog: (callback) => {
    ipcRenderer.on('backend-log', (event, msg) => callback(msg));
  },
  onBackendStatus: (callback) => {
    ipcRenderer.on('backend-status', (event, status) => callback(status));
  },

  // Platform info
  platform: process.platform,
  arch: process.arch,
});
