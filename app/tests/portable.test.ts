import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { portableDataDir, portableKind, PORTABLE_DATA_FOLDER } from '../src/main/portable';
import { tmpDir } from './helpers';

const win = process.platform === 'win32';

describe('portable data folder', () => {
  const saved = process.env.PORTABLE_EXECUTABLE_DIR;
  afterEach(() => {
    if (saved === undefined) delete process.env.PORTABLE_EXECUTABLE_DIR;
    else process.env.PORTABLE_EXECUTABLE_DIR = saved;
  });

  it.runIf(win)('keeps the data of the single-file portable exe next to the exe the user started', async () => {
    const dir = await tmpDir('samsync-portable-');
    process.env.PORTABLE_EXECUTABLE_DIR = dir;
    expect(portableKind(true)).toBe('exe');
    const data = portableDataDir('exe');
    expect(data).toBe(path.join(dir, PORTABLE_DATA_FOLDER));
    expect(fs.existsSync(data!)).toBe(true);
  });

  it.runIf(win)('treats a packaged app without an uninstaller next to it as the zip build', () => {
    delete process.env.PORTABLE_EXECUTABLE_DIR;
    // node.exe's folder has no "Uninstall *.exe", like the unpacked zip build
    expect(portableKind(true)).toBe('zip');
  });

  it('is not portable in a development run or off Windows', () => {
    expect(portableKind(false)).toBeNull();
    expect(portableDataDir(null)).toBeNull();
  });
});
