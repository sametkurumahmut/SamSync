import type { SourceInfo } from './types';
import { pathWithin } from './sources';

/** `child` is `parent` itself or below it (target paths, case-insensitive). */
function relWithin(child: string, parent: string): boolean {
  if (!parent) return true;
  const c = child.toLowerCase();
  const p = parent.toLowerCase();
  return c === p || c.startsWith(p + '/');
}

export interface Coverage {
  /** Parts of this folder's place on the targets that other sources take over (relative to the targets' root). */
  without: string[];
  /** Other sources that go to the very same place and get merged with this one. */
  mergedWith: string[];
}

/**
 * What the Send page says under a source when sources overlap on the targets: a folder from elsewhere that lands
 * inside this one's place takes that part over, and two folders for the same place are merged. A source that lies
 * inside this folder on disk is part of it and needs no note.
 */
export function coverageOf(i: SourceInfo, all: SourceInfo[]): Coverage | null {
  if (!i.isDir || i.pack || i.locked || !i.exists) return null;
  const without: string[] = [];
  const mergedWith: string[] = [];
  for (const o of all) {
    if (o === i || !o.exists || o.pack || o.locked) continue;
    if (pathWithin(o.path, i.path)) continue;
    if (o.rel.toLowerCase() === i.rel.toLowerCase()) {
      if (o.isDir) mergedWith.push(o.path);
      continue;
    }
    if (relWithin(o.rel, i.rel)) without.push(o.rel);
  }
  if (!without.length && !mergedWith.length) return null;
  return { without: without.sort((a, b) => a.localeCompare(b)), mergedWith };
}
