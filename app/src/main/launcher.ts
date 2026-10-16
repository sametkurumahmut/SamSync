import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

/**
 * The program Windows should start for menus, shortcuts and start at login. The portable build unpacks itself
 * into a temporary folder on every start and deletes it on exit, so process.execPath would point at a file that
 * is gone once the app closes; PORTABLE_EXECUTABLE_FILE is the .exe the user actually started.
 */
export function launcherPath(): string {
  return process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
}

/**
 * The program the menus start. The installed and the unpacked (zip) builds carry SamSyncSend.exe next to
 * SamSync.exe: it hands the command line to the running app through a pipe in a few milliseconds, or starts
 * SamSync.exe when nothing runs. The single-file portable build has no such neighbour and starts itself.
 */
export function menuLauncherPath(): string {
  const exe = launcherPath();
  if (process.platform === 'win32' && app.isPackaged && !process.env.PORTABLE_EXECUTABLE_FILE) {
    const send = path.join(path.dirname(exe), 'SamSyncSend.exe');
    if (fs.existsSync(send)) return send;
  }
  return exe;
}

/** The command line prefix that starts this app: the exe, plus the app folder when running unpackaged. */
export function launcherCommand(): string {
  return app.isPackaged ? `"${menuLauncherPath()}"` : `"${process.execPath}" "${app.getAppPath()}"`;
}
