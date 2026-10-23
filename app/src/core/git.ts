import { execFile, spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { PassThrough, type Readable } from 'node:stream';
import type { DiffLine, DiffResult, GitChange, GitChangeKind, GitCommit, GitLogPage, GitRepoInfo, SourceSpec, GitDiffSpec } from '../shared/types';
import { textDiff } from './textdiff';
import { isUnder, normalizeAbs, toPosix } from './paths';
import { t } from '../shared/i18n';

export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const MAX_DIFF_BYTES = 4 * 1024 * 1024;

const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' };

export class GitError extends Error {
  constructor(
    message: string,
    readonly stderr = '',
  ) {
    super(message);
  }
}

export function git(cwd: string, args: string[], opts: { input?: string; maxBuffer?: number; allowFail?: boolean } = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      ['-c', 'core.quotepath=off', '-c', 'color.ui=never', ...args],
      { cwd, encoding: 'buffer', maxBuffer: opts.maxBuffer ?? 128 * 1024 * 1024, windowsHide: true, env: gitEnv },
      (err, stdout, stderr) => {
        if (err && !opts.allowFail) {
          const msg = stderr.toString('utf8').trim() || err.message;
          reject(new GitError(msg.split('\n').slice(0, 4).join('\n'), stderr.toString('utf8')));
        } else resolve(stdout);
      },
    );
    if (opts.input != null) {
      child.stdin?.end(opts.input);
    }
  });
}

export async function gitText(cwd: string, args: string[], opts?: Parameters<typeof git>[2]): Promise<string> {
  return (await git(cwd, args, opts)).toString('utf8');
}

export async function gitVersion(): Promise<string | null> {
  try {
    const out = await gitText(process.cwd(), ['--version']);
    return out.trim().replace(/^git version /, '');
  } catch {
    return null;
  }
}

export async function findRepoRoot(p: string): Promise<string | null> {
  try {
    let dir = p;
    const st = await fsp.stat(p).catch(() => null);
    if (st && !st.isDirectory()) dir = path.dirname(p);
    if (!st) dir = path.dirname(p);
    const out = (await gitText(dir, ['rev-parse', '--show-toplevel'])).trim();
    return out ? normalizeAbs(out) : null;
  } catch {
    return null;
  }
}

/**
 * A revision as given by a caller (a browser in server mode among them): one that starts with "-" would be read by
 * git as an option (`--output=<file>` writes anywhere), so it is refused, as is one with spaces or control characters.
 */
export function safeRev(rev: string): string {
  if (!rev || rev.startsWith('-') || /[\s\x00-\x1f]/.test(rev)) throw new GitError(t('Geçersiz sürüm adı: {rev}', { rev: String(rev).slice(0, 80) }), '');
  return rev;
}

/** A path inside the repository, as given by a caller; one that leads out of it is refused. */
function insideRepo(root: string, rel: string): string {
  const abs = path.join(root, rel);
  if (!isUnder(abs, root)) throw new GitError(t('Depo dışında bir yol: {path}', { path: rel }), '');
  return abs;
}

async function hasHead(root: string): Promise<boolean> {
  const out = await git(root, ['rev-parse', '--verify', '-q', 'HEAD'], { allowFail: true });
  return out.toString().trim().length > 0;
}

// ---------------------------------------------------------------- status

function kindFrom(x: string, y: string): GitChangeKind {
  if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) return 'U';
  if (y === 'D') return 'D';
  if (x !== '.') return x as GitChangeKind;
  return y as GitChangeKind;
}

export interface StatusResult {
  info: GitRepoInfo;
  changes: GitChange[];
}

