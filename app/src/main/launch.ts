// Command line of the app: what Explorer, Notepad++ and shortcuts start it with.
//   SamSync.exe [--send] [--to <ids>] [--yes] [--restore] <paths...>
//   --to      node ids, group:<name>, profile:<name>, all, or last (the last send's targets and options), comma separated
//   --yes     send at once, no review (the one-click menu entries)
//   --restore show the backups of the items
//   --plan-only   print where the items would go on each target, no window (exit code 0, 1 on an error)
//   --check-only  print whether each target holds the same items, no window (exit code 0 = all the same, else 1)
//   --sync <job>  compare and run a sync job (id or name) with its default actions, no window (exit code 0 = all done)
//   --hidden  started at login: stay in the tray when that is enabled
//   --remove-integrations  take the Explorer menu and the Notepad++ entries out, then quit (used by the uninstaller)
import fs from 'node:fs';
import path from 'node:path';
import type { OpenRequest } from '../shared/types';

export interface Launch extends OpenRequest {
  hidden: boolean;
  removeIntegrations: boolean;
  /** --plan-only / --check-only / --sync: answer on the console and quit, without a window. */
  headless?: 'plan' | 'check' | 'sync';
  /** --sync: the job's id or name. */
  syncJob?: string;
  /** Arguments that looked like paths but do not exist (reported by the headless modes). */
  missing: string[];
}

/** argv without the program (and, unpackaged, the app folder). */
export function parseLaunch(args: string[], appPath?: string): Launch {
  const out: Launch = { paths: [], hidden: false, removeIntegrations: false, missing: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--to' || a.startsWith('--to=')) {
      const raw = a === '--to' ? args[++i] ?? '' : a.slice(5);
      out.targets = [...(out.targets ?? []), ...raw.split(',').map((x) => x.trim()).filter(Boolean)];
    } else if (a === '--yes') out.send = true;
    else if (a === '--restore') out.restore = true;
    else if (a === '--hidden') out.hidden = true;
    else if (a === '--remove-integrations') out.removeIntegrations = true;
    else if (a === '--plan-only') out.headless = 'plan';
    else if (a === '--check-only') out.headless = 'check';
    else if (a === '--sync' || a.startsWith('--sync=')) {
      out.headless = 'sync';
      out.syncJob = (a === '--sync' ? args[++i] ?? '' : a.slice(7)).trim();
    } else if (a && !a.startsWith('-')) {
      try {
        const p = path.resolve(a);
        if (appPath && p === path.resolve(appPath)) continue;
        if (fs.existsSync(p)) out.paths.push(p);
        else out.missing.push(p);
      } catch {
        /* not a path */
      }
    }
  }
  return out;
}

const QUIET_MS = 400;
/** Once a second process has arrived the selection is a big one and Explorer starts them unevenly. */
const QUIET_MANY_MS = 1200;
const MAX_WAIT_MS = 30000;

interface Batch {
  req: OpenRequest;
  count: number;
  first: number;
  timer: NodeJS.Timeout | null;
}

/**
 * Explorer starts one process per selected item. Requests that ask for the same thing (same targets, send or
 * review, restore) are merged into one: the batch closes when nothing new arrived for a short while, at the
 * latest after 30 seconds, so a 40 file selection is one send and not 40.
 */
export class LaunchQueue {
  private batches = new Map<string, Batch>();

  constructor(private deliver: (r: OpenRequest) => void, private now = () => Date.now()) {}

  add(r: OpenRequest): void {
    if (!r.paths.length && !r.targets?.length) return;
    const key = JSON.stringify([r.targets ?? [], !!r.send, !!r.restore]);
    let b = this.batches.get(key);
    if (!b) {
      b = { req: { ...r, paths: [] }, count: 0, first: this.now(), timer: null };
      this.batches.set(key, b);
    }
    b.req.paths.push(...r.paths);
    b.count++;
    if (b.timer) clearTimeout(b.timer);
    const quiet = b.count > 1 ? QUIET_MANY_MS : QUIET_MS;
    const wait = Math.max(0, Math.min(quiet, b.first + MAX_WAIT_MS - this.now()));
    const batch = b;
    b.timer = setTimeout(() => {
      this.batches.delete(key);
      const seen = new Set<string>();
      const paths = batch.req.paths.filter((p) => {
        const k = process.platform === 'win32' ? p.toLowerCase() : p;
        return !seen.has(k) && !!seen.add(k);
      });
      this.deliver({ ...batch.req, paths });
    }, wait);
  }
}
