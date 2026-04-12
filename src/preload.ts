// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  openChatWindow: (conversationId: string, conversationName: string) => {
    console.log('preload: openChatWindow called', conversationId, conversationName);
    ipcRenderer.send('open-chat-window', { conversationId, conversationName });
  },
  isChatWindowOpen: (conversationId: string): Promise<boolean> => {
    return ipcRenderer.invoke('is-chat-window-open', conversationId);
  },
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
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on('hangout-update', handler);
    return () => { ipcRenderer.removeListener('hangout-update', handler); };
  },
  onAvatarPositionUpdate: (callback: (data: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on('avatar-position-update', handler);
    return () => { ipcRenderer.removeListener('avatar-position-update', handler); };
  },
  onBeforeQuit: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('before-quit', handler);
    return () => { ipcRenderer.removeListener('before-quit', handler); };
  },
  signoffComplete: () => {
    ipcRenderer.send('signoff-complete');
  },
});
