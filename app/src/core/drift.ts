// Drift: files on a machine that changed after SamSync last wrote there (edited by hand, copied over, deleted). The
// manifest at the machine's root says what each sent folder held after the last send; the folder as it is now is
// compared with it by size and time. SamSync on the machine does that from its own disk when it runs there; for
// other machines the folder is walked over the share.
import type { DriftSubtree } from '../shared/types';
import type { CoreContext } from './context';
import type { Transport } from './transport';
import { entriesToMap, readManifest } from './manifest';
import { scanTree } from './scan';
import { sameTime, type TimeOptions } from './compare';
import { withTopDirsExcluded, type PathFilter } from './filter';
import { otherBackupRoots } from './backups';
import { sendFilter } from './plan';
import { relJoin, relKey } from './paths';
import { baseSendOptions } from '../shared/options';
import type { CancelToken } from './util';

/** Files listed per kind and folder; the counts are always whole. */
export const DRIFT_LIST_MAX = 200;

export interface DriftResult {
  /** A manifest was there: without one nothing is known about what was sent. */
  manifest: boolean;
  subtrees: DriftSubtree[];
}

/** The filter a drift walk uses: the default exclusions of the settings and SamSync's own files and folders. */
export function driftFilter(ctx: CoreContext): PathFilter {
  return sendFilter(ctx, { sources: [], targetIds: [], options: baseSendOptions(ctx.config.copy), origin: 'send' });
}

export function driftTime(ctx: CoreContext): TimeOptions {
  return { toleranceMs: ctx.config.copy.timeToleranceSec * 1000, ignoreDstShift: ctx.config.copy.ignoreDstShift };
}

export async function driftOf(tgt: Transport, filter: PathFilter, time: TimeOptions, backupFolder: string, cancel?: CancelToken): Promise<DriftResult> {
  const m = await readManifest(tgt);
  if (!m) return { manifest: false, subtrees: [] };
  const out: DriftSubtree[] = [];
  for (const [rel, sub] of Object.entries(m.subtrees)) {
    cancel?.throwIfCancelled();
    const was = entriesToMap(sub);
    // older backup folders at the root belong to no release
    const f = rel ? filter : withTopDirsExcluded(filter, await otherBackupRoots(tgt, backupFolder).catch(() => []));
    const scan = await scanTree(tgt, rel, { filter: f, cancel, caseInsensitive: true });
    const now = scan.entries;
    const d: DriftSubtree = { rel, label: sub.label, writtenAt: sub.writtenAt, changed: [], added: [], removed: [], counts: { changed: 0, added: 0, removed: 0 } };
    const note = (kind: 'changed' | 'added' | 'removed', r: string) => {
      d.counts[kind]++;
      if (d[kind].length < DRIFT_LIST_MAX) d[kind].push(relJoin(rel, r));
    };
    for (const [key, e] of was) {
      const n = now.get(key);
      if (!n) {
        // a folder that went counts once, not with every file it held
        const parent = e.rel.includes('/') ? e.rel.slice(0, e.rel.lastIndexOf('/')) : '';
        if (parent && !now.has(relKey(parent, true)) && was.has(relKey(parent, true))) continue;
        note('removed', e.rel);
      } else if (!e.isDir && (n.isDir || n.size !== e.size || !sameTime(n.mtimeMs, e.mtimeMs, time))) note('changed', e.rel);
    }
    for (const [key, n] of now) {
      if (was.has(key)) continue;
      const parent = n.rel.includes('/') ? n.rel.slice(0, n.rel.lastIndexOf('/')) : '';
      if (parent && !was.has(relKey(parent, true))) continue; // inside a folder that is new itself
      note('added', n.rel);
    }
    for (const k of ['changed', 'added', 'removed'] as const) d[k].sort((a, b) => a.localeCompare(b));
    out.push(d);
  }
  out.sort((a, b) => a.rel.localeCompare(b.rel));
  return { manifest: true, subtrees: out };
}

