// Entry of the main process. It stays small on purpose: a second SamSync.exe started by the Explorer menu
// while the app already runs must find that out and go away at once, before the real program with its
// modules is even loaded. Electron hands the running instance that command line (second-instance).
import './threadpool';
import { app } from 'electron';
import { parseLaunch } from './launch';

const launch = parseLaunch(process.argv.slice(app.isPackaged ? 1 : 2), app.isPackaged ? undefined : app.getAppPath());
if (!launch.headless && !launch.removeIntegrations && !app.requestSingleInstanceLock()) {
  // exit, not quit: nothing was started that would need a graceful shutdown
  app.exit(0);
} else {
  void import('./app');
}
