import { spawn } from 'node:child_process';
import { isWin } from './util';

/** The first error of PowerShell's standard error, which comes as CLIXML when its output is redirected. */
function psError(err: string): string {
  if (!err.startsWith('#< CLIXML')) return err.trim().split(/\r?\n/)[0];
  const m = /<S S="Error">(.*?)<\/S>/.exec(err);
  return (m?.[1] ?? '').replace(/_x000D__x000A_/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
}

/**
 * Runs a PowerShell script on this Windows machine and returns what it printed (UTF-8). The script goes in encoded,
 * so no quoting gets in its way; `input` is written to its standard input (read it with [Console]::In.ReadToEnd()).
 */
export function runPowerShell(script: string, input?: string, timeoutMs = 30_000): Promise<string> {
  const full = `$ProgressPreference = 'SilentlyContinue'; [Console]::OutputEncoding = [Text.Encoding]::UTF8; [Console]::InputEncoding = [Text.Encoding]::UTF8\n${script}`;
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(full, 'utf16le').toString('base64')], { windowsHide: true });
    const out: Buffer[] = [];
    let err = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(out).toString('utf8'));
      else reject(new Error(psError(err) || `powershell exit ${code}`));
    });
    child.stdin.end(input ?? '');
  });
}

/** Runs a shell command on this machine and waits for it; `ok` when it exited with 0 within the time given. */
export function runLocalCommand(cmd: string, timeoutSec: number): Promise<{ ok: boolean; code: number | null; output: string; timedOut: boolean; error?: string }> {
  return new Promise((resolve) => {
    const child = isWin ? spawn('cmd.exe', ['/d', '/s', '/c', cmd], { windowsHide: true, windowsVerbatimArguments: true }) : spawn('sh', ['-c', cmd]);
    let out = '';
    let timedOut = false;
    child.stdout?.on('data', (d) => (out += d.toString()));
    child.stderr?.on('data', (d) => (out += d.toString()));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutSec * 1000);
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, code: null, output: out, timedOut, error: e.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0 && !timedOut, code, output: out.trim().split(/\r?\n/).slice(-5).join(' | '), timedOut });
    });
  });
}
