// Portable runs keep their data next to the program, so settings, history and backups of the settings travel
// with it and survive the next start. Two portable shapes exist on Windows:
//  - the single-file portable exe, which unpacks itself into a temporary folder on every start
//    (PORTABLE_EXECUTABLE_DIR is the folder of the .exe the user started);
//  - the zip build, an unpacked app folder with no uninstaller next to SamSync.exe.
// If the folder next to the program cannot be written (a read-only share), the usual per-user folder is used.
import fs from 'node:fs';
import path from 'node:path';

export const PORTABLE_DATA_FOLDER = 'SamSync-data';

export type PortableKind = 'exe' | 'zip' | null;

export function portableKind(isPackaged: boolean): PortableKind {
  if (process.platform !== 'win32' || !isPackaged) return null;
  if (process.env.PORTABLE_EXECUTABLE_DIR) return 'exe';
  // the installer puts its uninstaller next to the program; the zip build has none
  const dir = path.dirname(process.execPath);
  const installed = fs.readdirSync(dir).some((n) => /^Uninstall .*\.exe$/i.test(n));
  return installed ? null : 'zip';
}

/** The data folder next to the program, created if needed; null when it cannot be written. */
export function portableDataDir(kind: PortableKind): string | null {
  if (!kind) return null;
  const base = kind === 'exe' ? process.env.PORTABLE_EXECUTABLE_DIR! : path.dirname(process.execPath);
  const dir = path.join(base, PORTABLE_DATA_FOLDER);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.write-test');
    fs.writeFileSync(probe, '');
    fs.rmSync(probe, { force: true });
    return dir;
  } catch {
    return null;
  }
}