export async function status(root: string): Promise<StatusResult> {
  const out = await gitText(root, ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all']);
  const parts = out.split('\0');
  const info: GitRepoInfo = { root, name: path.basename(root), branch: '', head: '', dirty: 0 };
  const changes: GitChange[] = [];
  for (let i = 0; i < parts.length; i++) {
    const line = parts[i];
    if (!line) continue;
    if (line.startsWith('# ')) {
      const [, key, ...rest] = line.split(' ');
      const val = rest.join(' ');
      if (key === 'branch.oid') info.head = val === '(initial)' ? '' : val;
      else if (key === 'branch.head') info.branch = val === '(detached)' ? t('HEAD (ayrık)') : val;
      else if (key === 'branch.upstream') info.upstream = val;
      else if (key === 'branch.ab') {
        const m = /\+(\d+) -(\d+)/.exec(val);
        if (m) {
          info.ahead = Number(m[1]);
          info.behind = Number(m[2]);
        }
      }
      continue;
    }
    const type = line[0];
    if (type === '1') {
      const f = line.split(' ');
      const xy = f[1];
      const p = f.slice(8).join(' ');
      changes.push({ path: p, kind: kindFrom(xy[0], xy[1]), staged: xy[0] !== '.', unstaged: xy[1] !== '.' });
    } else if (type === '2') {
      const f = line.split(' ');
      const xy = f[1];
      const p = f.slice(9).join(' ');
      const orig = parts[++i];
      changes.push({ path: p, oldPath: orig, kind: xy[1] === 'D' ? 'D' : (xy[0] === 'C' ? 'C' : 'R'), staged: xy[0] !== '.', unstaged: xy[1] !== '.' });
    } else if (type === 'u') {
      const f = line.split(' ');
      changes.push({ path: f.slice(10).join(' '), kind: 'U', staged: false, unstaged: true });
    } else if (type === '?') {
      changes.push({ path: line.slice(2), kind: '?', untracked: true });
    }
  }
  // line counts against HEAD for tracked files
  if (changes.length && (await hasHead(root))) {
    const stats = parseNumstat(await gitText(root, ['diff', 'HEAD', '--numstat', '-z', '-M'], { allowFail: true }));
    for (const c of changes) {
      const s = stats.get(c.path);
      if (s) Object.assign(c, s);
    }
  }
  info.dirty = changes.length;
  changes.sort((a, b) => a.path.localeCompare(b.path));
  return { info, changes };
}

export async function repoInfo(root: string): Promise<GitRepoInfo> {
  return (await status(root)).info;
}

function parseNumstat(out: string): Map<string, { additions?: number; deletions?: number; binary?: boolean }> {
  const map = new Map<string, { additions?: number; deletions?: number; binary?: boolean }>();
  const parts = out.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const line = parts[i];
    if (!line) continue;
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(line);
    if (!m) continue;
    let p = m[3];
    if (!p) {
      // rename: "a\td\t\0old\0new"
      i++;
      p = parts[++i];
    }
    const binary = m[1] === '-';
    map.set(p, binary ? { binary: true } : { additions: Number(m[1]), deletions: Number(m[2]) });
  }
  return map;
}

function parseNameStatus(out: string): GitChange[] {
  const parts = out.split('\0');
  const list: GitChange[] = [];
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i];
    if (!code) continue;
    const k = code[0] as GitChangeKind;
    if (k === 'R' || k === 'C') {
      const oldPath = parts[++i];
      const p = parts[++i];
      list.push({ path: p, oldPath, kind: k });
    } else {
      list.push({ path: parts[++i], kind: k });
    }
  }
  return list;
}

// ---------------------------------------------------------------- log

const SEP = '\x1f';
const REC = '\x1e';

export interface LogQuery {
  skip?: number;
  limit?: number;
  search?: string;
  ref?: string;
  all?: boolean;
  path?: string;
}

export async function log(root: string, q: LogQuery = {}): Promise<GitLogPage & { unpushed: string[] }> {
  if (!(await hasHead(root))) return { commits: [], hasMore: false, unpushed: [] };
  const limit = Math.max(1, Math.min(1000, Math.floor(Number(q.limit) || 60)));
  const skip = Math.max(0, Math.floor(Number(q.skip) || 0));
  const args = ['log', `--format=%H${SEP}%h${SEP}%an${SEP}%ae${SEP}%at${SEP}%P${SEP}%D${SEP}%s${SEP}%b${REC}`, `-n`, String(limit + 1), `--skip=${skip}`];
  const s = q.search?.trim();
  if (s) {
    if (/^[0-9a-f]{4,40}$/i.test(s)) {
      const sha = await gitText(root, ['rev-parse', '--verify', '-q', `${s}^{commit}`], { allowFail: true });
      if (sha.trim()) {
        args.push('--no-walk', sha.trim());
        return finishLog(root, await gitText(root, args), limit);
      }
    }
    args.push(`--grep=${s}`, '-i');
  }
  if (q.all) args.push('--all');
  else if (q.ref) args.push(safeRev(q.ref));
  if (q.path) args.push('--', q.path);
  return finishLog(root, await gitText(root, args), limit);
}

