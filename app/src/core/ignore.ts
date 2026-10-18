// .samsyncignore: exclusions kept next to the files they are about, so every job and every send of that folder
// honours them without repeating them in each filter. One pattern per line with the filter's own phrases
// ("*.tmp", "Logs/", "bin/*.pdb"); "#" starts a comment line, blank lines are skipped.
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import type { Transport } from './transport';
import { joinRoot, relJoin } from './paths';
import { errMessage } from './util';
import { t } from '../shared/i18n';

export const IGNORE_FILE = '.samsyncignore';

/** Larger than any sensible list; a bigger file is read up to here. */
const MAX_BYTES = 1024 * 1024;

export function parseIgnore(text: string): string[] {
  return text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

async function readText(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of stream as AsyncIterable<Buffer>) {
    chunks.push(c);
    n += c.length;
    if (n >= MAX_BYTES) {
      stream.destroy();
      break;
    }
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * The patterns of the ignore file in a folder of a transport (a sync side, local or on a target machine).
 * A missing file means no patterns; a file that is there but cannot be read is an error, since going on
 * without its patterns could delete what it protects.
 */
export async function readIgnore(tport: Transport, dirRel = ''): Promise<string[]> {
  const rel = relJoin(dirRel, IGNORE_FILE);
  const st = await tport.stat(rel);
  if (!st || st.isDir) return [];
  try {
    return parseIgnore(await readText(await tport.readStream(rel)));
  } catch (e) {
    throw new Error(t('{path} okunamadı: {error}', { path: joinRoot(tport.root, rel), error: errMessage(e) }));
  }
}

/** The patterns of the ignore file in a local folder. */
export async function readLocalIgnore(dir: string): Promise<string[]> {
  const file = path.join(dir, IGNORE_FILE);
  let text: string;
  try {
    text = await fsp.readFile(file, 'utf8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR') return [];
    throw new Error(t('{path} okunamadı: {error}', { path: file, error: errMessage(e) }));
  }
  return parseIgnore(text);
}

/**
 * Ignore patterns as the send's exclude lists: a trailing "/" means a folder only, any other pattern
 * leaves out a file or a folder of that name or path, as it does in a sync filter.
 */
export function ignoreExcludes(patterns: readonly string[]): { excludeFiles: string[]; excludeDirs: string[] } {
  const excludeFiles: string[] = [];
  const excludeDirs: string[] = [];
  for (const p of patterns) {
    excludeDirs.push(p);
    if (!p.replace(/\\/g, '/').endsWith('/')) excludeFiles.push(p);
  }
  return { excludeFiles, excludeDirs };
}
