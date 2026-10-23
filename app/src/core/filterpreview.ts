// "What do the filters leave out?": the send's sources walked on this computer's disk with the send's filter, each
// file or folder left out named with the pattern that did it. A folder left out counts once (nothing below it is
// walked), and the walk stops after a budget so a huge tree still answers quickly.
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { FilterPreview, SendRequest } from '../shared/types';
import type { CoreContext } from './context';
import { pathMatcher } from './filter';
import { sendFilter, sendIgnorePatterns } from './plan';
import { IGNORE_FILE } from './ignore';
import { OWN_FILE_PATTERNS } from '../shared/files';
import { RELAY_FOLDER } from '../shared/relay';

const MAX_LISTED = 500;

export async function filterPreview(ctx: CoreContext, req: SendRequest, budget = { entries: 50_000, ms: 5000 }): Promise<FilterPreview> {
  const ignored = await sendIgnorePatterns(req);
  const filter = sendFilter(ctx, req, ignored);
  // which pattern it was, in the order a person reads them: theirs first, then the ignore file, then SamSync's own
  const rules: { pattern: string; from: FilterPreview['excluded'][number]['from']; dir: boolean; test: (rel: string, isDir?: boolean) => boolean }[] = [];
  const add = (patterns: readonly string[], from: FilterPreview['excluded'][number]['from'], dir: boolean) => {
    for (const p of patterns) rules.push({ pattern: p, from, dir, test: pathMatcher([p]) });
  };
  add(req.options.excludeDirs, 'options', true);
  add(req.options.excludeFiles, 'options', false);
  add(ignored, 'ignore', true);
  add(ignored, 'ignore', false);
  add([ctx.config.copy.backupFolderName, RELAY_FOLDER], 'samsync', true);
  add([IGNORE_FILE, ...OWN_FILE_PATTERNS], 'samsync', false);
  const why = (rel: string, isDir: boolean) => rules.find((r) => r.dir === isDir && r.test(rel, isDir)) ?? { pattern: '?', from: 'samsync' as const };

  const out: FilterPreview = { files: 0, dirs: 0, excludedFiles: 0, excludedDirs: 0, excluded: [], capped: false };
  const started = Date.now();
  let seen = 0;
  const note = (abs: string, rel: string, isDir: boolean) => {
    if (isDir) out.excludedDirs++;
    else out.excludedFiles++;
    if (out.excluded.length < MAX_LISTED) {
      const w = why(rel, isDir);
      out.excluded.push({ path: abs, rel, isDir, pattern: w.pattern, from: w.from });
    }
  };
  for (const src of req.sources) {
    if (src.kind !== 'fs') continue;
    const st = await fsp.stat(src.path).catch(() => null);
    if (!st) continue;
    if (!st.isDirectory()) {
      // a file sent on its own is matched by its name
      const name = path.basename(src.path);
      if (filter.file(name, st.size, st.mtimeMs)) out.files++;
      else note(src.path, name, false);
      continue;
    }
    const stack: { abs: string; rel: string }[] = [{ abs: src.path, rel: '' }];
    while (stack.length) {
      if (seen >= budget.entries || Date.now() - started > budget.ms) {
        out.capped = true;
        return out;
      }
      const d = stack.pop()!;
      const ents = await fsp.readdir(d.abs, { withFileTypes: true }).catch(() => []);
      for (const e of ents) {
        seen++;
        const rel = d.rel ? `${d.rel}/${e.name}` : e.name;
        const abs = path.join(d.abs, e.name);
        if (e.isDirectory()) {
          if (filter.dir(rel)) {
            out.dirs++;
            stack.push({ abs, rel });
          } else note(abs, rel, true);
        } else if (e.isFile()) {
          if (filter.file(rel)) out.files++;
          else note(abs, rel, false);
        }
      }
    }
  }
  return out;
}
