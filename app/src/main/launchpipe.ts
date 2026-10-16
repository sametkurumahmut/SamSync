// The named pipe a running SamSync listens on for launches from SamSyncSend.exe (the program the Explorer
// menu and the Notepad++ entries start). Handing the command line over through the pipe takes a few
// milliseconds; starting SamSync.exe for it would boot a whole second Electron process first.
//
// Message: a 4 byte little endian length, then UTF-8 "cwd\0arg1\0arg2\0...\0". The app answers "1" once it
// has the request, so the small program can exit.
import net from 'node:net';
import os from 'node:os';

export interface LaunchMessage {
  cwd: string;
  args: string[];
}

/** The user's account name, as GetUserName gives it to SamSyncSend.exe. */
function userName(): string {
  if (process.env.USERNAME) return process.env.USERNAME;
  try {
    return os.userInfo().username;
  } catch {
    return 'user';
  }
}

export function pipeName(user = userName()): string {
  return `\\\\.\\pipe\\SamSync-${user}`;
}

/** The payload after the length prefix: NUL separated UTF-8 strings, the working folder first. */
export function parseLaunchMessage(payload: Buffer): LaunchMessage {
  const parts = payload.toString('utf8').split('\0');
  if (parts[parts.length - 1] === '') parts.pop(); // the terminating NUL
  const [cwd = '', ...args] = parts;
  return { cwd, args };
}

/** Frames a message the way SamSyncSend.exe does (for tests and other callers). */
export function frameLaunchMessage(m: LaunchMessage): Buffer {
  const payload = Buffer.from([m.cwd, ...m.args].join('\0') + '\0', 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(payload.length, 0);
  return Buffer.concat([len, payload]);
}

const MAX_MESSAGE = 1024 * 1024;

/**
 * Listens on the pipe and hands every complete message to `onLaunch`. Windows only; elsewhere, or when the
 * name is taken (another SamSync of this user runs), nothing listens and the menus fall back to starting
 * the app itself.
 */
export function startLaunchPipe(onLaunch: (m: LaunchMessage) => void, onError: (e: Error) => void, name = pipeName()): net.Server | null {
  if (process.platform !== 'win32') return null;
  const server = net.createServer((sock) => {
    const chunks: Buffer[] = [];
    let size = 0;
    sock.on('data', (d: Buffer) => {
      chunks.push(d);
      size += d.length;
      const buf = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
      if (buf.length < 4) return;
      const need = buf.readUInt32LE(0);
      if (need > MAX_MESSAGE) {
        sock.destroy();
        return;
      }
      if (buf.length < 4 + need) return;
      sock.removeAllListeners('data');
      sock.end('1');
      onLaunch(parseLaunchMessage(buf.subarray(4, 4 + need)));
    });
    sock.on('error', () => undefined);
    sock.setTimeout(5000, () => sock.destroy());
  });
  server.on('error', onError);
  server.listen(name);
  return server;
}
