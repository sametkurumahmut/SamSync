import { app } from 'electron';

/**
 * The program Windows should start for menus, shortcuts and start at login. The portable build unpacks itself
 * into a temporary folder on every start and deletes it on exit, so process.execPath would point at a file that
 * is gone once the app closes; PORTABLE_EXECUTABLE_FILE is the .exe the user actually started.
 */
export function launcherPath(): string {
  return process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
}

/** The command line prefix that starts this app: the exe, plus the app folder when running unpackaged. */
export function launcherCommand(): string {
  return app.isPackaged ? `"${launcherPath()}"` : `"${process.execPath}" "${app.getAppPath()}"`;
}
