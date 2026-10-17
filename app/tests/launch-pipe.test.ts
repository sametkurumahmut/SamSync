import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { frameLaunchMessage, parseLaunchMessage, pipeName, startLaunchPipe, type LaunchMessage } from '../src/main/launchpipe';
import { parseLaunch } from '../src/main/launch';

const win = process.platform === 'win32';
const launcherExe = path.join(__dirname, '..', 'out', 'launcher', 'SamSyncSend.exe');

function listen(name: string): Promise<{ next: Promise<LaunchMessage>; close: () => void }> {
  return new Promise((resolve, reject) => {
    let got: (m: LaunchMessage) => void = () => undefined;
    const next = new Promise<LaunchMessage>((r) => (got = r));
    const server = startLaunchPipe((m) => got(m), reject, name);
    if (!server) return reject(new Error('no pipe here'));
    server.once('listening', () => resolve({ next, close: () => server.close() }));
  });
}

function sendRaw(name: string, data: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(name, () => sock.write(data));
    let reply = '';
    sock.on('data', (d) => (reply += d.toString()));
    sock.on('end', () => resolve(reply));
    sock.on('error', reject);
  });
}

describe('launch pipe', () => {
  it('frames and parses a message', () => {
    const m = { cwd: 'C:\\Users\\x', args: ['--send', '--to', 'PC1,PC2', 'C:\\Release\\Çalışma\\a.dll'] };
    const framed = frameLaunchMessage(m);
    expect(framed.readUInt32LE(0)).toBe(framed.length - 4);
    expect(parseLaunchMessage(framed.subarray(4))).toEqual(m);
    expect(parseLaunchMessage(Buffer.from('D:\\\0', 'utf8'))).toEqual({ cwd: 'D:\\', args: [] });
  });

  it.skipIf(!win)('hands a launch over and answers 1, also when the message arrives in pieces', async () => {
    const name = pipeName(`test-${process.pid}`);
    const p = await listen(name);
    try {
      const framed = frameLaunchMessage({ cwd: 'C:\\x', args: ['--send', '--to', 'all', 'C:\\x\\a.txt'] });
      const reply = await new Promise<string>((resolve, reject) => {
        const sock = net.connect(name, () => {
          sock.write(framed.subarray(0, 3));
          setTimeout(() => sock.write(framed.subarray(3)), 30);
        });
        let out = '';
        sock.on('data', (d) => (out += d.toString()));
        sock.on('end', () => resolve(out));
        sock.on('error', reject);
      });
      expect(reply).toBe('1');
      expect(await p.next).toEqual({ cwd: 'C:\\x', args: ['--send', '--to', 'all', 'C:\\x\\a.txt'] });
    } finally {
      p.close();
    }
  });

  it.skipIf(!win)('drops a message that claims an absurd length', async () => {
    const name = pipeName(`test-big-${process.pid}`);
    const p = await listen(name);
    try {
      const bad = Buffer.alloc(8);
      bad.writeUInt32LE(0xffffffff, 0);
      await expect(sendRaw(name, bad)).resolves.toBe('');
    } finally {
      p.close();
    }
  });

  it('resolves relative paths of a pipe launch against the sender’s folder', () => {
    const cwd = path.resolve(__dirname);
    const l = parseLaunch(['--send', '--to', 'PC1', '--yes', path.basename(__filename)], undefined, cwd);
    expect(l.paths).toEqual([path.join(cwd, path.basename(__filename))]);
    expect(l.targets).toEqual(['PC1']);
    expect(l.send).toBe(true);
  });

  it.skipIf(!win || !fs.existsSync(launcherExe))('the compiled SamSyncSend.exe hands its command line over (needs out/launcher)', async (ctx) => {
    // the program looks for the pipe of the current user: while a SamSync runs on this computer it holds that
    // pipe, and the launcher would hand the test's command line to it instead; nothing to test then
    let p: Awaited<ReturnType<typeof listen>>;
    try {
      p = await listen(pipeName());
    } catch (e) {
      ctx.skip(`another SamSync holds the launch pipe (${(e as Error).message})`);
      return;
    }
    try {
      const file = path.join(__dirname, 'helpers.ts');
      await new Promise<void>((resolve, reject) => execFile(launcherExe, ['--send', '--to', 'group:Lab-A', file], { cwd: __dirname }, (e) => (e ? reject(e) : resolve())));
      const m = await p.next;
      expect(m.args).toEqual(['--send', '--to', 'group:Lab-A', file]);
      expect(m.cwd.toLowerCase()).toBe(__dirname.toLowerCase());
    } finally {
      p.close();
    }
  });
});
