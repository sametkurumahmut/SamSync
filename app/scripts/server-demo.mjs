// Development aid for server mode: builds the app, gives a copy of the demo's data folder the web interface
// (127.0.0.1:8780, test password "samsync-demo") and starts the desktop app on it, so the browser side can be
// tried at http://127.0.0.1:8780. Needs the demo (npm run demo -- .demo) first.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const demo = path.join(root, '.demo');
const from = path.join(demo, 'userdata');
const ud = path.join(demo, 'server-userdata');
const PASSWORD = 'samsync-demo';
const PORT = Number(process.env.PORT || 8780);

if (!fs.existsSync(from)) {
  console.error('No demo: run  npm run demo -- .demo  first.');
  process.exit(1);
}
if (!process.argv.includes('--no-build')) {
  const r = spawnSync(path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'electron-vite.cmd' : 'electron-vite'), ['build'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
fs.rmSync(ud, { recursive: true, force: true });
fs.cpSync(from, ud, { recursive: true });
const settingsFile = path.join(ud, 'settings.json');
const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
// the same format as core/webserver.ts hashPassword
const salt = crypto.randomBytes(16);
const hash = crypto.scryptSync(PASSWORD, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
settings.webUi = { enabled: true, port: PORT, lan: false, passwordHash: `scrypt$${salt.toString('hex')}$${hash.toString('hex')}` };
fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));

console.log(`SamSync server mode demo: http://127.0.0.1:${PORT}  (password: ${PASSWORD})`);
const child = spawn(require('electron'), [root], { cwd: root, stdio: 'inherit', env: { ...process.env, SAMSYNC_USER_DATA: ud, SAMSYNC_NO_INTEGRATION: '1' } });
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill());
