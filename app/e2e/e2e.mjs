// End-to-end check of the built app (Electron, driven by Playwright): the three flows a user cannot do without,
// on a throw-away demo environment, and an accessibility scan (axe-core) of the main pages.
//   1. send: a launch with a folder and --to group:Lab-A (the Explorer menu's way) opens the review; Send;
//      the files are on every Lab-A machine afterwards
//   2. compare: the same sources against the same machines show no differences any more
//   3. undo: the History page takes the send back from its backups; the machines hold their old files again
//   4. axe: no critical accessibility violations on Overview, Send, Targets, History and Settings
// Usage: npm run e2e  (builds first; --no-build to reuse out/). Exit code 1 on any failure, with screenshots
// in e2e-results/.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = path.join(root, 'e2e-results');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const bin = (name) => path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name);

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' && cmd.endsWith('.cmd') });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} → ${r.status}`);
}

/** Every file below a folder with its content, relative path → text. */
function snapshot(dir) {
  const out = {};
  const walk = (d, rel) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('_SamSync') || e.name.startsWith('samsync-')) continue;
      const p = path.join(d, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(p, r);
      else out[r] = fs.readFileSync(p, 'utf8');
    }
  };
  walk(dir, '');
  return out;
}

const failures = [];
const step = async (name, fn) => {
  const t0 = Date.now();
  try {
    await fn();
    console.log(`✓ ${name} (${Date.now() - t0} ms)`);
  } catch (e) {
    failures.push(name);
    console.error(`✗ ${name}: ${e?.stack ?? e}`);
    throw e;
  }
};

if (!process.argv.includes('--no-build')) run(bin('electron-vite'), ['build']);
fs.rmSync(results, { recursive: true, force: true });
fs.mkdirSync(results, { recursive: true });

// ---------------------------------------------------------------- a demo of our own
const demo = fs.mkdtempSync(path.join(os.tmpdir(), 'samsync-e2e-'));
run(process.execPath, [path.join(root, 'scripts', 'demo-env.mjs'), demo]);
const userData = path.join(demo, 'userdata');
const settingsFile = path.join(userData, 'settings.json');
const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
// English UI (stable labels), backups on (so the send can be undone), no what's-new card, nothing asks first
fs.writeFileSync(settingsFile, JSON.stringify({ ...settings, language: 'en', theme: 'dark', sendDefaults: { backup: true, notify: false }, lastSeenVersion: pkg.version, confirmBeforeRun: false, closeRunPanelOnSuccess: false }, null, 2));
const config = JSON.parse(fs.readFileSync(path.join(demo, 'config.json'), 'utf8'));
const labA = config.nodes.filter((n) => n.group === 'Lab-A');
const src = path.join(demo, 'src', 'Data');
const before = Object.fromEntries(labA.map((n) => [n.id, snapshot(path.join(n.path, 'Data'))]));
const source = snapshot(src);

const app = await electron.launch({
  executablePath: require('electron'),
  // Linux CI runners cannot use Chromium's sandbox (no SUID helper, user namespaces restricted)
  args: [...(process.platform === 'linux' ? ['--no-sandbox'] : []), root, src, '--to', 'group:Lab-A'],
  cwd: root,
  env: { ...process.env, SAMSYNC_USER_DATA: userData, SAMSYNC_NO_INTEGRATION: '1' },
  timeout: 60_000,
});
const page = await app.firstWindow();
page.setDefaultTimeout(30_000);
page.on('dialog', (d) => void d.accept());
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

