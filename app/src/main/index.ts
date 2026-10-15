import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, Notification, safeStorage, shell, type OpenDialogOptions } from 'electron';
import { Service, type HostAdapter } from '../core/service';
import type { AppEvent, LocalSettings } from '../shared/types';
import { isApiMethod, type PickOptions } from '../shared/api';
import { explorerMenuInstall, explorerMenuStatus } from './explorer';
import { Updater } from './updater';
import { TrayManager } from './tray';

const isMac = process.platform === 'darwin';
const iconPath = path.join(__dirname, '../../resources', process.platform === 'win32' ? 'icon.ico' : 'icon.png');

if (process.env.SAMSYNC_USER_DATA) app.setPath('userData', process.env.SAMSYNC_USER_DATA);
app.setAppUserModelId('com.sametkurumahmut.samsync');

/** --to <ids> / --to=<ids>: node ids, group:<name>, profile:<name> or all, comma separated. */
function targetsFromArgv(argv: string[]): string[] {
  const i = argv.findIndex((a) => a === '--to' || a.startsWith('--to='));
  if (i < 0) return [];
  const raw = argv[i].startsWith('--to=') ? argv[i].slice(5) : argv[i + 1] ?? '';
  return raw.split(',').map((x) => x.trim()).filter(Boolean);
}