async function finishLog(root: string, out: string, limit: number) {
  const commits: GitCommit[] = out
    .split(REC)
    .map((r) => r.replace(/^\n/, ''))
    .filter((r) => r.trim())
    .map((r) => {
      const [sha, short, author, email, at, parents, refs, subject, body] = r.split(SEP);
      return {
        sha,
        short,
        author,
        email,
        date: Number(at) * 1000,
        subject,
        body: body?.trim() || undefined,
        parents: parents ? parents.split(' ').filter(Boolean) : [],
        refs: refs ? refs.split(', ').map((x) => x.trim()).filter(Boolean) : [],
      };
    });
  const hasMore = commits.length > limit;
  if (hasMore) commits.pop();
  let unpushed: string[] = [];
  const up = await gitText(root, ['rev-list', '@{upstream}..HEAD', '-n', '500'], { allowFail: true });
  unpushed = up.split('\n').map((x) => x.trim()).filter(Boolean);
  return { commits, hasMore, unpushed };
}

export async function branches(root: string): Promise<{ current: string; local: string[]; remote: string[] }> {
  const out = await gitText(root, ['branch', '-a', '--format=%(HEAD)%(refname)'], { allowFail: true });
  const local: string[] = [];
  const remote: string[] = [];
  let current = '';
  for (const l of out.split('\n')) {
    if (!l.trim()) continue;
    const isCur = l.startsWith('*');
    const ref = l.slice(1).trim();
    if (ref.startsWith('refs/heads/')) {
      const name = ref.slice('refs/heads/'.length);
      local.push(name);
      if (isCur) current = name;
    } else if (ref.startsWith('refs/remotes/') && !ref.endsWith('/HEAD')) {
      remote.push(ref.slice('refs/remotes/'.length));
    }
  }
  return { current, local, remote };
}

// ---------------------------------------------------------------- commit selections

async function commitParents(root: string, shas: string[]): Promise<Map<string, { parent: string; date: number; depth: number }>> {
  const out = await gitText(root, ['show', '-s', `--format=%H %at %P`, ...shas.map(safeRev)]);
  const map = new Map<string, { parent: string; date: number; depth: number }>();
  for (const l of out.split('\n')) {
    const [sha, at, p1] = l.trim().split(' ');
    if (sha) map.set(sha, { parent: p1 || EMPTY_TREE, date: Number(at) * 1000, depth: 0 });
  }
  // Commit times have a one second resolution; the ancestor count orders commits made in the same second.
  await Promise.all(
    [...map.entries()].map(async ([sha, m]) => {
      m.depth = Number((await gitText(root, ['rev-list', '--count', sha])).trim()) || 0;
    }),
  );
  return map;
}

/** Oldest first: ancestors before descendants. */
function orderOldestFirst(shas: string[], meta: Map<string, { date: number; depth: number }>): string[] {
  return [...shas].sort((a, b) => (meta.get(a)?.depth ?? 0) - (meta.get(b)?.depth ?? 0) || (meta.get(a)?.date ?? 0) - (meta.get(b)?.date ?? 0));
}

/**
 * Union of the files touched by the selected commits (each against its first parent, so merges show
 * what they brought in). A file touched by several commits appears once with the newest status.
 */
