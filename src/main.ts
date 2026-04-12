import { app, BrowserWindow, ipcMain, screen, shell } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let hangoutWindow: BrowserWindow | null = null;
const chatWindows: Map<string, BrowserWindow> = new Map();

const createWindow = () => {
  // Create the buddy list window (smaller, like classic AIM)
  mainWindow = new BrowserWindow({
    width: 280,
    height: 500,
    minWidth: 250,
    minHeight: 400,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
    title: 'Buddy List',
    backgroundColor: '#ECE9D8',
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

const createChatWindow = (conversationId: string, conversationName: string) => {
  // Check if window already exists for this conversation
  const existingWindow = chatWindows.get(conversationId);
  if (existingWindow && !existingWindow.isDestroyed()) {
    existingWindow.focus();
    return;
  }

  // Create a new chat window - show immediately for faster perceived performance
  const chatWindow = new BrowserWindow({
    width: 500,
    height: 450,
    minWidth: 350,
    minHeight: 300,
    show: true, // Show immediately
    backgroundColor: '#ECE9D8', // Windows XP gray
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
    title: `Instant Message with ${conversationName || 'Chat'}`,
  });

  chatWindows.set(conversationId, chatWindow);

  // Load the chat window URL
  const url = MAIN_WINDOW_VITE_DEV_SERVER_URL
    ? `${MAIN_WINDOW_VITE_DEV_SERVER_URL}#/chat/${conversationId}`
    : null;

  if (url) {
    chatWindow.loadURL(url);
  } else {
    chatWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
      { hash: `/chat/${conversationId}` }
    );
  }

  chatWindow.on('closed', () => {
    chatWindows.delete(conversationId);
  });
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
ipcMain.on('open-chat-window', (_event, { conversationId, conversationName }) => {
  console.log('main: open-chat-window received', conversationId, conversationName);
  createChatWindow(conversationId, conversationName);
});

ipcMain.handle('is-chat-window-open', (_event, conversationId: string) => {
  const win = chatWindows.get(conversationId);
  return !!(win && !win.isDestroyed());
});

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
// Open external links in the system browser
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  contents.on('will-navigate', (event, url) => {
    // Allow hash navigation for internal routing
    if (url.includes('#/chat/') || url.includes('#/hangout')) return;
    if (url.startsWith('http://') || url.startsWith('https://')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
});

app.on('ready', createWindow);

// Track if we're already signing off to avoid infinite loop
let isSigningOff = false;

// Allow renderer to signal that offline update is complete
ipcMain.on('signoff-complete', () => {
  isSigningOff = false;
  app.quit();
});

// Set user offline in Supabase before the app actually quits
app.on('before-quit', (event) => {
  if (isSigningOff) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    event.preventDefault();
    isSigningOff = true;
    mainWindow.webContents.send('before-quit');
    // Safety timeout: if renderer doesn't respond in 2 seconds, quit anyway
    setTimeout(() => {
      if (isSigningOff) {
        isSigningOff = false;
        app.quit();
      }
    }, 2000);
  }
});

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
