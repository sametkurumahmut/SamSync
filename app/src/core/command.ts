import { spawn } from 'node:child_process';
import { isWin } from './util';

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
