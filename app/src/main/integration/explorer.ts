// Explorer right-click menu (Windows): a "SamSync" cascade on every file and folder with send to all, review,
// last settings, restore, profiles, groups and machines. Written as one .reg import (HKCU, no admin) so a menu
// with 30 keys is one process instead of a hundred reg.exe calls; a hash value on the root key lets an
// unchanged menu skip the import.
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { entryCommand, type MenuEntry, type MenuPlan } from '../../shared/menu';

export const EXPLORER_ROOT = 'HKEY_CURRENT_USER\\Software\\Classes\\AllFilesystemObjects\\shell\\SamSync';
/** Where SamSync 2.0.0 put its single verb; removed on every write. */
const OLD_KEYS = ['HKEY_CURRENT_USER\\Software\\Classes\\*\\shell\\SamSync', 'HKEY_CURRENT_USER\\Software\\Classes\\Directory\\shell\\SamSync'];
const HASH_VALUE = 'SamSyncMenu';
const SEPARATOR_BEFORE = 0x20; // ECF_SEPARATORBEFORE

const regFile = (parts: string[]) => ['Windows Registry Editor Version 5.00', '', ...parts, ''].join('\r\n');
/** "[-key]" deletes the key with everything under it. */
const deleteKeys = () => [EXPLORER_ROOT, ...OLD_KEYS].map((k) => `[-${k}]`);
const regString = (s: string) =>`"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const keyName = (i: number, id: string) => `${String(i * 10).padStart(3, '0')}_${id.replace(/[^A-Za-z0-9._-]/g, '_')}`;

export interface ExplorerMenuSpec {
  title: string;
  plan: MenuPlan;
  /** Quoted program (and app folder in development) that the commands start. */
  launcher: string;
  /** Icon resource, e.g. "C:\...\SamSync.exe",0 */
  icon: string;
}

/** The keys and values of the menu in .reg syntax; hash (when given) is stored on the root key. */
export function explorerRegBody(spec: ExplorerMenuSpec, hash?: string): string {
  const lines: string[] = [];
  const key = (k: string, values: [string, string][]) => {
    lines.push('', `[${k}]`, ...values.map(([n, v]) => `${n === '@' ? '@' : regString(n)}=${v}`));
  };
  const verb = (k: string, e: MenuEntry, separatorBefore: boolean, sub: boolean) => {
    const values: [string, string][] = [['MUIVerb', regString(e.label)]];
    if (e.icon) values.push(['Icon', regString(spec.icon)]);
    // every verb needs Player too, or Explorer hides it when more than 15 items are selected
    values.push(['MultiSelectModel', regString('Player')]);
    if (separatorBefore) values.push(['CommandFlags', `dword:${SEPARATOR_BEFORE.toString(16).padStart(8, '0')}`]);
    if (sub) values.push(['SubCommands', '""']);
    key(k, values);
    if (!sub) key(`${k}\\command`, [['@', regString(entryCommand(spec.launcher, e, '%1'))]]);
  };

  key(EXPLORER_ROOT, [
    ['MUIVerb', regString(spec.title)],
    ['Icon', regString(spec.icon)],
    ['MultiSelectModel', regString('Player')],
    ['SubCommands', '""'],
    ...(hash ? ([[HASH_VALUE, regString(hash)]] as [string, string][]) : []),
  ]);
  spec.plan.items.forEach((item, i) => {
    const k = `${EXPLORER_ROOT}\\shell\\${keyName(i, item.entry.id)}`;
    if (!item.children) return verb(k, item.entry, item.separatorBefore, false);
    verb(k, item.entry, item.separatorBefore, true);
    item.children.forEach((c, j) => verb(`${k}\\shell\\${keyName(j, c.id)}`, c, false, false));
  });
  return lines.join('\r\n');
}

/** The full .reg file: delete the old trees, write the new one with its hash. */
export function explorerRegFile(spec: ExplorerMenuSpec): { text: string; hash: string } {
  const hash = crypto.createHash('sha256').update(explorerRegBody(spec)).digest('hex').slice(0, 16);
  return { text: regFile([...deleteKeys(), explorerRegBody(spec, hash)]), hash };
}

function reg(args: string[]): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile('reg.exe', args, { windowsHide: true }, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || stderr) }));
  });
}

async function importReg(text: string): Promise<void> {
  const file = path.join(os.tmpdir(), `samsync-menu-${process.pid}-${Date.now()}.reg`);
  // regedit format 5.00 is UTF-16 LE with a BOM; that keeps Turkish labels intact
  await fs.writeFile(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]));
  try {
    const r = await reg(['import', file]);
    if (!r.ok) throw new Error(r.out.trim() || 'reg import');
  } finally {
    await fs.rm(file, { force: true });
  }
}

export interface ExplorerState {
  installed: boolean;
  /** Command of the first entry, to show which program the menu starts. */
  command?: string;
  hash?: string;
}

export async function explorerState(): Promise<ExplorerState> {
  const r = await reg(['query', EXPLORER_ROOT.replace('HKEY_CURRENT_USER', 'HKCU'), '/v', HASH_VALUE]);
  const hash = /REG_SZ\s+([0-9a-f]+)/.exec(r.out)?.[1];
  if (!r.ok) return { installed: false };
  const c = await reg(['query', `${EXPLORER_ROOT.replace('HKEY_CURRENT_USER', 'HKCU')}\\shell`, '/s', '/ve']);
  const command = /\\command\s*\r?\n\s+\(Default\)\s+REG_SZ\s+(.*)/i.exec(c.out)?.[1]?.trim();
  return { installed: true, hash, command };
}

/** Writes the menu unless the same one is already there. Returns true when it wrote. */
export async function explorerInstall(spec: ExplorerMenuSpec, force = false): Promise<boolean> {
  const { text, hash } = explorerRegFile(spec);
  if (!force && (await explorerState()).hash === hash) return false;
  await importReg(text);
  return true;
}

export async function explorerRemove(): Promise<void> {
  await importReg(regFile(deleteKeys()));
}
