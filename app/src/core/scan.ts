import type { Transport, Entry } from "./transport";
import type { PathFilter } from "./filter";
import { relKey } from "./paths";
import { CancelToken } from "./util";
import { t } from "../shared/i18n";

export interface ScanResult {
  /** key (case folded when the side is case insensitive) -> entry, rel relative to the scan base */
  entries: Map<string, Entry>;
  errors: { rel: string; error: string }[];
  exists: boolean;
  /** SamSync's own temporary files no copy uses any more (a dropped link left them), rel relative to the scan base. */
  leftovers: string[];
}

/** A copy on its way in, or the part of a big file kept for the next attempt: SamSync's, never part of the tree. */
const TEMP = /\.samsync-tmp$/i;
const PART = /\.resume-\d+-\d+\.samsync-tmp$/i;
/** The time a copy's temporary file was started, when its name carries it (see executor.ts tmpRelFor). */
const STARTED = /\.([0-9a-z]{8,9})-[0-9a-z]{4}\.samsync-tmp$/i;
/** A copy's temporary file older than this belongs to no copy any more. */
export const TEMP_MAX_AGE_MS = 86400_000;
/** A kept part nobody continued for this long is not continued any more (executor.ts drops it too). */
export const PART_MAX_AGE_MS = 14 * 86400_000;

/** True for a temporary file of SamSync's that nothing will use again. */
export function staleTemp(name: string, mtimeMs: number, now = Date.now()): boolean {
  if (PART.test(name)) return now - mtimeMs > PART_MAX_AGE_MS;
  const m = STARTED.exec(name);
  const at = m ? parseInt(m[1], 36) : mtimeMs;
  return now - at > TEMP_MAX_AGE_MS;
}

export interface ScanOptions {
  filter?: PathFilter;
  cancel?: CancelToken;
  onProgress?: (count: number) => void;
  concurrency?: number;
  /** Fold keys to lower case (set when either side of a comparison is case insensitive). */
  caseInsensitive?: boolean;
}

/** Recursively lists `baseRel` on a transport. Paths in the result are relative to `baseRel`. */
export async function scanTree(
  tport: Transport,
  baseRel: string,
  opts: ScanOptions = {},
): Promise<ScanResult> {
  const entries = new Map<string, Entry>();
  const errors: { rel: string; error: string }[] = [];
  const leftovers: string[] = [];
  const now = Date.now();
  const ci = opts.caseInsensitive ?? tport.caseInsensitive;
  const root = await tport.stat(baseRel);
  if (!root || !root.isDir) return { entries, errors, exists: !!root, leftovers };

  const queue: string[] = [""];
  let active = 0;
  let count = 0;
  // a share is asked folder by folder with one batched query each, several folders at a time
  const lister = tport.localPath ? (tport.lister?.() ?? null) : null;
  const limit = opts.concurrency ?? (lister ? 4 : 8);
  const strip = baseRel ? baseRel.length + 1 : 0;
  const listDir = (full: string): Promise<Entry[]> =>
    lister
      ? lister
          .list(tport.localPath!(full))
          .then((names) =>
            names.map((c) => ({
              ...c,
              rel: full ? `${full}/${c.rel}` : c.rel,
            })),
          )
      : tport.list(full);

  try {
    await new Promise<void>((resolve, reject) => {
      const pump = () => {
        if (opts.cancel?.cancelled) {
          reject(new Error(t("İptal edildi")));
          return;
        }
        if (!queue.length && active === 0) {
          resolve();
          return;
        }
        while (active < limit && queue.length) {
          const dir = queue.shift()!;
          active++;
          const full = dir ? (baseRel ? `${baseRel}/${dir}` : dir) : baseRel;
          listDir(full)
            .then((children) => {
              for (const c of children) {
                const rel = c.rel.slice(strip);
                if (c.isDir) {
                  if (opts.filter && !opts.filter.dir(rel)) continue;
                  entries.set(relKey(rel, ci), { ...c, rel });
                  queue.push(rel);
                } else {
                  if (TEMP.test(rel)) {
                    if (staleTemp(rel, c.mtimeMs, now)) leftovers.push(rel);
                    continue;
                  }
                  if (opts.filter && !opts.filter.file(rel, c.size, c.mtimeMs))
                    continue;
                  entries.set(relKey(rel, ci), { ...c, rel });
                }
                count++;
              }
              opts.onProgress?.(count);
            })
            .catch((e) =>
              errors.push({
                rel: dir,
                error: e instanceof Error ? e.message : String(e),
              }),
            )
            .finally(() => {
              active--;
              pump();
            });
        }
      };
      pump();
    });
  } finally {
    lister?.close();
  }
  return { entries, errors, exists: true, leftovers };
}
