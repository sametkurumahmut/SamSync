// The main process proper, loaded by index.ts once it knows this is the one running instance (or a
// headless run that needs no window).
import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeTheme, Notification, powerSaveBlocker, safeStorage, screen, shell, type OpenDialogOptions } from 'electron';
import { Service, type HostAdapter } from '../core/service';
import type { AppEvent, LocalSettings, OpenRequest, QuickSend } from '../shared/types';
import { isApiMethod, type PickOptions } from '../shared/api';
import { getLang, t } from '../shared/i18n';
import { Updater } from './updater';
import { TrayManager } from './tray';
import { launcherCommand, launcherPath } from './launcher';
import { LaunchQueue, parseLaunch } from './launch';
import { startLaunchPipe } from './launchpipe';
import { Integrations, removeIntegrations } from './integration';
import { headlessFromDisk } from '../core/headless';

const isMac = process.platform === 'darwin';
const iconPath = path.join(__dirname, '../../resources', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
/** Height of the page's own title bar in CSS px (global.css --titlebar-h); the native overlay buttons match it. */
const TITLEBAR_H = 44;

interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized?: boolean;
}
const windowStateFile = () => path.join(app.getPath('userData'), 'window.json');
/** The last size and position, when they still land on a screen that is connected now. */
function readWindowState(): WindowState | null {
  try {
    const s = JSON.parse(fs.readFileSync(windowStateFile(), 'utf8')) as Partial<WindowState>;
    if (typeof s.width !== 'number' || typeof s.height !== 'number') return null;
    const st: WindowState = { width: Math.max(980, Math.round(s.width)), height: Math.max(620, Math.round(s.height)), maximized: !!s.maximized };
    if (typeof s.x === 'number' && typeof s.y === 'number') {
      // at least a 200×150 corner of the window must be visible on some display, or it opens centred
      const visible = screen.getAllDisplays().some((d) => {
        const a = d.workArea;
        const w = Math.min(s.x! + st.width, a.x + a.width) - Math.max(s.x!, a.x);
        const h = Math.min(s.y! + st.height, a.y + a.height) - Math.max(s.y!, a.y);
        return w >= 200 && h >= 150;
      });
      if (visible) {
        st.x = Math.round(s.x);
        st.y = Math.round(s.y);
      }
    }
    return st;
  } catch {
    return null;
  }
}
function writeWindowState(s: WindowState) {
  try {
    fs.writeFileSync(windowStateFile(), JSON.stringify(s));
  } catch {
    /* not remembered */
  }
}

// the data folder (SAMSYNC_USER_DATA / the portable folder) was chosen in index.ts, before the single instance lock
app.setAppUserModelId('com.sametkurumahmut.samsync');

async function runHeadlessLaunch(l: ReturnType<typeof parseLaunch>): Promise<number> {
  app.dock?.hide();
  await app.whenReady();
  // stdout may be a pipe, which Node writes asynchronously on Windows: wait for both streams before quitting
  const flush = (s: NodeJS.WriteStream) => new Promise<void>((r) => s.write('', () => r()));
  let code = 1;
  try {
    code = await headlessFromDisk(
      {
        userDataPath: app.getPath('userData'),
        appVersion: app.getVersion(),
        systemLanguages: [...app.getPreferredSystemLanguages(), app.getLocale()],
        decrypt: (enc) => {
          try {
            return safeStorage.decryptString(Buffer.from(enc, 'base64'));
          } catch {
            return null;
          }
        },
        trash: (p) => shell.trashItem(p),
      },
      { mode: l.headless!, paths: l.paths, missing: l.missing, targets: l.targets ?? [], job: l.syncJob },
      { out: (line) => process.stdout.write(line + '\n'), err: (line) => process.stderr.write(line + '\n') },
    );
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  }
  await Promise.all([flush(process.stdout), flush(process.stderr)]);
  return code;
}

/** argv of this or a second instance, without the program (and the app folder when unpackaged). */
const launchOf = (argv: string[]) => parseLaunch(argv.slice(app.isPackaged ? 1 : 2), app.isPackaged ? undefined : app.getAppPath());
const launch = launchOf(process.argv);

