// AcrobatDesk desktop app (Windows & macOS).
// Serves the bundled web app from a private app:// origin — fully offline, nothing is uploaded —
// and gives it native file dialogs, "Open with…" / double-click on PDFs, and native menus.
const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, shell } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const isMac = process.platform === 'darwin';
const DIST = path.join(__dirname, '..', 'dist');
const DEV_URL = process.env.ELECTRON_START_URL; // e.g. http://localhost:3000 while developing
const APP_ORIGIN = 'app://acrobatdesk';

// A secure, standard scheme so IndexedDB, the clipboard, fetch and workers behave like HTTPS
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } }
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.gz': 'application/gzip',
  '.txt': 'text/plain; charset=utf-8'
};

function serveApp() {
  protocol.handle('app', async (request) => {
    const { pathname } = new URL(request.url);
    let file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
    // Never serve anything outside the app bundle
    if (!file.startsWith(DIST)) return new Response('Forbidden', { status: 403 });
    let stat = null;
    try {
      stat = await fsp.stat(file);
    } catch {
      /* not found */
    }
    if (!stat || stat.isDirectory()) file = path.join(DIST, 'index.html');
    try {
      const body = await fsp.readFile(file);
      return new Response(body, { headers: { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

// ---------------- Files opened from Finder / Explorer ----------------

const pendingFiles = [];
const allowedWritePaths = new Set();
let mainWindow = null;

function isPdf(p) {
  return typeof p === 'string' && p.toLowerCase().endsWith('.pdf') && fs.existsSync(p);
}

async function readPdf(filePath) {
  const bytes = await fsp.readFile(filePath);
  allowedWritePaths.add(filePath); // the user opened it, so "Save" may write back to it
  return { path: filePath, name: path.basename(filePath), bytes: new Uint8Array(bytes) };
}

async function openInWindow(filePath) {
  if (!isPdf(filePath)) return;
  if (mainWindow && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send('desktop:open-file', await readPdf(filePath));
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  } else {
    pendingFiles.push(filePath);
  }
}

// macOS: double-click / "Open With" (may arrive before the window exists)
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  openInWindow(filePath);
});

// Windows: the file comes in on the command line; a second launch hands it to the running app
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const file = argv.slice(1).find(isPdf);
    if (file) openInWindow(file);
    else if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  const launchFile = process.argv.slice(1).find(isPdf);
  if (launchFile) pendingFiles.push(launchFile);
}

// ---------------- Native dialogs & file access (only what the app needs) ----------------

const pdfFilters = [{ name: 'PDF Documents', extensions: ['pdf'] }];

ipcMain.handle('desktop:open-pdf', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: pdfFilters });
  if (res.canceled || !res.filePaths[0]) return null;
  return readPdf(res.filePaths[0]);
});

ipcMain.handle('desktop:take-pending-files', async () => {
  const files = [];
  while (pendingFiles.length) {
    const p = pendingFiles.shift();
    if (isPdf(p)) files.push(await readPdf(p));
  }
  return files;
});

ipcMain.handle('desktop:write-file', async (_e, filePath, bytes) => {
  // Only files the user chose (or opened) are written; no arbitrary paths from the page
  if (!allowedWritePaths.has(filePath)) throw new Error('Writing to this location was not authorised');
  await fsp.writeFile(filePath, Buffer.from(bytes));
  return true;
});

ipcMain.handle('desktop:save-dialog', async (_e, suggestedName, kind, bytes) => {
  const filters =
    kind === 'pdf' ? pdfFilters : kind === 'md' ? [{ name: 'Markdown', extensions: ['md'] }] : [{ name: 'Text', extensions: ['txt'] }];
  const res = await dialog.showSaveDialog(mainWindow, { defaultPath: suggestedName, filters });
  if (res.canceled || !res.filePath) return null;
  await fsp.writeFile(res.filePath, Buffer.from(bytes));
  allowedWritePaths.add(res.filePath);
  return { path: res.filePath, name: path.basename(res.filePath) };
});

ipcMain.handle('desktop:save-to-folder', async (_e, files) => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'], title: 'Choose a folder for the files' });
  if (res.canceled || !res.filePaths[0]) return false;
  for (const f of files) {
    const safeName = path.basename(String(f.name)).replace(/[\\/:*?"<>|]/g, '_');
    await fsp.writeFile(path.join(res.filePaths[0], safeName), Buffer.from(f.bytes));
  }
  shell.showItemInFolder(path.join(res.filePaths[0], path.basename(String(files[0]?.name || ''))));
  return true;
});

let documentDirty = false;
ipcMain.on('desktop:document-state', (_e, state) => {
  documentDirty = !!state?.dirty;
  if (mainWindow && isMac) mainWindow.setDocumentEdited(documentDirty);
});

// ---------------- Window & menus ----------------

function sendMenu(command) {
  mainWindow?.webContents.send('desktop:menu', command);
}

function buildMenu() {
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => sendMenu('open') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => sendMenu('save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendMenu('saveAs') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => sendMenu('undo') },
        { label: 'Redo', accelerator: isMac ? 'Cmd+Shift+Z' : 'Ctrl+Y', click: () => sendMenu('redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Find…', accelerator: 'CmdOrCtrl+F', click: () => sendMenu('find') }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: () => sendMenu('zoomIn') },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => sendMenu('zoomOut') },
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: () => sendMenu('zoomReset') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }])
      ]
    },
    { role: 'windowMenu' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 640,
    title: 'AcrobatDesk',
    backgroundColor: '#171717',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // The app never navigates away or opens pop-up windows; links open in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(APP_ORIGIN) && !(DEV_URL && url.startsWith(DEV_URL))) event.preventDefault();
  });

  // Unsaved changes: ask before closing (drafts are also autosaved locally)
  mainWindow.on('close', (event) => {
    if (!documentDirty) return;
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      buttons: ['Cancel', 'Close Without Saving'],
      defaultId: 0,
      cancelId: 0,
      message: 'You have unsaved changes.',
      detail: 'Close AcrobatDesk without saving them? Your autosaved draft will be offered next time.'
    });
    if (choice === 0) event.preventDefault();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadURL(DEV_URL || `${APP_ORIGIN}/index.html`);
}

app.whenReady().then(() => {
  serveApp();
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
