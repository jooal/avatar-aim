import { app, BrowserWindow, ipcMain, screen } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let hangoutWindow: BrowserWindow | null = null;

const createWindow = () => {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  // Open the DevTools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }
};

const createHangoutWindow = (conversationId: string, participants: unknown[]) => {
  // Close existing hangout window if any
  if (hangoutWindow && !hangoutWindow.isDestroyed()) {
    hangoutWindow.close();
  }

  // Get primary display dimensions
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  // Create transparent overlay window
  hangoutWindow = new BrowserWindow({
    width: width,
    height: height,
    x: 0,
    y: 0,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Make the window click-through by default, but avatars will capture clicks
  hangoutWindow.setIgnoreMouseEvents(true, { forward: true });

  // Load the hangout overlay page
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    hangoutWindow.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}#/hangout`);
  } else {
    hangoutWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
      { hash: '/hangout' }
    );
  }

  // Send initial data to hangout window once loaded
  hangoutWindow.webContents.once('did-finish-load', () => {
    hangoutWindow?.webContents.send('hangout-update', {
      conversationId,
      participants
    });
  });

  hangoutWindow.on('closed', () => {
    hangoutWindow = null;
  });
};

// IPC Handlers
ipcMain.on('open-hangout-window', (_event, { conversationId, participants }) => {
  createHangoutWindow(conversationId, participants);
});

ipcMain.on('close-hangout-window', () => {
  if (hangoutWindow && !hangoutWindow.isDestroyed()) {
    hangoutWindow.close();
    hangoutWindow = null;
  }
});

ipcMain.on('update-avatar-position', (_event, { x, y }) => {
  // Forward position update to main window for syncing
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('avatar-position-update', { x, y });
  }
});

// Handle mouse events for the hangout window
ipcMain.on('set-ignore-mouse-events', (_event, ignore: boolean) => {
  if (hangoutWindow && !hangoutWindow.isDestroyed()) {
    hangoutWindow.setIgnoreMouseEvents(ignore, { forward: true });
  }
});

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', createWindow);

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
