import { isWin } from './util';

/**
 * Filter phrases, shared by the send screen and the folder sync jobs:
 *  - "*.tmp", "Logs", "desktop.ini"   no slash  -> matched against the item name, in any folder
 *  - "Data/Temp/", "bin/*.pdb"         with slash -> matched against the relative path from the root
 *  - trailing "/"                      directories only
 *  - "*" stays inside one path segment, "**" crosses folders, "?" is one character
 */
export interface FilterSpec {
  include?: string[];
  exclude?: string[];
  excludeFiles?: string[];
  excludeDirs?: string[];
  minSize?: number;
  maxSize?: number;
  /** Only files modified after this time (ms since epoch). */
  newerThan?: number;
  caseInsensitive?: boolean;
  /** Names that are always excluded at any level (backup folder). */
  alwaysExcludeDirs?: string[];
}

interface Rule {
  re: RegExp;
  dirOnly: boolean;
  byName: boolean;
}

function globToRegex(glob: string, ci: boolean): RegExp {
  let s = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') {
          i++;
          s += '(?:.*/)?';
        } else s += '.*';
      } else s += '[^/]*';
    } else if (c === '?') s += '[^/]';
    else s += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${s}$`, ci ? 'i' : '');
}

export function compileRules(patterns: readonly string[] | undefined, ci: boolean, forceDir = false): Rule[] {
  const out: Rule[] = [];
  for (let raw of patterns ?? []) {
    raw = raw.trim().replace(/\\/g, '/');
    if (!raw) continue;
    let dirOnly = forceDir;
    if (raw.endsWith('/')) {
      dirOnly = true;
      raw = raw.replace(/\/+$/, '');
    }
    raw = raw.replace(/^\/+/, '');
    if (!raw) continue;
    const byName = !raw.includes('/');
    out.push({ re: globToRegex(raw, ci), dirOnly, byName });
  }
  return out;
}

function matches(rules: Rule[], rel: string, isDir: boolean): boolean {
  if (!rules.length) return false;
  const name = rel.slice(rel.lastIndexOf('/') + 1);
  for (const r of rules) {
    if (r.dirOnly && !isDir) continue;
    if (r.re.test(r.byName ? name : rel)) return true;
  }
  return false;
}

export interface PathFilter {
  dir(rel: string): boolean;
  file(rel: string, size?: number, mtimeMs?: number): boolean;
  readonly isTrivial: boolean;
}

export function makeFilter(spec: FilterSpec = {}): PathFilter {
  const ci = spec.caseInsensitive ?? isWin;
  const include = compileRules((spec.include ?? []).filter((p) => p.trim() !== '*' && p.trim() !== '**'), ci);
  const exclude = compileRules(spec.exclude, ci);
  const exFiles = compileRules(spec.excludeFiles, ci);
  const exDirs = compileRules(spec.excludeDirs, ci, true);
  const always = compileRules(spec.alwaysExcludeDirs, ci, true);
  const isTrivial =
    !include.length && !exclude.length && !exFiles.length && !exDirs.length && spec.minSize == null && spec.maxSize == null && spec.newerThan == null;
  return {
    isTrivial,
    dir(rel) {
      if (!rel) return true;
      return !(matches(always, rel, true) || matches(exDirs, rel, true) || matches(exclude, rel, true));
    },
    file(rel, size, mtimeMs) {
      if (matches(exFiles, rel, false) || matches(exclude, rel, false)) return false;
      if (include.length && !matches(include, rel, false)) return false;
      if (size != null) {
        if (spec.minSize != null && size < spec.minSize) return false;
        if (spec.maxSize != null && size > spec.maxSize) return false;
      }
      if (spec.newerThan != null && mtimeMs != null && mtimeMs < spec.newerThan) return false;
      return true;
    },
  };
}

/** The filter plus folders left out only at the top of a scan (older backup folders found at a target root). */
export function withTopDirsExcluded(filter: PathFilter, names: readonly string[]): PathFilter {
  if (!names.length) return filter;
  const top = new Set(names.map((n) => n.toLowerCase()));
  return {
    isTrivial: false,
    dir: (rel) => !top.has(rel.toLowerCase()) && filter.dir(rel),
    file: (rel, size, mtimeMs) => filter.file(rel, size, mtimeMs),
  };
}

/** True when any ancestor folder of `rel` is excluded by the filter. */
export function ancestorExcluded(filter: PathFilter, rel: string): boolean {
  const parts = rel.split('/');
  for (let i = 1; i < parts.length; i++) if (!filter.dir(parts.slice(0, i).join('/'))) return true;
  return false;
}