/** Paths passed on the command line (Explorer verb, "Open with", drag onto the exe). */
function pathsFromArgv(argv: string[]): string[] {
  const out: string[] = [];
  const args = argv.slice(app.isPackaged ? 1 : 2);
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (a === '--to') {
      k++;
      continue;
    }
    if (!a || a.startsWith('-')) continue;
    try {
      if (fs.existsSync(a) && path.resolve(a) !== path.resolve(app.getAppPath())) out.push(path.resolve(a));
    } catch {
      /* ignore */
    }
  }
  return out;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  let win: BrowserWindow | null = null;
  const initialPaths = pathsFromArgv(process.argv);
  const initialTargets = targetsFromArgv(process.argv);
  let pendingPaths: string[] = [];
  let pendingTargets: string[] = [];
  let flushTimer: NodeJS.Timeout | null = null;

  const emit = (e: AppEvent) => {
    if (win && !win.isDestroyed()) win.webContents.send('samsync:event', e);
  };

  // --hidden: started at login; stay in the tray when that is enabled
  const startHidden = process.argv.includes('--hidden');
  let quitting = false;
  let currentSettings: LocalSettings | null = null;
  let loginItem: boolean | null = null;
  let trayNoticeShown = false;
  const showWindow = () => {
    if (!win) createWindow(true);
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  };
  const trayMgr = new TrayManager(iconPath, {
    show: showWindow,
    setPaused: (p) => void service.automationPause(p),
    quit: () => {
      quitting = true;
      app.quit();
    },
  });

  // Explorer starts one process per selected item; the extra instances land here. Collect them for a
  // moment so a 40 file selection opens as one send instead of 40.
  const queuePaths = (paths: string[], targets: string[] = []) => {
    pendingPaths.push(...paths);
    if (targets.length) pendingTargets = targets;
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      const list = [...new Set(pendingPaths)];
      const tg = pendingTargets;
      pendingPaths = [];
      pendingTargets = [];
      if (list.length) emit({ type: 'open-paths', paths: list, targets: tg.length ? tg : undefined, review: tg.length > 0 });
    }, 450);
  };

  const updater = new Updater((state) => emit({ type: 'update', state }));

  const host: HostAdapter = {
    isElectron: true,
    appVersion: app.getVersion(),
    userDataPath: app.getPath('userData'),
    initialPaths,
    initialTargets,
    emit,
    async pick(opts: PickOptions) {
      const props: OpenDialogOptions['properties'] = [];
      if (opts.files !== false && !opts.folders) props.push('openFile');
      if (opts.folders) props.push('openDirectory');
      if (opts.files && opts.folders) props.push('openFile');
      if (opts.multi) props.push('multiSelections');
      const r = await dialog.showOpenDialog(win!, { title: opts.title, defaultPath: opts.defaultPath, filters: opts.filters, properties: props });
      return r.canceled ? [] : r.filePaths;
    },
    async openPath(p) {
      const err = await shell.openPath(p);
      if (err) throw new Error(err);
    },
    async showInFolder(p) {
      shell.showItemInFolder(p);
    },
    async openExternal(url) {
      await shell.openExternal(url);
    },
    encrypt(plain) {
      if (!safeStorage.isEncryptionAvailable()) return null;
      return safeStorage.encryptString(plain).toString('base64');
    },
    decrypt(enc) {
      try {
        return safeStorage.decryptString(Buffer.from(enc, 'base64'));
      } catch {
        return null;
      }
    },
    notify(title, body) {
      if (!Notification.isSupported()) return;
      const n = new Notification({ title, body, icon: iconPath, silent: false });
      n.on('click', () => {
        win?.show();
        win?.focus();
      });
      n.show();
    },
    explorerMenu: { status: explorerMenuStatus, install: (on) => explorerMenuInstall(on) },
    updater,
    windowControl(action) {
      if (!win) return;
      if (action === 'minimize') win.minimize();
      else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
      else if (action === 'close') win.close();
      else if (action === 'devtools') win.webContents.toggleDevTools();
      else if (action === 'reload') win.webContents.reload();
    },
    setChrome({ theme, bg, fg }) {
      nativeTheme.themeSource = theme;
      if (win && !isMac) {
        try {
          win.setTitleBarOverlay({ color: bg, symbolColor: fg, height: 44 });
        } catch {
          /* overlay not enabled */
        }
      }
      win?.setBackgroundColor(bg);
    },
    applySettings(s, state) {
      currentSettings = s;
      trayMgr.update(s.closeToTray, state);
      if (app.isPackaged && process.platform !== 'linux' && loginItem !== s.launchAtLogin) {
        app.setLoginItemSettings({ openAtLogin: s.launchAtLogin, args: ['--hidden'] });
        loginItem = s.launchAtLogin;
      }
    },
  };

  const service = new Service(host);

  ipcMain.handle('samsync:api', async (_e, method: string, args: unknown[]) => {
    const fn = (service as unknown as Record<string, unknown>)[method];
    if (!isApiMethod(method) || typeof fn !== 'function') throw new Error(`Bilinmeyen işlem: ${method}`);
    return (fn as (...a: unknown[]) => unknown).apply(service, args);
  });

  const createWindow = (forceShow = false) => {
    const dark = nativeTheme.shouldUseDarkColors;
    win = new BrowserWindow({
      width: 1360,
      height: 880,
      minWidth: 980,
      minHeight: 620,
      show: false,
      title: 'SamSync',
      icon: iconPath,
      backgroundColor: dark ? '#0d0f14' : '#f5f6f8',
      titleBarStyle: 'hidden',
      ...(isMac ? { trafficLightPosition: { x: 16, y: 15 } } : { titleBarOverlay: { color: dark ? '#0d0f14' : '#f5f6f8', symbolColor: dark ? '#c9ced8' : '#3b414d', height: 44 } }),
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        spellcheck: false,
      },
    });
    win.once('ready-to-show', () => {
      if (forceShow || !(startHidden && currentSettings?.closeToTray)) win?.show();
    });
    win.on('close', (e) => {
      if (quitting || !currentSettings?.closeToTray) return;
      // keep the automation running: hide to the tray instead of quitting
      e.preventDefault();
      win?.hide();
      if (!trayNoticeShown) {
        trayNoticeShown = true;
        host.notify?.('SamSync arka planda çalışıyor', 'İzleme ve zamanlanmış işler sürüyor. Tepsideki simgeden açabilir ya da çıkabilirsiniz.');
      }
    });
    win.on('closed', () => (win = null));
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, url) => {
      if (!url.startsWith('http://localhost') && !url.startsWith('file://')) e.preventDefault();
    });
    win.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i'))) win?.webContents.toggleDevTools();
    });

    const route = process.env.SAMSYNC_ROUTE ? `#${process.env.SAMSYNC_ROUTE}` : '';
    if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL + route);
    else void win.loadFile(path.join(__dirname, '../renderer/index.html'), { hash: route.slice(1) || undefined });

    // Debug aid: SAMSYNC_SCREENSHOT=<file.png> captures the window once it has rendered.
    if (process.env.SAMSYNC_SCREENSHOT) {
      win.webContents.once('did-finish-load', () => {
        setTimeout(async () => {
          const img = await win!.webContents.capturePage();
          fs.writeFileSync(process.env.SAMSYNC_SCREENSHOT!, img.toPNG());
          if (process.env.SAMSYNC_SCREENSHOT_EXIT) app.quit();
        }, Number(process.env.SAMSYNC_SCREENSHOT_DELAY || 2500));
      });
    }
  };

  app.on('second-instance', (_e, argv) => {
    const paths = pathsFromArgv(argv);
    const targets = targetsFromArgv(argv);
    showWindow();
    if (paths.length) queuePaths(paths, targets);
  });

  app.on('open-file', (e, p) => {
    e.preventDefault();
    if (win) queuePaths([p]);
    else initialPaths.push(p);
  });

  app.whenReady().then(async () => {
    if (isMac) {
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]),
      );
    } else Menu.setApplicationMenu(null);
    await service.init();
    nativeTheme.themeSource = service.settings.theme;
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('before-quit', () => {
    quitting = true;
    service.automation?.stop();
  });

  app.on('window-all-closed', () => {
    if (!isMac && !currentSettings?.closeToTray) app.quit();
  });
}
