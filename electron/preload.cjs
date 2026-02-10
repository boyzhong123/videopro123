const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isDesktop: true,
  saveVideoFile: (arrayBuffer, defaultName) => {
    const buf = Buffer.from(arrayBuffer);
    return ipcRenderer.invoke('save-video-file', buf, defaultName);
  },
  exportVideoAsMp4: (webmArrayBuffer, durationSeconds, defaultName) => {
    const buf = Buffer.from(webmArrayBuffer);
    return ipcRenderer.invoke('export-video-as-mp4', buf, durationSeconds, defaultName);
  },
  onExportMp4Progress: (callback) => {
    const handler = (_event, percent) => callback(percent);
    ipcRenderer.on('export-mp4-progress', handler);
    return () => ipcRenderer.removeListener('export-mp4-progress', handler);
  },
  showNotification: (title, body) => ipcRenderer.invoke('show-notification', title, body),
  batchSaveVideos: (videos) => {
    // videos: Array<{arrayBuffer: ArrayBuffer, filename: string}>
    const prepared = videos.map(v => ({
      buffer: Buffer.from(v.arrayBuffer),
      filename: v.filename,
    }));
    return ipcRenderer.invoke('batch-save-videos', prepared);
  },
  batchExportMp4: (videos) => {
    // videos: Array<{arrayBuffer: ArrayBuffer, filename: string, duration: number}>
    const prepared = videos.map(v => ({
      buffer: Buffer.from(v.arrayBuffer),
      filename: v.filename,
      duration: v.duration,
    }));
    return ipcRenderer.invoke('batch-export-mp4', prepared);
  },
  onBatchMp4Progress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('batch-mp4-progress', handler);
    return () => ipcRenderer.removeListener('batch-mp4-progress', handler);
  },
});