export async function commitChanges(root: string, shas: string[]): Promise<GitChange[]> {
  if (!shas.length) return [];
  const meta = await commitParents(root, shas);
  const ordered = orderOldestFirst(shas, meta);
  const byPath = new Map<string, GitChange>();
  for (const sha of ordered) {
    const parent = meta.get(sha)?.parent ?? EMPTY_TREE;
    const [ns, num] = await Promise.all([
      gitText(root, ['diff', '--name-status', '-z', '-M', parent, sha]),
      gitText(root, ['diff', '--numstat', '-z', '-M', parent, sha]),
    ]);
    const stats = parseNumstat(num);
    for (const c of parseNameStatus(ns)) {
      const prev = byPath.get(c.path);
      const s = stats.get(c.path) ?? {};
      if (prev) {
        prev.commits = [...(prev.commits ?? []), sha];
        // added earlier and modified later is still an addition from the point of view of the targets
        if (!(prev.kind === 'A' && c.kind === 'M')) prev.kind = c.kind;
        if (c.oldPath) prev.oldPath = c.oldPath;
        prev.additions = (prev.additions ?? 0) + (s.additions ?? 0);
        prev.deletions = (prev.deletions ?? 0) + (s.deletions ?? 0);
        prev.binary = prev.binary || s.binary;
      } else {
        byPath.set(c.path, { ...c, ...s, commits: [sha] });
      }
      // a file touched earlier and moved away later is gone from its old place
      if (c.kind === 'R' && c.oldPath) {
        const moved = byPath.get(c.oldPath);
        if (moved && moved !== byPath.get(c.path)) {
          moved.kind = 'D';
          moved.commits = [...(moved.commits ?? []), sha];
        }
      }
    }
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export interface GitSourceRequest {
  repo: string;
  changes: { path: string; oldPath?: string }[];
  /** 'worktree' sends the files as they are on disk now; 'commit' sends the content at `rev`. */
  contentFrom: 'worktree' | 'commit';
  rev?: string;
}

/** Turns selected git changes into send sources: existing files are copied, vanished ones become deletions. */
export async function gitSources(req: GitSourceRequest): Promise<SourceSpec[]> {
  const root = normalizeAbs(req.repo);
  const paths: string[] = [];
  for (const c of req.changes) {
    paths.push(c.path);
    if (c.oldPath && c.oldPath !== c.path) paths.push(c.oldPath);
  }
  const uniq = [...new Set(paths)];
  const out: SourceSpec[] = [];
  if (req.contentFrom === 'worktree') {
    for (const p of uniq) {
      const abs = insideRepo(root, p);
      const st = await fsp.stat(abs).catch(() => null);
      out.push(st && !st.isDirectory() ? { kind: 'fs', path: abs } : { kind: 'delete', path: abs });
    }
    return out;
  }
  const rev = safeRev(req.rev || 'HEAD');
  const info = await blobInfo(root, rev, uniq);
  for (const p of uniq) {
    const abs = path.join(root, p);
    out.push(info.get(p) ? { kind: 'git', repo: root, rev, path: p } : { kind: 'delete', path: abs });
  }
  return out;
}

/** Blob id and size of each path at a revision (null when the path does not exist there). */
export async function blobInfo(root: string, rev: string, paths: string[]): Promise<Map<string, { blob: string; size: number } | null>> {
  const map = new Map<string, { blob: string; size: number } | null>();
  if (!paths.length) return map;
  safeRev(rev);
  const input = paths.map((p) => `${rev}:${p}`).join('\n') + '\n';
  const out = await gitText(root, ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], { input });
  const lines = out.split('\n');
  paths.forEach((p, i) => {
    const l = lines[i] ?? '';
    const m = /^([0-9a-f]{40,64}) (\w+) (\d+)$/.exec(l.trim());
    map.set(p, m && m[2] === 'blob' ? { blob: m[1], size: Number(m[3]) } : null);
  });
  return map;
}

/** Raw blob content at a revision. The stream errors (instead of ending short) when git fails. */
export function blobStream(root: string, rev: string, p: string): Readable {
  const out = new PassThrough();
  const child = spawn('git', ['cat-file', 'blob', `${safeRev(rev)}:${p}`], { cwd: root, windowsHide: true, env: gitEnv });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d.toString()));
  child.stdout.pipe(out, { end: false });
  child.on('error', (e) => out.destroy(e));
  child.on('close', (code) => {
    if (code === 0) out.end();
    else out.destroy(new GitError(t('git cat-file {object} başarısız (kod {code}): {error}', { object: `${rev}:${p}`, code: String(code), error: stderr.trim() }), stderr));
  });
  out.on('close', () => {
    if (child.exitCode === null) child.kill();
  });
  return out;
}

