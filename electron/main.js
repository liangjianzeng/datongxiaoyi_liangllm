/**
 * main.js — LiangLLM Electron Main Process
 *
 * Responsibilities:
 * 1. Start the Python FastAPI backend server as a child process
 * 2. Create the main application window
 * 3. Handle window lifecycle (minimize to tray, clean shutdown)
 * 4. Provide IPC bridge for native operations
 *
 * Architecture:
 *   Electron main.js
 *     ├── spawns Python backend (FastAPI on :19600)
 *     ├── creates BrowserWindow → loads frontend/index.html
 *     └── creates Tray icon (optional)
 */

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');

app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-gpu-compositing');

// ── Configuration ───────────────────────────

const BACKEND_PORT = 19600;
const BACKEND_HOST = '127.0.0.1';
const isDev = !app.isPackaged;

// Resolve paths based on whether we're packaged or in dev
const ROOT_DIR = isDev
  ? path.resolve(__dirname, '..')
  : path.resolve(process.resourcesPath);

const BACKEND_DIR = isDev
  ? path.resolve(ROOT_DIR, 'backend')
  : path.resolve(ROOT_DIR, 'backend');

const FRONTEND_DIR = isDev
  ? path.resolve(ROOT_DIR, 'frontend')
  : path.resolve(ROOT_DIR, 'frontend');

let mainWindow = null;
let tray = null;
let backendProcess = null;

// ── Backend Process ─────────────────────────

function findPython() {
  const venvPython = path.join(BACKEND_DIR, 'venv', 'Scripts', 'python.exe');
  const candidates = [];
  if (fs.existsSync(venvPython)) {
    candidates.push(venvPython);
  }
  candidates.push('python', 'python3');
  return candidates;
}

function killPort(port) {
  try {
    const { execSync } = require('child_process');
    const out = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { encoding: 'utf8' });
    const lines = out.trim().split(/\r?\n/);
    const pids = new Set();
    for (const line of lines) {
      const m = line.trim().split(/\s+/);
      if (m.length) pids.add(m[m.length - 1]);
    }
    for (const pid of pids) {
      if (pid && String(pid) !== String(process.pid)) {
        try { execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' }); } catch (_) {}
      }
    }
  } catch (_) {}
}

function startBackend() {
  killPort(BACKEND_PORT);
  killPort(8080);

  const pythonCandidates = findPython();

  function tryStart(index) {
    if (index >= pythonCandidates.length) {
      console.error('[LiangLLM] No Python executable found. Backend will not start.');
      return;
    }

    const pythonExe = pythonCandidates[index];
    const serverScript = path.join(BACKEND_DIR, 'server.py');

    console.log(`[LiangLLM] Trying Python: ${pythonExe}`);
    console.log(`[LiangLLM] Backend script: ${serverScript}`);

    try {
      backendProcess = spawn(pythonExe, [serverScript, '--port', String(BACKEND_PORT)], {
        cwd: BACKEND_DIR,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      });

      backendProcess.stdout.on('data', (data) => {
        const msg = data.toString().trim();
        console.log(`[Backend] ${msg}`);
        if (mainWindow) {
          mainWindow.webContents.send('backend-log', msg);
        }
      });

      backendProcess.stderr.on('data', (data) => {
        const msg = data.toString().trim();
        console.log(`[Backend:err] ${msg}`);
      });

      backendProcess.on('error', (err) => {
        console.error(`[LiangLLM] Python error: ${err.message}`);
        tryStart(index + 1); // Try next Python candidate
      });

      backendProcess.on('exit', (code, signal) => {
        console.log(`[LiangLLM] Backend exited (code=${code}, signal=${signal})`);
        backendProcess = null;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('backend-status', { running: false });
        }
      });

      // Wait a moment then check if process is alive
      setTimeout(() => {
        if (backendProcess && backendProcess.exitCode === null) {
          console.log('[LiangLLM] Backend started successfully');
          if (mainWindow) {
            mainWindow.webContents.send('backend-status', { running: true });
          }
        }
      }, 2000);
    } catch (e) {
      console.error(`[LiangLLM] Failed to start: ${e.message}`);
      tryStart(index + 1);
    }
  }

  tryStart(0);
}

function stopBackend() {
  if (backendProcess) {
    console.log('[LiangLLM] Stopping backend...');
    if (process.platform === 'win32') {
      // On Windows, use taskkill to ensure the whole tree is killed
      spawn('taskkill', ['/pid', String(backendProcess.pid), '/f', '/t']);
    } else {
      backendProcess.kill('SIGTERM');
    }
    backendProcess = null;
  }
}

// ── Main Window ─────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'LiangLLM - 本地大模型管理代理',
    backgroundColor: '#1a1b1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
    icon: path.join(FRONTEND_DIR, 'assets', '大彤小熠.ico'),
    show: false,
  });

  // Load the frontend
  const indexPath = path.join(FRONTEND_DIR, 'index.html');
  mainWindow.loadFile(indexPath);

  // Show when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Minimize to tray instead of closing
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  // Open DevTools in dev mode
  if (isDev) {
    // mainWindow.webContents.openDevTools();
  }
}

// ── Tray Icon ───────────────────────────────

function createTray() {
  // Create a simple 16x16 tray icon
  const iconSize = 16;
  const canvas = nativeImage.createFromBuffer(
    Buffer.alloc(iconSize * iconSize * 4), // RGBA
    { width: iconSize, height: iconSize }
  );

  tray = new Tray(canvas);
  tray.setToolTip('LiangLLM - 本地大模型管理代理');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示窗口',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.isQuitting = true;
        stopBackend();
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ── IPC Handlers ────────────────────────────

ipcMain.handle('get-backend-url', () => {
  return `http://${BACKEND_HOST}:${BACKEND_PORT}`;
});

ipcMain.handle('get-backend-status', () => {
  return {
    running: backendProcess !== null && backendProcess.exitCode === null,
    port: BACKEND_PORT,
  };
});

ipcMain.handle('restart-backend', () => {
  stopBackend();
  setTimeout(() => startBackend(), 1000);
  return { ok: true };
});

ipcMain.handle('select-folder', async (_evt, opts) => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  const result = await dialog.showOpenDialog(win, {
    title: (opts && opts.title) || '选择文件夹',
    properties: ['openDirectory'],
    defaultPath: (opts && opts.defaultPath) || undefined,
  });
  if (result.canceled || !result.filePaths.length) return { ok: false };
  return { ok: true, path: result.filePaths[0] };
});

ipcMain.handle('select-file', async (_evt, opts) => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  const filters = (opts && opts.filters) || [
    { name: '可执行文件', extensions: ['exe', 'bat', 'cmd', 'sh'] },
    { name: '所有文件', extensions: ['*'] },
  ];
  const result = await dialog.showOpenDialog(win, {
    title: (opts && opts.title) || '选择文件',
    properties: ['openFile'],
    filters,
    defaultPath: (opts && opts.defaultPath) || undefined,
  });
  if (result.canceled || !result.filePaths.length) return { ok: false };
  return { ok: true, path: result.filePaths[0] };
});

// ── App Lifecycle ───────────────────────────

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);

  startBackend();
  createWindow();
  createTray();

  // macOS: re-create window on activate
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Don't quit — minimize to tray
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  stopBackend();
});

app.on('will-quit', () => {
  stopBackend();
});
