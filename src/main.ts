import { app, BrowserWindow, ipcMain, screen } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let hangoutWindow: BrowserWindow | null = null;
let currentHangoutData: { conversationId: string; participants: unknown[] } | null = null;

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
  // Store the hangout data for later retrieval
  currentHangoutData = { conversationId, participants };

  // If window already exists, just send updated data instead of recreating
  if (hangoutWindow && !hangoutWindow.isDestroyed()) {
    console.log('[Main] Hangout window exists, sending update only');
    hangoutWindow.webContents.send('hangout-update', { conversationId, participants });
    return;
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

  // Make the window click-through by default
  // The renderer will toggle this when hovering over interactive elements
  hangoutWindow.setIgnoreMouseEvents(true);

  // Load the hangout overlay page
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    hangoutWindow.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}?hangout=true`);
  } else {
    hangoutWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
      { query: { hangout: 'true' } }
    );
  }

  // Send initial data to hangout window once loaded
  hangoutWindow.webContents.once('did-finish-load', () => {
    console.log('[Main] Hangout window loaded, sending update:', { conversationId, participants });
    hangoutWindow?.webContents.send('hangout-update', {
      conversationId,
      participants
    });

    // Open devtools in development
    if (process.env.NODE_ENV === 'development') {
      hangoutWindow?.webContents.openDevTools({ mode: 'detach' });
    }
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
    if (ignore) {
      hangoutWindow.setIgnoreMouseEvents(true);
    } else {
      // When not ignoring, we need forward:true to detect when mouse leaves
      hangoutWindow.setIgnoreMouseEvents(false);
    }
  }
});

// Handle request for hangout data from overlay
ipcMain.on('request-hangout-data', () => {
  console.log('[Main] Hangout data requested, sending:', currentHangoutData);
  if (hangoutWindow && !hangoutWindow.isDestroyed() && currentHangoutData) {
    hangoutWindow.webContents.send('hangout-update', currentHangoutData);
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
