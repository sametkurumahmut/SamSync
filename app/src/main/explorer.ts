import { execFile } from 'node:child_process';
import { app } from 'electron';
import type { ExplorerMenuStatus } from '../shared/api';

const KEY_NAME = 'SamSync';
const BASES = ['HKCU\\Software\\Classes\\*\\shell', 'HKCU\\Software\\Classes\\Directory\\shell'];

function reg(args: string[]): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile('reg.exe', args, { windowsHide: true }, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || stderr) }));
  });
}

/** The command Explorer runs for every selected item. The single instance lock merges them into one window. */
export function explorerCommand(): string {
  const exe = process.execPath;
  return app.isPackaged ? `"${exe}" --send "%1"` : `"${exe}" "${app.getAppPath()}" --send "%1"`;
}

export async function explorerMenuStatus(): Promise<ExplorerMenuStatus> {
  if (process.platform !== 'win32') return { supported: false, installed: false };
  const r = await reg(['query', `${BASES[0]}\\${KEY_NAME}\\command`, '/ve']);
  const m = /REG_SZ\s+(.*)$/m.exec(r.out);
  return { supported: true, installed: r.ok, command: m?.[1]?.trim() };
}

export async function explorerMenuInstall(install: boolean, label = 'SamSync ile gönder'): Promise<ExplorerMenuStatus> {
  if (process.platform !== 'win32') return { supported: false, installed: false };
  for (const base of BASES) {
    const key = `${base}\\${KEY_NAME}`;
    if (!install) {
      await reg(['delete', key, '/f']);
      continue;
    }
    await reg(['add', key, '/ve', '/d', label, '/f']);
    await reg(['add', key, '/v', 'Icon', '/d', process.execPath, '/f']);
    // "Player" keeps the verb visible for up to 100 selected items (Document stops at 15).
    await reg(['add', key, '/v', 'MultiSelectModel', '/d', 'Player', '/f']);
    await reg(['add', `${key}\\command`, '/ve', '/d', explorerCommand(), '/f']);
  }
  return explorerMenuStatus();
}
