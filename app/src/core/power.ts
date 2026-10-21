// Restarting or shutting this machine down at a sender's request (Settings › Agent allows it; off by default), with a
// minute's notice on screen so whoever sits at it can save their work, and the pending one cancelled on request.
import { execFile } from 'node:child_process';
import { t } from '../shared/i18n';

export type PowerAction = 'restart' | 'shutdown' | 'cancel';

const run = (cmd: string, args: string[]) =>
  new Promise<void>((resolve, reject) => execFile(cmd, args, { windowsHide: true, timeout: 15_000 }, (e, _out, err) => (e ? reject(new Error(String(err || e.message).trim())) : resolve())));

/** Starts the restart or the shutdown after `delaySec` (a minute at least where the system counts in minutes). */
export async function powerAction(action: PowerAction, delaySec = 60, reason = ''): Promise<void> {
  const note = (reason || t('SamSync: bir gönderen istedi')).slice(0, 200);
  if (process.platform === 'win32') {
    if (action === 'cancel') return run('shutdown', ['/a']);
    return run('shutdown', [action === 'restart' ? '/r' : '/s', '/t', String(Math.max(0, Math.round(delaySec))), '/c', note]);
  }
  if (action === 'cancel') return run('shutdown', ['-c']);
  return run('shutdown', [action === 'restart' ? '-r' : '-h', `+${Math.max(1, Math.ceil(delaySec / 60))}`, note]);
}
