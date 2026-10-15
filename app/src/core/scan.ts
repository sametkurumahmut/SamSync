import type { Transport, Entry } from './transport';
import type { PathFilter } from './filter';
import { relKey } from './paths';
import { CancelToken } from './util';
import { t } from '../shared/i18n';

export interface ScanResult {
  /** key (case folded when the side is case insensitive) -> entry, rel relative to the scan base */
  entries: Map<string, Entry>;
  errors: { rel: string; error: string }[];
  exists: boolean;
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
export async function scanTree(tport: Transport, baseRel: string, opts: ScanOptions = {}): Promise<ScanResult> {
  const entries = new Map<string, Entry>();
  const errors: { rel: string; error: string }[] = [];
  const ci = opts.caseInsensitive ?? tport.caseInsensitive;
  const root = await tport.stat(baseRel);
  if (!root || !root.isDir) return { entries, errors, exists: !!root };

  const queue: string[] = [''];
  let active = 0;
  let count = 0;
  const limit = opts.concurrency ?? 8;
  const strip = baseRel ? baseRel.length + 1 : 0;

  await new Promise<void>((resolve, reject) => {
    const pump = () => {
      if (opts.cancel?.cancelled) {
        reject(new Error(t('İptal edildi')));
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
        tport.list(full)
          .then((children) => {
            for (const c of children) {
              const rel = c.rel.slice(strip);
              if (c.isDir) {
                if (opts.filter && !opts.filter.dir(rel)) continue;
                entries.set(relKey(rel, ci), { ...c, rel });
                queue.push(rel);
              } else {
                if (opts.filter && !opts.filter.file(rel, c.size, c.mtimeMs)) continue;
                entries.set(relKey(rel, ci), { ...c, rel });
              }
              count++;
            }
            opts.onProgress?.(count);
          })
          .catch((e) => errors.push({ rel: dir, error: e instanceof Error ? e.message : String(e) }))
          .finally(() => {
            active--;
            pump();
          });
      }
    };
    pump();
  });
  return { entries, errors, exists: true };
}
