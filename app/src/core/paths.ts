import path from 'node:path';
import type { OutsideRoots, SourcePlace } from '../shared/types';
import { t } from '../shared/i18n';
import { isWin } from './util';

/** Normalises an absolute local path: resolves it and strips trailing separators (except for roots). */
export function normalizeAbs(p: string): string {
  let r = path.resolve(p.trim());
  const root = path.parse(r).root;
  while (r.length > root.length && (r.endsWith('\\') || r.endsWith('/'))) r = r.slice(0, -1);
  return r;
}

export function pathKey(p: string): string {
  const n = normalizeAbs(p);
  return isWin ? n.toLowerCase() : n;
}

export function relKey(rel: string, caseInsensitive = isWin): string {
  return caseInsensitive ? rel.toLowerCase() : rel;
}

export function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

export function relJoin(...parts: string[]): string {
  return parts
    .map((p) => toPosix(p).replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
}

export function relParent(rel: string): string {
  const i = rel.lastIndexOf('/');
  return i < 0 ? '' : rel.slice(0, i);
}

export function relBase(rel: string): string {
  const i = rel.lastIndexOf('/');
  return i < 0 ? rel : rel.slice(i + 1);
}

export function relDepth(rel: string): number {
  return rel ? rel.split('/').length : 0;
}

/** True when `child` equals `parent` or lives below it (both POSIX rel paths). */
export function relIsWithin(child: string, parent: string, caseInsensitive = isWin): boolean {
  if (!parent) return true;
  const c = relKey(child, caseInsensitive);
  const p = relKey(parent, caseInsensitive);
  return c === p || c.startsWith(p + '/');
}

/** Is `abs` equal to `root` or below it? */
export function isUnder(abs: string, root: string): boolean {
  const a = pathKey(abs);
  const r = pathKey(root);
  if (a === r) return true;
  const withSep = r.endsWith(path.sep) ? r : r + path.sep;
  return a.startsWith(withSep);
}

export interface RelMapping {
  rel: string;
  root?: string;
  outside: boolean;
}

/**
 * Maps an absolute local path to the relative path it gets under every target root.
 * The longest matching local root wins. Items outside every root keep their full path with the
 * drive turned into a folder (C:\Fraps\a -> C/Fraps/a, \\srv\share\a -> UNC/srv/share/a), exactly
 * like the PowerShell tool did, so existing target layouts stay valid.
 */
export function mapToRel(abs: string, localRoots: readonly string[]): RelMapping {
  const n = normalizeAbs(abs);
  let best: string | undefined;
  for (const root of localRoots) {
    if (!root) continue;
    if (isUnder(n, root) && (!best || normalizeAbs(root).length > normalizeAbs(best).length)) best = root;
  }
  if (best) {
    const r = normalizeAbs(best);
    const rel = toPosix(n.slice(r.length)).replace(/^\/+/, '');
    return { rel, root: r, outside: false };
  }
  return { rel: outsideRel(n), outside: true };
}

function outsideRel(n: string): string {
  const unc = /^\\\\([^\\]+)\\(.*)$/.exec(n);
  if (unc) return relJoin('UNC', unc[1], toPosix(unc[2]));
  const drive = /^([A-Za-z]):[\\/]?(.*)$/.exec(n);
  if (drive) return relJoin(drive[1].toUpperCase(), toPosix(drive[2]));
  return relJoin('ROOT', toPosix(n));
}

export interface SourceMapping extends RelMapping {
  /** Outside every root: the local folder that stands for the target root. */
  base?: string;
  /** Outside every root and placed with its whole path, the drive as a folder (the old tool's way). */
  full?: boolean;
}

/**
 * Where a source lands on every target. Under a local root it keeps its path below that root. Outside every
 * root it is placed by default as if its own folder were a root: a folder's content goes straight into the
 * target root, a file into the root by its name. `outside: 'fullPath'` keeps the old way instead (the whole
 * path with the drive as a folder). A `rel` picked by hand on the Send page wins over both.
 */
export function mapSource(abs: string, localRoots: readonly string[], isDir: boolean, outside: OutsideRoots = 'own', rel?: string): SourceMapping {
  const m = mapToRel(abs, localRoots);
  if (rel !== undefined) {
    const r = cleanRel(rel);
    if (!m.outside) return { ...m, rel: r };
    const place = outsidePlaces(abs, isDir).find((p) => relKey(p.rel) === relKey(r));
    return { rel: r, outside: true, base: place?.base, full: place?.full };
  }
  if (!m.outside) return m;
  if (outside === 'fullPath') return { ...m, full: true };
  const n = normalizeAbs(abs);
  return isDir ? { rel: '', outside: true, base: n } : { rel: path.basename(n), outside: true, base: path.dirname(n) };
}

/**
 * The places a source outside every root can take on the targets: one for its own folder (a file: the folder
 * it is in) and one for every folder above it as the stand-in for the target root, then its full path.
 */
export function outsidePlaces(abs: string, isDir: boolean): SourcePlace[] {
  const n = normalizeAbs(abs);
  const out: SourcePlace[] = [];
  let base = isDir ? n : path.dirname(n);
  for (;;) {
    out.push({ rel: toPosix(path.relative(base, n)), base });
    const up = path.dirname(base);
    if (up === base) break;
    base = up;
  }
  out.push({ rel: outsideRel(n), full: true });
  return out;
}

/** A target path given by hand, made plain: forward slashes, no leading or trailing slash, no "." parts; ".." is refused. */
export function cleanRel(rel: string): string {
  const parts = toPosix(rel).split('/').filter((p) => p && p !== '.');
  if (parts.includes('..')) throw new Error(t('Geçersiz hedef yolu: {rel}', { rel }));
  return parts.join('/');
}

/** Joins a target root with a POSIX rel path using the separator style of the root. */
export function joinRoot(root: string, rel: string): string {
  if (!rel) return root;
  const winStyle = /^\\\\|^[A-Za-z]:/.test(root) || (root.includes('\\') && !root.includes('/'));
  if (winStyle) return root.replace(/[\\/]+$/, '') + '\\' + rel.split('/').join('\\');
  return root.replace(/\/+$/, '') + '/' + rel;
}

/** Shortens long paths for display: C:\...\Data\x.entity */
export function shortPath(p: string, max = 60): string {
  if (p.length <= max) return p;
  const sep = p.includes('\\') ? '\\' : '/';
  const parts = p.split(/[\\/]/);
  if (parts.length <= 3) return p.slice(0, max - 1) + '…';
  const head = parts[0];
  let tail = parts[parts.length - 1];
  for (let i = parts.length - 2; i > 0; i--) {
    const cand = parts[i] + sep + tail;
    if (head.length + cand.length + 5 > max) break;
    tail = cand;
  }
  return `${head}${sep}…${sep}${tail}`;
}

/** Common directory of several absolute paths, or '' when they share none. */
export function commonDir(paths: readonly string[]): string {
  if (!paths.length) return '';
  const split = paths.map((p) => normalizeAbs(p).split(/[\\/]/));
  const first = split[0];
  let n = first.length - (paths.length === 1 ? 1 : 0);
  for (const s of split.slice(1)) {
    let i = 0;
    while (i < n && i < s.length && (isWin ? s[i].toLowerCase() === first[i].toLowerCase() : s[i] === first[i])) i++;
    n = i;
  }
  if (n === 0) return '';
  const sep = isWin ? '\\' : '/';
  const joined = first.slice(0, n).join(sep);
  return joined || sep;
}
