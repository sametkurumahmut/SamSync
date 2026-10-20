// Lists folders on a Windows network share with the operating system's own directory query, which returns every
// entry of a folder with its size and time in one round trip. Node's readdir gives names only, so the walk had to
// ask the share once more for every file (a stat each): twenty thousand files over Wi-Fi took minutes. A few
// PowerShell workers do the queries; the walk still decides folder by folder what to skip, so excluded branches
// (backup folders, ignored trees) are never listed.
import { spawn, type ChildProcess } from 'node:child_process';
import readline from 'node:readline';
import type { Entry } from './transport/types';
import { isWin } from './util';
import { t } from '../shared/i18n';

export interface Lister {
  /** The entries of one folder (names only, not full paths), like Transport.list but with sizes and times from the same query. */
  list(absDir: string): Promise<Entry[]>;
  close(): void;
}

const TICKS_EPOCH = 621355968000000000n; // .NET ticks at 1970-01-01

// Reads folder paths from stdin, one per line, and answers each with its entries and an end line.
// Field separator is a tab (not allowed in Windows file names); the stream is UTF-8 both ways.
const SCRIPT = `
[Console]::InputEncoding = [Text.Encoding]::UTF8
$out = New-Object IO.StreamWriter([Console]::OpenStandardOutput(), (New-Object Text.UTF8Encoding $false))
$out.AutoFlush = $false
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line.Length -eq 0) { continue }
  try {
    $dir = New-Object IO.DirectoryInfo($line)
    foreach ($e in $dir.EnumerateFileSystemInfos()) {
      $ticks = $e.LastWriteTimeUtc.Ticks
      if (($e.Attributes -band [IO.FileAttributes]::Directory) -ne 0) { $out.Write("D\`t0\`t$ticks\`t" + $e.Name + "\`n") }
      else { $out.Write("F\`t" + $e.Length + "\`t$ticks\`t" + $e.Name + "\`n") }
    }
    $out.Write("E\`n")
  } catch {
    $out.Write("X\`t" + $_.Exception.Message.Replace("\`n", " ").Replace("\`r", "") + "\`n")
  }
  $out.Flush()
}
`;

class Worker {
  private proc: ChildProcess;
  private rl: readline.Interface;
  private current: { entries: Entry[]; resolve: (e: Entry[]) => void; reject: (e: Error) => void } | null = null;
  busy = false;
  dead = false;

  constructor(private readonly onDead: (w: Worker) => void) {
    this.proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.rl = readline.createInterface({ input: this.proc.stdout! });
    this.rl.on('line', (line) => this.onLine(line));
    const gone = (err?: Error) => {
      this.dead = true;
      this.current?.reject(err ?? new Error(t('Klasör listeleyici beklenmedik biçimde kapandı')));
      this.current = null;
      this.onDead(this);
    };
    this.proc.on('error', gone);
    this.proc.on('exit', () => gone());
    this.proc.stderr?.resume();
  }

  private onLine(line: string) {
    const cur = this.current;
    if (!cur) return;
    const kind = line[0];
    if (kind === 'E') {
      this.current = null;
      this.busy = false;
      cur.resolve(cur.entries);
      return;
    }
    if (kind === 'X') {
      this.current = null;
      this.busy = false;
      cur.reject(new Error(line.slice(2)));
      return;
    }
    const parts = line.split('\t');
    if (parts.length < 4) return;
    const isDir = parts[0] === 'D';
    const size = isDir ? 0 : Number(parts[1]);
    const mtimeMs = Number((BigInt(parts[2]) - TICKS_EPOCH) / 10000n);
    const name = parts.slice(3).join('\t');
    cur.entries.push({ rel: name, isDir, size, mtimeMs });
  }

  list(absDir: string): Promise<Entry[]> {
    this.busy = true;
    return new Promise((resolve, reject) => {
      this.current = { entries: [], resolve, reject };
      this.proc.stdin!.write(absDir + '\n', (err) => {
        if (err) reject(err);
      });
    });
  }

  close() {
    this.dead = true;
    this.proc.stdin?.end();
    this.rl.close();
    setTimeout(() => this.proc.kill(), 2000).unref();
  }
}

/** A few workers share the queue: a network share answers several folder queries at once. */
export class WinLister implements Lister {
  private workers: Worker[] = [];
  private queue: { dir: string; resolve: (e: Entry[]) => void; reject: (e: Error) => void }[] = [];
  private closed = false;

  constructor(private readonly size = 4) {}

  list(absDir: string): Promise<Entry[]> {
    return new Promise((resolve, reject) => {
      this.queue.push({ dir: absDir, resolve, reject });
      this.pump();
    });
  }

  private pump() {
    if (this.closed) return;
    while (this.queue.length) {
      let w = this.workers.find((x) => !x.busy && !x.dead);
      if (!w && this.workers.length < this.size) {
        w = new Worker((d) => {
          this.workers = this.workers.filter((x) => x !== d);
          this.pump();
        });
        this.workers.push(w);
      }
      if (!w) return;
      const job = this.queue.shift()!;
      w.list(job.dir).then(job.resolve, job.reject).finally(() => this.pump());
    }
  }

  close() {
    this.closed = true;
    for (const j of this.queue) j.reject(new Error(t('İptal edildi')));
    this.queue = [];
    for (const w of this.workers) w.close();
    this.workers = [];
  }
}

/**
 * Whether a root is listed with the batched query: Windows network paths by default; SAMSYNC_FAST_LIST=always
 * turns it on for every path (tests), =0 turns it off.
 */
export function wantsFastList(root: string): boolean {
  if (!isWin) return false;
  const mode = process.env.SAMSYNC_FAST_LIST;
  if (mode === '0' || mode === 'off') return false;
  if (mode === 'always') return true;
  return /^\\\\[^\\]+\\/.test(root);
}
