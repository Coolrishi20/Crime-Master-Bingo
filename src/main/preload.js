'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const listeners = {};
contextBridge.exposeInMainWorld('cmb', {
  invoke: (channel, payload) => ipcRenderer.invoke('invoke', channel, payload),
  on: (channel, fn) => {
    const wrapped = (e, data) => fn(data);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  send: (channel, data) => ipcRenderer.send(channel, data),
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch (e) { return file && file.path; } }
});
