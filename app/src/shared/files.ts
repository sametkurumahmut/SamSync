// Files SamSync keeps at a target's root for itself. They are never sent, compared or mirrored away.

/** Who is writing to this machine right now (removed when the run ends; a stale one is ignored). */
export const LOCK_FILE = 'samsync-lock.json';
/** What SamSync last saw and wrote under each sent folder, so the next comparison can start from it. */
export const MANIFEST_FILE = 'samsync-manifest.json';
/** Patterns of everything of SamSync's own that may lie at a target root or inside a folder. */
export const OWN_FILE_PATTERNS = [LOCK_FILE, MANIFEST_FILE, '*.samsync-tmp', '.samsync-speedtest-*.tmp'];

/** A lock older than this is a leftover of a run that never finished (a crash, a lost network). */
export const LOCK_STALE_MS = 30 * 60_000;

export interface TargetLock {
  host: string;
  user: string;
  /** SamSync version of the writer. */
  version?: string;
  /** The run's label. */
  label: string;
  startedAt: number;
  pid: number;
}

export function lockFresh(l: TargetLock | null | undefined, now = Date.now()): l is TargetLock {
  return !!l && typeof l.startedAt === 'number' && now - l.startedAt < LOCK_STALE_MS;
}

export function sameWriter(a: TargetLock, b: TargetLock): boolean {
  return a.host === b.host && a.pid === b.pid && a.startedAt === b.startedAt;
}
