import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export type Level = 'INFO' | 'WARN' | 'ERROR';

export interface Logger {
  info(component: string, message: string): void;
  warn(component: string, message: string): void;
  error(component: string, message: string, err?: unknown): void;
  readonly file: string;
}

const MAX_BYTES = 5 * 1024 * 1024;
const KEEP = 3;

/** Append-only text log (root.log) with the same line format as the PowerShell tool, rotated at 5 MB. */
export function createLogger(dir: string): Logger {
  const file = path.join(dir, 'root.log');
  const runId = randomBytes(4).toString('hex');
  let queue: string[] = [];
  let writing = false;
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* logging must never break the app */
  }

  const flush = async () => {
    if (writing || !queue.length) return;
    writing = true;
    const batch = queue.join('');
    queue = [];
    try {
      const st = await fsp.stat(file).catch(() => null);
      if (st && st.size > MAX_BYTES) {
        for (let i = KEEP; i >= 1; i--) {
          const from = i === 1 ? file : path.join(dir, `root.${i - 1}.log`);
          await fsp.rename(from, path.join(dir, `root.${i}.log`)).catch(() => undefined);
        }
      }
      await fsp.appendFile(file, batch, 'utf8');
    } catch {
      /* ignore */
    }
    writing = false;
    if (queue.length) void flush();
  };

  const write = (level: Level, component: string, message: string) => {
    const d = new Date();
    const p = (n: number, w = 2) => String(n).padStart(w, '0');
    const ts = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
    queue.push(`${ts} [${level.padEnd(5)}] [${runId}] [${component}] ${message}\n`);
    void flush();
  };

  return {
    file,
    info: (c, m) => write('INFO', c, m),
    warn: (c, m) => write('WARN', c, m),
    error: (c, m, e) => write('ERROR', c, e ? `${m}: ${e instanceof Error ? e.stack || e.message : String(e)}` : m),
  };
}

export const nullLogger: Logger = { file: '', info() {}, warn() {}, error() {} };
