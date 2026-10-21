// Which programs hold files open on this Windows machine, from the Restart Manager (what installers ask before they
// replace files), and closing those programs on request. Asked for the files a send could not replace.
import { execFile } from 'node:child_process';
import path from 'node:path';
import type { FileHolder } from '../shared/types';
import { runPowerShell } from './command';
import { sleep } from './util';
import { t } from '../shared/i18n';

/** The files of one question; more are not worth the wait (the run window shows the first ones). */
export const HOLDERS_MAX_FILES = 60;

const SCRIPT = String.raw`$paths = ConvertFrom-Json ([Console]::In.ReadToEnd())
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class SamSyncRm {
  [StructLayout(LayoutKind.Sequential)] struct FILETIME { public uint Low; public uint High; }
  [StructLayout(LayoutKind.Sequential)] struct RM_UNIQUE_PROCESS { public int dwProcessId; public FILETIME ProcessStartTime; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct RM_PROCESS_INFO {
    public RM_UNIQUE_PROCESS Process;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string strAppName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string strServiceShortName;
    public int ApplicationType; public uint AppStatus; public uint TSSessionId;
    [MarshalAs(UnmanagedType.Bool)] public bool bRestartable;
  }
  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)] static extern int RmStartSession(out uint h, int flags, string key);
  [DllImport("rstrtmgr.dll")] static extern int RmEndSession(uint h);
  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)] static extern int RmRegisterResources(uint h, uint nFiles, string[] files, uint nApps, RM_UNIQUE_PROCESS[] apps, uint nSvc, string[] svcs);
  [DllImport("rstrtmgr.dll")] static extern int RmGetList(uint h, out uint needed, ref uint n, [In, Out] RM_PROCESS_INFO[] info, ref uint reasons);
  public static string[] Holders(string file) {
    uint h; var res = new List<string>();
    if (RmStartSession(out h, 0, Guid.NewGuid().ToString()) != 0) return res.ToArray();
    try {
      if (RmRegisterResources(h, 1, new[] { file }, 0, null, 0, null) != 0) return res.ToArray();
      uint needed = 0, n = 0, reasons = 0;
      if (RmGetList(h, out needed, ref n, null, ref reasons) == 234 && needed > 0) {
        var info = new RM_PROCESS_INFO[needed]; n = needed;
        if (RmGetList(h, out needed, ref n, info, ref reasons) == 0)
          for (int i = 0; i < n; i++) res.Add(info[i].Process.dwProcessId + "|" + info[i].strAppName);
      }
    } finally { RmEndSession(h); }
    return res.ToArray();
  }
}
'@
$out = @{}
foreach ($p in $paths) {
  $list = @()
  foreach ($x in [SamSyncRm]::Holders($p)) {
    $i = $x.IndexOf('|'); $procId = [int]$x.Substring(0, $i)
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    $list += ,@{ pid = $procId; app = $x.Substring($i + 1); name = $(if ($proc) { $proc.ProcessName + '.exe' } else { '' }); path = $(if ($proc) { $proc.Path } else { '' }) }
  }
  $out[$p] = $list
}
ConvertTo-Json -InputObject $out -Depth 4 -Compress`;

/** Absolute path -> the programs holding it open; empty where nothing does or the system cannot tell (not Windows). */
export async function whoHolds(files: string[]): Promise<Record<string, FileHolder[]>> {
  if (process.platform !== 'win32' || !files.length) return {};
  const out = (await runPowerShell(SCRIPT, JSON.stringify(files.slice(0, HOLDERS_MAX_FILES)), 60_000)).trim();
  const raw = out ? (JSON.parse(out) as Record<string, unknown>) : {};
  const res: Record<string, FileHolder[]> = {};
  for (const [file, v] of Object.entries(raw)) {
    const list = (Array.isArray(v) ? v : v ? [v] : []) as { pid: number; app?: string; name?: string; path?: string }[];
    res[file] = list.map((x) => ({ pid: Number(x.pid), name: x.name || x.app || String(x.pid), app: x.app || undefined, path: x.path || undefined }));
  }
  return res;
}

/** The programs holding these files below a root, one entry per program with the files it holds. */
export async function holdersUnder(root: string, rels: string[]): Promise<(FileHolder & { rels: string[] })[]> {
  const abs = new Map(rels.slice(0, HOLDERS_MAX_FILES).map((r) => [path.join(root, ...r.split('/')), r] as const));
  const found = await whoHolds([...abs.keys()]);
  const byPid = new Map<number, FileHolder & { rels: string[] }>();
  for (const [file, list] of Object.entries(found)) {
    for (const h of list) {
      const e = byPid.get(h.pid) ?? { ...h, closable: closable(h), rels: [] };
      e.rels.push(abs.get(file) ?? file);
      byPid.set(h.pid, e);
    }
  }
  return [...byPid.values()].sort((a, b) => b.rels.length - a.rels.length);
}

/** Programs that are never closed from here: the system's own, and the shell the user works in. */
const PROTECTED = new Set(['system', 'smss.exe', 'csrss.exe', 'wininit.exe', 'winlogon.exe', 'services.exe', 'lsass.exe', 'svchost.exe', 'explorer.exe', 'dwm.exe', 'fontdrvhost.exe']);

export function closable(h: FileHolder): boolean {
  return h.pid > 4 && h.pid !== process.pid && !PROTECTED.has(h.name.toLowerCase()) && !/samsync/i.test(h.name);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const taskkill = (args: string[]) => new Promise<void>((resolve) => execFile('taskkill', args, { windowsHide: true }, () => resolve()));

/** Asks the programs to close (as the window's close button would), then ends the ones still there after `graceMs`. */
export async function closePrograms(holders: FileHolder[], graceMs = 6000): Promise<{ closed: number[]; failed: { pid: number; name: string; error: string }[] }> {
  const closed: number[] = [];
  const failed: { pid: number; name: string; error: string }[] = [];
  const list = holders.filter((h) => {
    if (closable(h)) return true;
    failed.push({ pid: h.pid, name: h.name, error: t('Bu program buradan kapatılmaz') });
    return false;
  });
  for (const h of list) {
    if (process.platform === 'win32') await taskkill(['/PID', String(h.pid)]);
    else {
      try {
        process.kill(h.pid, 'SIGTERM');
      } catch {
        /* gone already */
      }
    }
  }
  const until = Date.now() + graceMs;
  while (list.some((h) => alive(h.pid)) && Date.now() < until) await sleep(300);
  for (const h of list) {
    if (alive(h.pid)) {
      if (process.platform === 'win32') await taskkill(['/F', '/PID', String(h.pid)]);
      else {
        try {
          process.kill(h.pid, 'SIGKILL');
        } catch {
          /* gone meanwhile */
        }
      }
      await sleep(500);
    }
    if (alive(h.pid)) failed.push({ pid: h.pid, name: h.name, error: t('Kapatılamadı (yetki yetmiyor olabilir)') });
    else closed.push(h.pid);
  }
  return { closed, failed };
}
