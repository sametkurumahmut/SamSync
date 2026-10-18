// Takes the README screenshots from the demo environment, in both languages, with the built app:
//   npm run demo -- .demo "<repo path>"   (once)
//   node scripts/screenshots.mjs          → docs/screenshots/<lang>-<page>.png
// The demo gets a quick send and a relay machine with a fresh heartbeat first, so those show up.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const demo = path.join(root, '.demo');
const userData = path.join(demo, 'userdata');
const out = path.resolve(root, '..', 'docs', 'screenshots');
const bin = (name) => path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name);

const pages = ['overview', 'send', 'targets', 'compare', 'git', 'sync', 'automation', 'history'];
const langs = ['en', 'tr'];

function run(cmd, args, env = {}) {
  const r = spawnSync(cmd, args, { cwd: root, env: { ...process.env, ...env }, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} → ${r.status}`);
}

function prepareDemo() {
  const settingsFile = path.join(userData, 'settings.json');
  const configFile = path.join(demo, 'config.json');
  const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  // no "what's new" card over the pages
  settings.lastSeenVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  // a quick send on the Send page
  const src = path.join(demo, 'src', 'Data');
  settings.quickSends = [{ id: 'q-demo', name: 'Data → Lab-A', paths: [src], targetIds: config.nodes.filter((n) => n.group === 'Lab-A').map((n) => n.id), review: false }];
  // the Lab-A server is the relay of its group and "runs" SamSync (a fresh heartbeat)
  const server = config.nodes.find((n) => n.group === 'Lab-A' && /Server/i.test(n.id)) ?? config.nodes.find((n) => n.group === 'Lab-A');
  if (server) {
    server.relay = true;
    const dir = path.join(server.path, '_SamSyncRelay');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'alive.json'), JSON.stringify({ at: Date.now(), node: server.id }));
  }
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
  return { settingsFile, settings };
}

run(bin('electron-vite'), ['build']);
const { settingsFile, settings } = prepareDemo();
fs.mkdirSync(out, { recursive: true });
for (const lang of langs) {
  fs.writeFileSync(settingsFile, JSON.stringify({ ...settings, language: lang, theme: 'dark' }, null, 2));
  for (const page of pages) {
    const file = path.join(out, `${lang}-${page}.png`);
    fs.rmSync(file, { force: true });
    run(bin('electron'), ['.'], {
      SAMSYNC_NO_INTEGRATION: '1',
      SAMSYNC_USER_DATA: userData,
      SAMSYNC_ROUTE: page,
      SAMSYNC_SCREENSHOT: file,
      SAMSYNC_SCREENSHOT_EXIT: '1',
      // pages load lazily and probe the machines: a loaded computer needs the longer waits
      SAMSYNC_SCREENSHOT_DELAY: page === 'targets' || page === 'overview' ? '8000' : '5000',
    });
    console.log(`${file}: ${fs.existsSync(file) ? fs.statSync(file).size : 'MISSING'} bytes`);
  }
}
