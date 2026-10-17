// Entry of the main process. It stays small on purpose: a second SamSync.exe started by the Explorer menu
// while the app already runs must find that out and go away at once, before the real program with its
// modules is even loaded. Electron hands the running instance that command line (second-instance).
import './threadpool';
import { app } from 'electron';
import { parseLaunch } from './launch';
import { portableDataDir, portableKind } from './portable';

// The data folder first: the single instance lock belongs to it, so a portable copy, a screenshot run or
// the smoke test (SAMSYNC_USER_DATA) do not mistake the installed app for themselves and go away.
if (process.env.SAMSYNC_USER_DATA) app.setPath('userData', process.env.SAMSYNC_USER_DATA);
else {
  // portable runs keep settings and history in SamSync-data next to the program
  const dir = portableDataDir(portableKind(app.isPackaged));
  if (dir) app.setPath('userData', dir);
}

const launch = parseLaunch(process.argv.slice(app.isPackaged ? 1 : 2), app.isPackaged ? undefined : app.getAppPath());
if (!launch.headless && !launch.removeIntegrations && !app.requestSingleInstanceLock()) {
  // exit, not quit: nothing was started that would need a graceful shutdown
  app.exit(0);
} else {
  void import('./app');
}
