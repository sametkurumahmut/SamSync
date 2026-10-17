// Smoke test of the packaged app: starts the unpacked build once, lets it take a screenshot of its own
// window (SAMSYNC_SCREENSHOT) and refuses a window that is blank, which is what a broken main bundle looks
// like (2.0.1 shipped that way). Run after `dist`: `node scripts/smoke.mjs [--dir <unpacked dir>]`.
// The release workflow runs it on every platform before the draft release is published.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const argDir = (() => {
  const i = process.argv.indexOf('--dir');
  return i >= 0 ? path.resolve(process.argv[i + 1]) : null;
})();

/** The unpacked build electron-builder left for this platform, and its executable. */
function findBinary() {
  const out = path.join(root, 'release', pkg.version);
  const candidates = argDir ? [argDir] : fs.existsSync(out) ? fs.readdirSync(out).map((n) => path.join(out, n)).filter((p) => fs.statSync(p).isDirectory()) : [];
  for (const dir of candidates) {
    if (process.platform === 'win32') {
      const exe = path.join(dir, 'SamSync.exe');
      if (fs.existsSync(exe)) return exe;
    } else if (process.platform === 'darwin') {
      const apps = fs.readdirSync(dir).filter((n) => n.endsWith('.app'));
      for (const app of apps) {
        const bin = path.join(dir, app, 'Contents', 'MacOS', 'SamSync');
        if (fs.existsSync(bin)) return bin;
      }
    } else {
      const bin = path.join(dir, 'samsync');
      if (fs.existsSync(bin)) return bin;
    }
  }
  return null;
}

// ---- a PNG reader just big enough to tell a blank picture from a page (8-bit RGB/RGBA, no interlace)
function readPng(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const depth = data[8];
      const color = data[9];
      if (depth !== 8 || data[12] !== 0) throw new Error(`unsupported PNG (depth ${depth}, interlace ${data[12]})`);
      channels = color === 6 ? 4 : color === 2 ? 3 : color === 4 ? 2 : 1;
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const px = Buffer.alloc(height * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = px.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 0xff;
    }
    prev = cur;
  }
  return { width, height, channels, px };
}

/** Distinct colours over a grid of samples, and the share of the most common one. */
function judge(img) {
  const counts = new Map();
  let n = 0;
  const step = Math.max(1, Math.floor(Math.sqrt((img.width * img.height) / 20000)));
  for (let y = 0; y < img.height; y += step)
    for (let x = 0; x < img.width; x += step) {
      const i = (y * img.width + x) * img.channels;
      const key = (img.px[i] << 16) | (img.px[i + 1] << 8) | img.px[i + 2];
      counts.set(key, (counts.get(key) ?? 0) + 1);
      n++;
    }
  let top = 0;
  for (const c of counts.values()) top = Math.max(top, c);
  return { distinct: counts.size, dominant: top / n, samples: n };
}

async function main() {
  const bin = findBinary();
  if (!bin) {
    console.error(`smoke: no unpacked build found under release/${pkg.version} (run dist first)`);
    process.exit(2);
  }
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'samsync-smoke-'));
  const shot = path.join(userData, 'window.png');
  console.log(`smoke: starting ${bin}`);
  const env = {
    ...process.env,
    SAMSYNC_USER_DATA: userData,
    SAMSYNC_NO_INTEGRATION: '1',
    SAMSYNC_SCREENSHOT: shot,
    SAMSYNC_SCREENSHOT_EXIT: '1',
    SAMSYNC_SCREENSHOT_DELAY: '4000',
    SAMSYNC_ROUTE: 'targets',
  };
  const args = process.platform === 'linux' ? ['--no-sandbox'] : [];
  const child = spawn(bin, args, { env, stdio: ['ignore', 'inherit', 'inherit'] });
  const code = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      console.error('smoke: the app did not quit within 90 s');
      child.kill();
      resolve(-1);
    }, 90_000);
    child.on('exit', (c) => {
      clearTimeout(timer);
      resolve(c ?? 0);
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      console.error(`smoke: could not start: ${e.message}`);
      resolve(-2);
    });
  });
  if (!fs.existsSync(shot)) {
    console.error(`smoke: no screenshot was written (exit code ${code})`);
    if (code === 0) console.error('smoke: an exit code of 0 without a window usually means another SamSync held the single instance lock for the same data folder');
    process.exit(1);
  }
  const img = readPng(shot);
  const v = judge(img);
  const outDir = path.join(root, 'release', pkg.version);
  fs.mkdirSync(outDir, { recursive: true });
  const keep = path.join(outDir, `smoke-${process.platform}.png`);
  fs.copyFileSync(shot, keep);
  console.log(`smoke: ${img.width}×${img.height}, ${v.distinct} colours over ${v.samples} samples, dominant ${(v.dominant * 100).toFixed(1)}% → ${keep}`);
  // a page has text, borders and badges: well over a hundred colours; a blank window has one or two
  if (v.distinct < 40 || v.dominant > 0.97) {
    console.error('smoke: the window looks blank');
    process.exit(1);
  }
  console.log('smoke: ok');
  fs.rmSync(userData, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(`smoke: ${e.message}`);
  process.exit(1);
});
