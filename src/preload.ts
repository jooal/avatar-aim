// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  openHangoutWindow: (conversationId: string, participants: unknown[]) => {
    ipcRenderer.send('open-hangout-window', { conversationId, participants });
  },
  closeHangoutWindow: () => {
    ipcRenderer.send('close-hangout-window');
  },
  updateAvatarPosition: (x: number, y: number) => {
    ipcRenderer.send('update-avatar-position', { x, y });
  },
  setIgnoreMouseEvents: (ignore: boolean) => {
    ipcRenderer.send('set-ignore-mouse-events', ignore);
  },
  onHangoutUpdate: (callback: (data: unknown) => void) => {
    ipcRenderer.on('hangout-update', (_event, data) => callback(data));
  },
  onAvatarPositionUpdate: (callback: (data: unknown) => void) => {
    ipcRenderer.on('avatar-position-update', (_event, data) => callback(data));
  },
  requestHangoutData: () => {
    ipcRenderer.send('request-hangout-data');
  }
});
