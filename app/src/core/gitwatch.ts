// Git-triggered automation: every move of HEAD is a line in the repository's reflog (.git/logs/HEAD)
// with the old and new commit and what moved it ("commit: …", "pull: Fast-forward", "checkout: moving
// from …"). Reading those lines tells a commit or a pull apart from a checkout without installing hooks, so
// a watch can send what a commit or a pull changed and leave branch switches alone.
import fs from 'node:fs';
import path from 'node:path';
import type { GitEvent } from '../shared/types';
import { gitText } from './git';
import { isUnder } from './paths';

export { DEFAULT_GIT_EVENTS } from '../shared/automation';
const ZERO = /^0+$/;

export interface ReflogEntry {
  from: string;
  to: string;
  message: string;
}

/** One reflog line: "<old> <new> <name> <email> <time> <tz>\t<message>". */
export function parseReflogLine(line: string): ReflogEntry | null {
  const m = /^([0-9a-f]{40,64}) ([0-9a-f]{40,64}) [^\t]*\t(.*)$/.exec(line.trimEnd());
  return m ? { from: m[1], to: m[2], message: m[3] } : null;
}

/**
 * What moved HEAD. 'step' is an intermediate line of a rebase (start / pick): the move is only complete at
 * its "finish" line. null: something no event covers.
 */
export function classifyReflog(message: string): GitEvent | 'step' | null {
  const m = message.toLowerCase();
  if (/^commit \(amend\)/.test(m)) return 'amend';
  if (/^commit \(merge\)/.test(m)) return 'merge';
  if (/^commit( \(initial\))?:/.test(m)) return 'commit';
  if (/^pull\b.*\((start|pick|continue|squash|fixup|edit|reword)\)/.test(m)) return 'step';
  if (/^pull\b/.test(m)) return 'pull';
  if (/^merge\b/.test(m)) return 'merge';
  if (/^rebase\b.*\(finish\)/.test(m)) return 'rebase';
  if (/^rebase\b/.test(m)) return 'step';
  if (/^(cherry-pick|revert)\b/.test(m)) return 'pick';
  if (/^reset:/.test(m)) return 'reset';
  if (/^checkout:/.test(m)) return 'checkout';
  return null;
}

export interface HeadMove {
  from: string;
  to: string;
  event: GitEvent;
}

/**
 * Turns new reflog entries into the moves the watch cares about. A rebase reports a range from where it
 * started to where it finished; moves of other kinds are dropped (a checkout between two commits does not
 * widen what the second commit sends). `pending` carries an unfinished rebase over to the next read.
 */
export function selectMoves(entries: ReflogEntry[], events: GitEvent[], pending: { from?: string } = {}): HeadMove[] {
  const out: HeadMove[] = [];
  for (const e of entries) {
    const kind = classifyReflog(e.message);
    if (kind === 'step') {
      pending.from ??= e.from;
      continue;
    }
    const from = pending.from ?? e.from;
    pending.from = undefined;
    if (!kind || !events.includes(kind) || from === e.to) continue;
    out.push({ from, to: e.to, event: kind });
  }
  return out;
}

/**
 * Files a range of commits touched under `repo` (deleted ones included), as absolute paths below `repo` as it
 * was given. Git reports paths from the top of the work tree, which it resolves through links (on macOS
 * /var is /private/var), so the paths are rebuilt from the folder's own prefix instead of git's top folder.
 */
export async function changedFiles(repo: string, from: string, to: string): Promise<string[]> {
  const prefix = (await gitText(repo, ['rev-parse', '--show-prefix'])).trim();
  const out = ZERO.test(from)
    ? await gitText(repo, ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-z', to])
    : await gitText(repo, ['diff', '--name-only', '--no-renames', '-z', from, to]);
  return out
    .split('\0')
    .filter((p) => p && p.startsWith(prefix))
    .map((p) => path.normalize(path.join(repo, p.slice(prefix.length))));
}

/** Polls the reflog of the repository that holds `repo` and reports new HEAD moves. */
export class ReflogWatcher {
  private file = '';
  private offset = 0;
  private pending: { from?: string } = {};
  private reading = false;
  error?: string;

  constructor(
    private repo: string,
    private events: GitEvent[],
    private onMoves: (moves: HeadMove[]) => void,
    private intervalMs = 1000,
  ) {}

  async start(): Promise<void> {
    this.error = undefined;
    try {
      const gitDir = (await gitText(this.repo, ['rev-parse', '--absolute-git-dir'])).trim();
      this.file = path.join(gitDir, 'logs', 'HEAD');
      this.offset = fs.existsSync(this.file) ? fs.statSync(this.file).size : 0;
      fs.watchFile(this.file, { interval: this.intervalMs }, () => void this.read());
    } catch (e) {
      this.error = `${this.repo}: ${(e as Error).message.split('\n')[0]}`;
    }
  }

  /** Reads what was appended since the last read (also callable directly, e.g. by tests). */
  async read(): Promise<void> {
    if (this.reading || !this.file) return;
    this.reading = true;
    try {
      const size = fs.existsSync(this.file) ? fs.statSync(this.file).size : 0;
      if (size < this.offset) this.offset = 0; // the reflog was expired or rewritten
      if (size === this.offset) return;
      const fd = fs.openSync(this.file, 'r');
      const buf = Buffer.alloc(size - this.offset);
      try {
        fs.readSync(fd, buf, 0, buf.length, this.offset);
      } finally {
        fs.closeSync(fd);
      }
      // keep a half-written last line for the next read
      const text = buf.toString('utf8');
      const end = text.lastIndexOf('\n') + 1;
      this.offset += Buffer.byteLength(text.slice(0, end));
      const entries = text
        .slice(0, end)
        .split('\n')
        .map(parseReflogLine)
        .filter((x): x is ReflogEntry => !!x);
      const moves = selectMoves(entries, this.events, this.pending);
      if (moves.length) this.onMoves(moves);
    } finally {
      this.reading = false;
    }
  }

  stop(): void {
    if (this.file) fs.unwatchFile(this.file);
    this.file = '';
  }
}

/** Keeps the files of a watched sub folder only (a watch may cover part of a repository). */
export function underWatched(files: string[], roots: string[]): string[] {
  return files.filter((f) => roots.some((r) => isUnder(f, r)));
}