try {
  await step('the launch opens the review of a send to Lab-A', async () => {
    await page.getByRole('dialog').getByRole('button', { name: 'Send', exact: true }).waitFor();
  });

  await step('send: every Lab-A machine holds the source afterwards', async () => {
    await page.getByRole('dialog').getByRole('button', { name: 'Send', exact: true }).click();
    await page.getByText('Completed successfully').waitFor({ timeout: 60_000 });
    for (const n of labA) {
      const now = snapshot(path.join(n.path, 'Data'));
      for (const [rel, text] of Object.entries(source)) {
        if (/\.tmp$|Thumbs\.db$/.test(rel)) continue;
        if (now[rel] !== text) throw new Error(`${n.id}: ${rel} differs after the send`);
      }
    }
    await page.keyboard.press('Escape');
  });

  await step('compare: the same sources show no differences now', async () => {
    await page.keyboard.press('Control+3');
    const run = page.locator('main .page-head').getByRole('button', { name: 'Compare', exact: true });
    await run.waitFor();
    await run.click();
    await page.getByText('No comparison yet').waitFor({ state: 'detached', timeout: 60_000 });
    // one chip per target, none of them with changes
    for (const n of labA) await page.getByRole('button', { name: new RegExp(`^${n.name.split(' - ')[0]}`) }).first().waitFor();
    const body = await page.locator('main').innerText();
    if (/\b[1-9]\d* (new|changed)\b/i.test(body)) throw new Error('the comparison still lists changes:\n' + body.slice(0, 600));
  });

  await step('undo: History takes the send back from its backups', async () => {
    await page.keyboard.press('Control+9');
    const undo = page.getByRole('button', { name: 'Restore', exact: true });
    await undo.waitFor();
    await undo.click();
    // the app asks in its own dialog, not the browser's
    await page.getByRole('dialog', { name: 'SamSync' }).getByRole('button', { name: 'OK', exact: true }).click();
    await page.getByText('Completed successfully').waitFor({ timeout: 60_000 });
    for (const n of labA) {
      const now = snapshot(path.join(n.path, 'Data'));
      const was = before[n.id];
      for (const [rel, text] of Object.entries(was)) if (now[rel] !== text) throw new Error(`${n.id}: ${rel} did not come back`);
      for (const rel of Object.keys(now)) if (!(rel in was)) throw new Error(`${n.id}: ${rel} was created by the send and is still there`);
    }
    await page.keyboard.press('Escape');
  });

  await step('accessibility: no critical or serious axe-core violations on the main pages', async () => {
    const axe = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
    // the smallest window the app allows: lists overflow there, as on a CI runner's small screen
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.unmaximize();
      w.setSize(980, 620);
    });
    const report = [];
    for (const [key, name] of [
      ['1', 'overview'],
      ['2', 'send'],
      ['7', 'targets'],
      ['9', 'history'],
      [',', 'settings'],
    ]) {
      await page.keyboard.press(`Control+${key}`);
      await page.waitForTimeout(1500);
      // through the DevTools protocol: the app's Content Security Policy forbids inline scripts, rightly
      if (!(await page.evaluate(() => 'axe' in window))) await page.evaluate(`${axe}
;true`);
      const v = await page.evaluate(async () => {
        const r = await axe.run(document, { resultTypes: ['violations'] });
        return r.violations.map((x) => ({ id: x.id, impact: x.impact, help: x.help, nodes: x.nodes.length, sample: x.nodes[0]?.target?.join(' ') }));
      });
      report.push({ page: name, violations: v });
      await page.screenshot({ path: path.join(results, `${name}.png`) });
    }
    fs.writeFileSync(path.join(results, 'axe.json'), JSON.stringify(report, null, 2));
    const critical = report.flatMap((r) => r.violations.filter((x) => x.impact === 'critical' || x.impact === 'serious').map((x) => `${r.page}: ${x.id} (${x.nodes}) ${x.sample ?? ''}`));
    const serious = report.flatMap((r) => r.violations.filter((x) => x.impact === 'serious').map((x) => `${r.page}: ${x.id} (${x.nodes})`));

    if (critical.length) throw new Error(`critical violations:\n  ${critical.join('\n  ')}`);
  });

  if (errors.length) throw new Error(`the page threw:\n${errors.join('\n')}`);
} catch {
  await page.screenshot({ path: path.join(results, 'failure.png') }).catch(() => undefined);
} finally {
  await app.close().catch(() => undefined);
  fs.rmSync(demo, { recursive: true, force: true });
}

if (failures.length || errors.length) {
  console.error(`\nE2E failed: ${[...failures, ...(errors.length ? ['page errors'] : [])].join(', ')} (screenshots in ${results})`);
  process.exit(1);
}
console.log('\nE2E passed');
