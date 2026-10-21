// The programs running on this machine, and the ones that keep a target folder busy: those started from inside it
// (they hold their program files and libraries open, so a send cannot replace them) or named in Settings › Agent.
// Looked at about once a minute by the agent; one process list each time, nothing more.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { runPowerShell } from './command';

export interface Proc {
  pid: number;
  name: string;
  /** The program file, when the system says (Windows). */
  path?: string;
}

/** The running programs (pid, file name, program file). */
export async function listProcesses(): Promise<Proc[]> {
  if (process.platform === 'win32') {
    const out = await runPowerShell(String.raw`Get-CimInstance Win32_Process -Property ProcessId,Name,ExecutablePath | ForEach-Object { "$($_.ProcessId)|$($_.Name)|$($_.ExecutablePath)" }`, undefined, 20_000);
    return out
      .split(/\r?\n/)
      .map((l) => l.split('|'))
      .filter((p) => p.length >= 2 && /^\d+$/.test(p[0]))
      .map(([pid, name, exe]) => ({ pid: Number(pid), name, path: exe || undefined }));
  }
  return new Promise((resolve) => {
    execFile('ps', ['-A', '-o', 'pid=,comm='], { timeout: 10_000 }, (_e, stdout) => {
      const out: Proc[] = [];
      for (const line of String(stdout ?? '').split('\n')) {
        const m = /^\s*(\d+)\s+(.+)$/.exec(line);
        if (!m) continue;
        // Linux names the program only; its file is behind /proc (for the processes this user may look at)
        let file = m[2].includes('/') ? m[2].trim() : undefined;
        if (!file && process.platform === 'linux') {
          try {
            file = fs.readlinkSync(`/proc/${m[1]}/exe`);
          } catch {
            /* another user's process */
          }
        }
        out.push({ pid: Number(m[1]), name: path.basename(file ?? m[2].trim()), path: file });
      }
      resolve(out);
    });
  });
}

const under = (file: string, root: string) => {
  const f = path.resolve(file).toLowerCase();
  const r = path.resolve(root).toLowerCase().replace(/[\\/]+$/, '');
  return f.startsWith(r + path.sep) || f.startsWith(r + '/');
};

/** The programs that keep this root busy: started from inside it, or named in the list (file names, any case). */
export function busyPrograms(procs: Proc[], root: string, names: readonly string[] = []): Proc[] {
  const listed = new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean));
  const inside = (p: Proc) => !!p.path && under(p.path, root);
  const out = procs.filter((p) => p.pid !== process.pid && (inside(p) || listed.has(p.name.toLowerCase())));
  // the ones started from inside the folder first: they are what holds its files
  return out.sort((a, b) => Number(inside(b)) - Number(inside(a)) || a.name.localeCompare(b.name)).slice(0, 20);
}

/** The files below the root that these programs have open as program files and libraries (Windows), relative to it. */
export async function busyFiles(pids: number[], root: string): Promise<Record<number, string[]>> {
  if (process.platform !== 'win32' || !pids.length) return {};
  const script = String.raw`$root = [Console]::In.ReadToEnd().Trim()
$out = @{}
foreach ($id in @(${pids.map((p) => Number(p)).join(',')})) {
  $files = @()
  try { $files = @((Get-Process -Id $id -ErrorAction Stop).Modules | Where-Object { $_.FileName -and $_.FileName.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { $_.FileName }) } catch {}
  $out["$id"] = $files
}
ConvertTo-Json -InputObject $out -Depth 3 -Compress`;
  const raw = (await runPowerShell(script, path.resolve(root), 30_000)).trim();
  const obj = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  const res: Record<number, string[]> = {};
  for (const [pid, v] of Object.entries(obj)) {
    const list = (Array.isArray(v) ? v : v ? [v] : []) as string[];
    res[Number(pid)] = [...new Set(list.map((f) => path.relative(root, f).split(path.sep).join('/')))].sort().slice(0, 300);
  }
  return res;
}
