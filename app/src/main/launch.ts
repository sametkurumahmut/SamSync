// Command line of the app: what Explorer, Notepad++ and shortcuts start it with.
//   SamSync.exe [--send] [--to <ids>] [--yes] [--restore] <paths...>
//   --to      node ids, group:<name>, profile:<name>, all, or last (the last send's targets and options), comma separated
//   --yes     send at once, no review (the one-click menu entries)
//   --restore show the backups of the items
//   --plan-only   print where the items would go on each target, no window (exit code 0, 1 on an error)
//   --check-only  print whether each target holds the same items, no window (exit code 0 = all the same, else 1)
//   --sync <job>  compare and run a sync job (id or name) with its default actions, no window (exit code 0 = all done)
//   --quick <name>  run a saved send (Send page → Hızlı gönderimler) by its name or id
//   --pack <folder>  write the items as one pack file into the folder, no window (prints the file; exit code 0 = written)
//   --since <pack|machine>  with --pack: only what changed since that earlier pack file, or what that machine lacks
//   --hidden  started at login: stay in the tray when that is enabled
//   --remove-integrations  take the Explorer menu and the Notepad++ entries out, then quit (used by the uninstaller)
import fs from 'node:fs';
import path from 'node:path';
import type { OpenRequest } from '../shared/types';

export interface Launch extends OpenRequest {
  hidden: boolean;
  removeIntegrations: boolean;
  /** --plan-only / --check-only / --sync: answer on the console and quit, without a window. */
  headless?: 'plan' | 'check' | 'sync' | 'pack';
  /** --pack: the folder the pack file goes into. */
  packDir?: string;
  /** --since: an earlier pack file, or a machine (id or name), the pack is made against. */
  since?: string;
  /** --sync: the job's id or name. */
  syncJob?: string;
  /** --quick: the name (or id) of a saved send to run. */
  quick?: string;
  /** Arguments that looked like paths but do not exist (reported by the headless modes). */
  missing: string[];
}

/** argv without the program (and, unpackaged, the app folder); relative paths count from `cwd`. */
export function parseLaunch(args: string[], appPath?: string, cwd?: string): Launch {
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
    } else if (a === '--quick' || a.startsWith('--quick=')) {
      out.quick = (a === '--quick' ? args[++i] ?? '' : a.slice(8)).trim();
    } else if (a === '--pack' || a.startsWith('--pack=')) {
      out.headless = 'pack';
      const dir = (a === '--pack' ? args[++i] ?? '' : a.slice(7)).trim();
      out.packDir = dir ? (cwd ? path.resolve(cwd, dir) : path.resolve(dir)) : '';
    } else if (a === '--since' || a.startsWith('--since=')) {
      const ref = (a === '--since' ? args[++i] ?? '' : a.slice(8)).trim();
      // a pack file by its path; anything else is a machine
      out.since = /\.samsync-pack$/i.test(ref) ? (cwd ? path.resolve(cwd, ref) : path.resolve(ref)) : ref;
    } else if (a && !a.startsWith('-')) {
      try {
        const p = cwd ? path.resolve(cwd, a) : path.resolve(a);
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
const QUIET_QUICK_MS = 150;
const QUIET_MANY_QUICK_MS = 400;
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

  /** `quick`: the items come through the pipe from SamSyncSend.exe, which Explorer starts within a few ms of each other. */
  add(r: OpenRequest, quick = false): void {
    if (!r.paths.length && !r.targets?.length) return;
    const key = JSON.stringify([r.targets ?? [], !!r.send, !!r.restore, r.label ?? '']);
    let b = this.batches.get(key);
    if (!b) {
      b = { req: { ...r, paths: [] }, count: 0, first: this.now(), timer: null };
      this.batches.set(key, b);
    }
    b.req.paths.push(...r.paths);
    b.count++;
    if (b.timer) clearTimeout(b.timer);
    const quiet = b.count > 1 ? (quick ? QUIET_MANY_QUICK_MS : QUIET_MANY_MS) : quick ? QUIET_QUICK_MS : QUIET_MS;
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
