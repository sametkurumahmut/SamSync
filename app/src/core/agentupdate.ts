// Updating SamSync on other machines over the network, for machines without internet or without anyone at them.
// The sender puts the Windows Setup of its own version and an order next to it into the machine's relay folder.
// SamSync there (when it accepts updates, Settings › Agent) checks the file against the order's hash, passes it on
// to the machines of its group when the order says so (a relay: over the group's own network), waits until it has
// nothing to do, and installs it silently; the installer starts the new version again.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { Transport } from './transport';
import { RELAY_FOLDER } from '../shared/relay';
import { relJoin } from './paths';
import { newId } from './util';
import { t } from '../shared/i18n';

export const UPDATE_DIR = relJoin(RELAY_FOLDER, 'update');
const ORDER = relJoin(UPDATE_DIR, 'order.json');

export interface Installer {
  file: string;
  version: string;
  /** SHA-512 of the file, base64 (as latest.yml writes it). */
  sha512: string;
}

export interface UpdateOrder {
  id: string;
  at: number;
  /** node id of the sender, for the log there */
  from?: string;
  version: string;
  /** the Setup's file name in the update folder */
  file: string;
  sha512: string;
  /** install it here; a relay that is up to date only passes it on */
  install: boolean;
  /** node ids of the machines of its group to pass it on to */
  forward?: string[];
}

export interface UpdateOutcome {
  id: string;
  at: number;
  ok: boolean;
  version: string;
  /** the installer was started: SamSync there restarts on the new version */
  installing?: boolean;
  /** node id -> "ok" or why it could not be passed on */
  forwarded?: Record<string, string>;
  error?: string;
}

export async function sha512Of(file: string): Promise<string> {
  const h = createHash('sha512');
  for await (const c of fs.createReadStream(file)) h.update(c as Buffer);
  return h.digest('base64');
}

/** A Setup the user picked: its version from the file name, its hash computed here. */
export async function installerFromFile(file: string): Promise<Installer> {
  const m = /SamSync-Setup-(\d+\.\d+\.\d+)\.exe$/i.exec(path.basename(file));
  if (!m) throw new Error(t('Dosya adından sürüm okunamadı (SamSync-Setup-x.y.z.exe bekleniyor)'));
  return { file, version: m[1], sha512: await sha512Of(file) };
}

/** Puts the Setup and the order on a machine's share; the file is not sent again when the same one is there already. */
export async function putUpdate(tgt: Transport, inst: Installer, order: Pick<UpdateOrder, 'install' | 'forward' | 'from'>, onProgress?: (bytes: number) => void): Promise<void> {
  await tgt.mkdirp(UPDATE_DIR);
  const name = path.basename(inst.file);
  const rel = relJoin(UPDATE_DIR, name);
  const size = (await fsp.stat(inst.file)).size;
  const there = await tgt.stat(rel).catch(() => null);
  if (!there || there.size !== size) {
    const tmp = `${rel}.${newId()}.tmp`;
    await tgt.writeStream(tmp, fs.createReadStream(inst.file), { onProgress });
    await tgt.rename(tmp, rel);
  }
  const o: UpdateOrder = { id: newId('u-'), at: Date.now(), version: inst.version, file: name, sha512: inst.sha512, ...order };
  const tmp = `${ORDER}.${newId()}.tmp`;
  await tgt.writeStream(tmp, Readable.from([Buffer.from(JSON.stringify(o, null, 1), 'utf8')]));
  await tgt.rename(tmp, ORDER);
}

/** The order waiting in this machine's relay folder, if any. */
export async function readOrder(localRoot: string): Promise<UpdateOrder | null> {
  try {
    const o = JSON.parse(await fsp.readFile(path.join(localRoot, ...ORDER.split('/')), 'utf8')) as UpdateOrder;
    return o?.id && o.version && o.file ? o : null;
  } catch {
    return null; // none, or still being written
  }
}

/** Takes the order away and writes how it went; the Setup goes too unless it is being installed from a copy. */
export async function finishOrder(localRoot: string, o: UpdateOrder, out: UpdateOutcome): Promise<void> {
  const dir = path.join(localRoot, ...UPDATE_DIR.split('/'));
  await fsp.rm(path.join(dir, 'order.json'), { force: true }).catch(() => undefined);
  await fsp.rm(path.join(dir, path.basename(o.file)), { force: true }).catch(() => undefined);
  await fsp.writeFile(path.join(dir, 'result.json'), JSON.stringify(out, null, 1)).catch(() => undefined);
}