if (launch.removeIntegrations) {
  // the uninstaller: take the Explorer menu and the Notepad++ entries out, no window
  void removeIntegrations().finally(() => app.exit(0));
} else if (launch.headless) {
  // --plan-only / --check-only / --sync: answer on the console and quit; runs next to an open window too
  void runHeadlessLaunch(launch).then((code) => app.exit(code));
} else {
  // index.ts took the single instance lock before loading this file
  let win: BrowserWindow | null = null;
  /** A window that starts hidden (tray) was maximized last time: maximize it when it is first shown. */
  let pendingMaximize = false;
  /** The renderer has asked for its bootstrap, so it listens to events; false again on every (re)load. */
  let rendererReady = false;
  const waiting: OpenRequest[] = [];

  // a send over a slow link can take minutes: the computer must not go to sleep in the middle of it
  const activeRuns = new Set<string>();
  let awake: number | null = null;
  const keepAwake = () => {
    if (activeRuns.size && awake == null) awake = powerSaveBlocker.start('prevent-app-suspension');
    if (!activeRuns.size && awake != null) {
      powerSaveBlocker.stop(awake);
      awake = null;
    }
  };
  // the taskbar button shows how far the running sends are, so the window can stay in the background
  const runProgress = new Map<string, number>();
  const showProgress = () => {
    if (!win || win.isDestroyed()) return;
    if (!runProgress.size) return win.setProgressBar(-1);
    let sum = 0;
    for (const v of runProgress.values()) sum += v;
    win.setProgressBar(Math.min(0.999, Math.max(0.01, sum / runProgress.size)));
  };
  const emit = (e: AppEvent) => {
    if (e.type === 'config-changed') integrations.refresh();
    if (e.type === 'run-start') {
      activeRuns.add(e.run.id);
      runProgress.set(e.run.id, 0);
      showProgress();
    }
    if (e.type === 'run-progress') {
      let bt = 0;
      let bd = 0;
      let total = 0;
      let done = 0;
      for (const x of e.targets) {
        bt += x.bytesTotal;
        bd += x.bytesDone;
        total += x.total;
        done += x.done;
      }
      runProgress.set(e.runId, bt > 0 ? bd / bt : total ? done / total : 0);
      showProgress();
    }
    if (e.type === 'run-done') {
      activeRuns.delete(e.run.id);
      runProgress.delete(e.run.id);
      showProgress();
      // a send that finished while the user was elsewhere: the taskbar button blinks until the window is focused
      if (win && !win.isDestroyed() && win.isVisible() && !win.isFocused()) win.flashFrame(true);
    }
    if (e.type === 'run-start' || e.type === 'run-done') keepAwake();
    if (win && !win.isDestroyed()) win.webContents.send('samsync:event', e);
  };
  const deliver = (r: OpenRequest) => {
    if (rendererReady && win && !win.isDestroyed()) emit({ type: 'open', request: r });
    else waiting.push(r);
  };
  const flushWaiting = () => {
    while (waiting.length && rendererReady) emit({ type: 'open', request: waiting.shift()! });
  };
  const launches = new LaunchQueue(deliver);
  /** --quick <name>: a saved send; its settings are known once the service is up, so early ones wait. */
  let settingsReady = false;
  const pendingQuick: string[] = [];
  const runQuickByName = (name: string) => {
    const want = name.toLowerCase();
    const q = (service.settings.quickSends ?? []).find((x) => x.name.toLowerCase() === want || x.id === name);
    if (!q) {
      service.log.warn(t('Başlatma'), t('Hızlı gönderim bulunamadı: {name}', { name }));
      return;
    }
    showWindow();
    launches.add(quickRequest(q), true);
  };
  const addLaunch = (l: ReturnType<typeof parseLaunch>, quick = false) => {
    if (l.quick) {
      if (settingsReady) runQuickByName(l.quick);
      else pendingQuick.push(l.quick);
      return;
    }
    launches.add(l, quick);
  };
  addLaunch(launch);

  // --hidden: started at login; stay in the tray when that is enabled
  const startHidden = launch.hidden;
  let quitting = false;
  let currentSettings: LocalSettings | null = null;
  let loginItem: boolean | null = null;
  let integrationKey = '';
  let trayNoticeShown = false;
  const showWindow = () => {
    if (!app.isReady()) return; // the window opens once the app is ready anyway
    if (!win) createWindow(true);
    if (!win) return;
    if (win.isMinimized()) win.restore();
    if (pendingMaximize) {
      pendingMaximize = false;
      win.maximize();
    }
    win.show();
    win.focus();
  };
  /** A saved send as a launch: the window shows it being sent (or its review). */
  const quickRequest = (q: QuickSend): OpenRequest => ({ paths: q.paths, targets: q.targetIds, send: !q.review, options: q.options, label: q.name });
  /** System-wide keys of the saved sends: registered again whenever the settings change. */
  let hotkeysKey = '';
  const syncHotkeys = (quick: QuickSend[]) => {
    if (!app.isReady()) return;
    const withKeys = quick.filter((q) => q.hotkey);
    const key = JSON.stringify(withKeys.map((q) => [q.id, q.hotkey]));
    if (key === hotkeysKey) return;
    hotkeysKey = key;
    globalShortcut.unregisterAll();
    for (const q of withKeys) {
      let ok = false;
      try {
        ok = globalShortcut.register(q.hotkey!, () => {
          showWindow();
          launches.add(quickRequest(q), true);
        });
      } catch {
        ok = false;
      }
      if (!ok) service.log.warn(t('Başlatma'), t('{key} kısayolu atanamadı ({name}); başka bir program kullanıyor olabilir', { key: q.hotkey!, name: q.name }));
    }
  };
  const trayMgr = new TrayManager(iconPath, {
    show: showWindow,
    setPaused: (p) => void service.automationPause(p),
    quit: () => {
      quitting = true;
      app.quit();
    },
    quickSends: () => service.settings.quickSends ?? [],
    runQuick: (q) => {
      showWindow();
      launches.add(quickRequest(q), true);
    },
    relayState: () => service.relay?.state() ?? { active: false, jobs: 0 },
  });

  const updater = new Updater((state) => emit({ type: 'update', state }));

  /** electron-builder writes the update source next to the app: the release notes live in that repository. */
  const repositoryUrl = (() => {
    try {
      const y = fs.readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8');
      const owner = /^owner:\s*(\S+)/m.exec(y)?.[1];
      const repo = /^repo:\s*(\S+)/m.exec(y)?.[1];
      return owner && repo && owner !== 'none' ? `https://github.com/${owner}/${repo}` : undefined;
    } catch {
      return undefined;
    }
  })();
  const host: HostAdapter = {
    isElectron: true,
    appVersion: app.getVersion(),
    userDataPath: app.getPath('userData'),
    repositoryUrl,
    changelogPath: app.isPackaged ? path.join(process.resourcesPath, 'CHANGELOG.md') : path.join(app.getAppPath(), 'CHANGELOG.md'),
    docsDir: app.isPackaged ? process.resourcesPath : app.getAppPath(),
    // launches go through the queue and the 'open' event, so a big Explorer selection merges with the first item
    initialPaths: [],
    initialTargets: [],
    get systemLanguages() {
      return app.isReady() ? [...app.getPreferredSystemLanguages(), app.getLocale()] : [];
    },
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
    async pickSave(opts: PickOptions) {
      const r = await dialog.showSaveDialog(win!, { title: opts.title, defaultPath: opts.defaultPath, filters: opts.filters });
      return r.canceled || !r.filePath ? null : r.filePath;
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
    async trash(p) {
      await shell.trashItem(p);
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
    integrations: {
      status: () => integrations.status(),
      apply: () => integrations.apply(),
    },
    updater,
    windowControl(action) {
      if (!win) return;
      if (action === 'minimize') win.minimize();
      else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
      else if (action === 'close') win.close();
      else if (action === 'devtools') win.webContents.toggleDevTools();
      else if (action === 'reload') win.webContents.reload();
    },
    setChrome({ theme, bg, fg, zoom }) {
      nativeTheme.themeSource = theme;
      const z = zoom && zoom > 0.4 && zoom < 3 ? zoom : 1;
      if (win && !win.isDestroyed()) {
        if (win.webContents.getZoomFactor() !== z) win.webContents.setZoomFactor(z);
        if (!isMac) {
          try {
            // the page's title bar is 44 CSS px, which the zoom scales; the native buttons must be as tall
            win.setTitleBarOverlay({ color: bg, symbolColor: fg, height: Math.round(TITLEBAR_H * z) });
          } catch {
            /* overlay not enabled */
          }
        }
        win.setBackgroundColor(bg);
      }
    },
    applySettings(s, state) {
      currentSettings = s;
      trayMgr.update(s.closeToTray, state);
      syncHotkeys(s.quickSends ?? []);
      if (app.isPackaged && process.platform !== 'linux' && loginItem !== s.launchAtLogin) {
        app.setLoginItemSettings({ openAtLogin: s.launchAtLogin, path: launcherPath(), args: ['--hidden'] });
        loginItem = s.launchAtLogin;
      }
      // the menus carry labels and the machine list: rebuild them when the language, the pinned machine or a switch changes
      const key = JSON.stringify([getLang(), s.localNodeId, s.explorerMenu, s.notepadPlusPlus]);
      if (integrationKey && key !== integrationKey) integrations.refresh();
      integrationKey = key;
    },
  };

  const service = new Service(host);
  // launches from SamSyncSend.exe (the menus) arrive here, not as a second process
  const pipeWarn = (e: Error) => service.log.warn(t('Başlatma'), t('Menü bağlantısı dinlenemiyor: {error}', { error: e.message }));
  try {
    startLaunchPipe((m) => {
      showWindow();
      addLaunch(parseLaunch(m.args, undefined, m.cwd), true);
    }, pipeWarn);
  } catch (e) {
    pipeWarn(e as Error);
  }
  const integrations = new Integrations({
    config: () => service.config,
    localNode: () => service.identity?.node ?? null,
    settings: () => service.settings,
    launcher: launcherCommand,
    icon: () => `"${launcherPath()}",0`,
    log: service.log,
    onChange: (status) => emit({ type: 'integration', status }),
    // a development run does not put its own menus on the machine unless they are switched on
    defaultOn: app.isPackaged,
  });

  ipcMain.handle('samsync:api', async (_e, method: string, args: unknown[]) => {
    const fn = (service as unknown as Record<string, unknown>)[method];
    if (!isApiMethod(method) || typeof fn !== 'function') throw new Error(t('Bilinmeyen işlem: {method}', { method }));
    const result = await (fn as (...a: unknown[]) => unknown).apply(service, args);
    if (method === 'bootstrap') {
      // the renderer subscribes to events before it asks for the bootstrap
      setTimeout(() => {
        rendererReady = true;
        flushWaiting();
      }, 0);
      integrations.refresh();
    }
    return result;
  });

  const createWindow = (forceShow = false) => {
    const dark = nativeTheme.shouldUseDarkColors;
    const saved = readWindowState();
    win = new BrowserWindow({
      width: saved?.width ?? 1360,
      height: saved?.height ?? 880,
      ...(saved && saved.x != null && saved.y != null ? { x: saved.x, y: saved.y } : {}),
      minWidth: 980,
      minHeight: 620,
      show: false,
      title: 'SamSync',
      icon: iconPath,
      backgroundColor: dark ? '#0d0f14' : '#f5f6f8',
      titleBarStyle: 'hidden',
      ...(isMac ? { trafficLightPosition: { x: 16, y: 15 } } : { titleBarOverlay: { color: dark ? '#0d0f14' : '#f5f6f8', symbolColor: dark ? '#c9ced8' : '#3b414d', height: TITLEBAR_H } }),
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        spellcheck: false,
      },
    });
    win.once('ready-to-show', () => {
      if (forceShow || !(startHidden && currentSettings?.closeToTray)) {
        if (saved?.maximized) win?.maximize();
        win?.show();
      } else pendingMaximize = !!saved?.maximized;
    });
    // the size, the position and the maximized state come back on the next start
    const remember = () => {
      if (!win || win.isDestroyed()) return;
      const b = win.getNormalBounds();
      writeWindowState({ x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() });
    };
    let rememberTimer: ReturnType<typeof setTimeout> | null = null;
    const rememberSoon = () => {
      if (rememberTimer) clearTimeout(rememberTimer);
      rememberTimer = setTimeout(remember, 400);
    };
    for (const ev of ['resize', 'move', 'maximize', 'unmaximize'] as const) win.on(ev as 'resize', rememberSoon);
    win.on('close', (e) => {
      remember();
      if (quitting || !currentSettings?.closeToTray) return;
      // keep the automation running: hide to the tray instead of quitting
      e.preventDefault();
      win?.hide();
      if (!trayNoticeShown) {
        trayNoticeShown = true;
        host.notify?.(t('SamSync arka planda çalışıyor'), t('İzleme ve zamanlanmış işler sürüyor. Tepsideki simgeden açabilir ya da çıkabilirsiniz.'));
      }
    });
    win.on('closed', () => {
      win = null;
      rendererReady = false;
    });
    win.webContents.on('did-start-loading', () => (rendererReady = false));
    // the page refuses to unload while a form has unsaved edits: ask before throwing them away
    win.webContents.on('will-prevent-unload', (e) => {
      const choice = dialog.showMessageBoxSync(win!, {
        type: 'question',
        buttons: [t('Kaydetmeden kapat'), t('Vazgeç')],
        defaultId: 1,
        cancelId: 1,
        title: 'SamSync',
        message: t('Kaydedilmemiş değişiklikler var'),
        detail: t('Kapatırsanız bu değişiklikler kaybolur.'),
      });
      if (choice === 0) e.preventDefault();
      else quitting = false;
    });
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
          // SAMSYNC_SCREENSHOT_EVAL=<script>: run it in the page first (click a button, pick a row…), awaited
          if (process.env.SAMSYNC_SCREENSHOT_EVAL) await win!.webContents.executeJavaScript(process.env.SAMSYNC_SCREENSHOT_EVAL).catch(() => undefined);
          // SAMSYNC_SCREENSHOT_SCROLL=<css selector>: bring that part of the page into view first
          if (process.env.SAMSYNC_SCREENSHOT_SCROLL) {
            await win!.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(process.env.SAMSYNC_SCREENSHOT_SCROLL)})?.scrollIntoView({ block: 'start' })`);
            await new Promise((r) => setTimeout(r, 1000));
          }
          const img = await win!.webContents.capturePage();
          fs.writeFileSync(process.env.SAMSYNC_SCREENSHOT!, img.toPNG());
          if (process.env.SAMSYNC_SCREENSHOT_EXIT) app.quit();
        }, Number(process.env.SAMSYNC_SCREENSHOT_DELAY || 2500));
      });
    }
  };

  app.on('second-instance', (_e, argv) => {
    showWindow();
    addLaunch(launchOf(argv));
  });

  app.on('open-file', (e, p) => {
    e.preventDefault();
    launches.add({ paths: [p] });
  });

  app.whenReady().then(async () => {
    if (isMac) {
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]),
      );
    } else Menu.setApplicationMenu(null);
    await service.init();
    settingsReady = true;
    for (const name of pendingQuick.splice(0)) runQuickByName(name);
    syncHotkeys(service.settings.quickSends ?? []);
    app.on('will-quit', () => globalShortcut.unregisterAll());
    nativeTheme.themeSource = service.settings.theme;
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('before-quit', () => {
    quitting = true;
    service.automation?.stop();
    integrations.stop();
  });

  app.on('window-all-closed', () => {
    if (!isMac && !currentSettings?.closeToTray) app.quit();
  });
}