export async function showFile(root: string, rev: string, p: string): Promise<Buffer | null> {
  try {
    return await git(root, ['cat-file', 'blob', `${safeRev(rev)}:${p}`]);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- diffs

export function parseUnifiedDiff(text: string): { lines: DiffLine[]; additions: number; deletions: number; binary: boolean } {
  const lines: DiffLine[] = [];
  let a = 0;
  let b = 0;
  let additions = 0;
  let deletions = 0;
  let inHunk = false;
  let binary = false;
  for (const raw of text.split('\n')) {
    if (raw.startsWith('Binary files') || raw.startsWith('GIT binary patch')) binary = true;
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(raw);
    if (h) {
      a = Number(h[1]);
      b = Number(h[2]);
      inHunk = true;
      lines.push({ t: 'hunk', text: raw });
      continue;
    }
    if (!inHunk) continue;
    if (raw.startsWith('diff --git')) {
      inHunk = false;
      continue;
    }
    const c = raw[0];
    const body = raw.slice(1).replace(/\r$/, '');
    if (c === '+') {
      lines.push({ t: 'add', b: b++, text: body });
      additions++;
    } else if (c === '-') {
      lines.push({ t: 'del', a: a++, text: body });
      deletions++;
    } else if (c === ' ') {
      lines.push({ t: 'ctx', a: a++, b: b++, text: body });
    } else if (c === '\\') {
      // "\ No newline at end of file"
    }
  }
  return { lines, additions, deletions, binary };
}

export async function fileDiff(spec: GitDiffSpec): Promise<DiffResult> {
  const root = normalizeAbs(spec.repo);
  const pathspec = spec.oldPath && spec.oldPath !== spec.path ? [spec.oldPath, spec.path] : [spec.path];
  let args: string[];
  let leftLabel = '';
  let rightLabel = '';
  if (spec.mode === 'worktree') {
    const abs = insideRepo(root, spec.path);
    if (spec.oldPath) insideRepo(root, spec.oldPath);
    const tracked = (await gitText(root, ['ls-files', '--error-unmatch', '--', spec.path], { allowFail: true })).trim();
    const head = await hasHead(root);
    if (!tracked || !head) {
      // untracked: everything is an addition
      const buf = await fsp.readFile(abs).catch(() => null);
      if (!buf) return { ok: false, reason: t('Dosya okunamadı'), lines: [], additions: 0, deletions: 0 };
      return textDiff(Buffer.alloc(0), buf, { leftLabel: t('(yok)'), rightLabel: t('çalışma kopyası'), context: 3 });
    }
    args = ['diff', '--no-ext-diff', '-M', '-U4', 'HEAD', '--', ...pathspec];
    leftLabel = 'HEAD';
    rightLabel = t('çalışma kopyası');
  } else {
    const shas = spec.shas ?? [];
    if (!shas.length) return { ok: false, reason: t('Commit seçilmedi'), lines: [], additions: 0, deletions: 0 };
    const meta = await commitParents(root, shas);
    const ordered = orderOldestFirst(shas, meta);
    const from = meta.get(ordered[0])?.parent ?? EMPTY_TREE;
    const to = ordered[ordered.length - 1];
    args = ['diff', '--no-ext-diff', '-M', '-U4', from, to, '--', ...pathspec];
    leftLabel = from === EMPTY_TREE ? t('(boş)') : from.slice(0, 8);
    rightLabel = to.slice(0, 8);
  }
  const out = await git(root, args, { maxBuffer: MAX_DIFF_BYTES * 2 });
  if (out.length > MAX_DIFF_BYTES) return { ok: false, tooLarge: true, reason: t('Fark çok büyük (4 MB üstü)'), lines: [], additions: 0, deletions: 0, leftLabel, rightLabel };
  const parsed = parseUnifiedDiff(out.toString('utf8'));
  if (parsed.binary) return { ok: false, binary: true, reason: t('İkili dosya: satır farkı gösterilemez'), lines: [], additions: 0, deletions: 0, leftLabel, rightLabel };
  return { ok: true, lines: parsed.lines, additions: parsed.additions, deletions: parsed.deletions, identical: parsed.lines.length === 0, leftLabel, rightLabel };
}

/** Repositories that contain or live inside the local roots. */
export async function discoverRepos(roots: string[], extra: string[] = []): Promise<string[]> {
  const found = new Set<string>();
  for (const r of [...extra, ...roots]) {
    const root = await findRepoRoot(r);
    if (root) found.add(root);
  }
  return [...found];
}

export function repoRelative(root: string, abs: string): string | null {
  if (!isUnder(abs, root)) return null;
  return toPosix(normalizeAbs(abs).slice(normalizeAbs(root).length)).replace(/^\/+/, '');
}
