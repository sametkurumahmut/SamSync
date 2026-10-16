// The lock a run leaves at a target's root while it writes there, so a second person sending to the same
// machine at the same time is told so (the run still goes ahead: the warning is the point, not a block).
import os from 'node:os';
import { Readable } from 'node:stream';
import type { Transport } from './transport';
import { LOCK_FILE, lockFresh, sameWriter, type TargetLock } from '../shared/files';

function userName(): string {
  try {
    return process.env.USERNAME || os.userInfo().username;
  } catch {
    return '?';
  }
}

/** This run's lock, before it is written. */
export function myLock(label: string, version?: string): TargetLock {
  return { host: os.hostname(), user: userName(), version, label, startedAt: Date.now(), pid: process.pid };
}

export async function readLock(tgt: Transport): Promise<TargetLock | null> {
  try {
    if (!(await tgt.stat(LOCK_FILE))) return null;
    const chunks: Buffer[] = [];
    for await (const c of await tgt.readStream(LOCK_FILE)) chunks.push(c as Buffer);
    const l = JSON.parse(Buffer.concat(chunks).toString('utf8')) as TargetLock;
    return typeof l?.startedAt === 'number' ? l : null;
  } catch {
    return null;
  }
}

/** A fresh lock of someone else on this target, or null. */
export async function otherLock(tgt: Transport, me: TargetLock): Promise<TargetLock | null> {
  const l = await readLock(tgt);
  return lockFresh(l) && !sameWriter(l, me) && !(l.host === me.host && l.pid === me.pid) ? l : null;
}

export async function writeLock(tgt: Transport, me: TargetLock): Promise<void> {
  await tgt.writeStream(LOCK_FILE, Readable.from([Buffer.from(JSON.stringify(me), 'utf8')]));
}

/** Removes the lock when it is still ours (a later writer's lock stays). */
export async function removeLock(tgt: Transport, me: TargetLock): Promise<void> {
  const l = await readLock(tgt);
  if (l && !sameWriter(l, me)) return;
  await tgt.remove(LOCK_FILE, false).catch(() => undefined);
}
