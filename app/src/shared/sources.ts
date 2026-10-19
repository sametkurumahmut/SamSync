import type { SourceSpec } from './types';

/** Send sources from plain paths, with the target path picked by hand where there is one. */
export function fsSources(paths: readonly string[], rels?: Record<string, string>): SourceSpec[] {
  return paths.map((p) => (rels && rels[p] !== undefined ? { kind: 'fs', path: p, rel: rels[p] } : { kind: 'fs', path: p }));
}

/** The picked target paths that belong to these paths, or undefined when there are none (what a quick send or a watch keeps). */
export function relsFor(paths: readonly string[], rels?: Record<string, string>): Record<string, string> | undefined {
  if (!rels) return undefined;
  const out: Record<string, string> = {};
  for (const p of paths) if (rels[p] !== undefined) out[p] = rels[p];
  return Object.keys(out).length ? out : undefined;
}

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/** The same local path, whatever the case and the kind of slash (paths from lists the user edits). */
export function samePath(a: string, b: string): boolean {
  return norm(a) === norm(b);
}

/** `p` is `folder` itself or lies below it. */
export function pathWithin(p: string, folder: string): boolean {
  const a = norm(p);
  const f = norm(folder);
  return a === f || a.startsWith(f + '/');
}
