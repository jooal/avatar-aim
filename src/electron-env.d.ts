/// <reference types="vite/client" />

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

interface ElectronAPI {
  openHangoutWindow: (conversationId: string, participants: unknown[]) => void;
  closeHangoutWindow: () => void;
  updateAvatarPosition: (x: number, y: number) => void;
  setIgnoreMouseEvents: (ignore: boolean) => void;
  onHangoutUpdate: (callback: (data: unknown) => void) => void;
  onAvatarPositionUpdate: (callback: (data: unknown) => void) => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
