// Builds the app and runs electron-builder with the GitHub repository taken from the environment
// (SAMSYNC_GH_REPOSITORY or GITHUB_REPOSITORY in CI, "owner/repo") or the git remote, so no repository
// name is written in the sources. Arguments go to electron-builder:  node scripts/dist.mjs --win
import { execSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLauncher } from './build-launcher.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = (name) => path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name);

function repository() {
  const fromEnv = process.env.SAMSYNC_GH_REPOSITORY || process.env.GITHUB_REPOSITORY;
  if (fromEnv && /^[^/\s]+\/[^/\s]+$/.test(fromEnv)) return fromEnv.split('/');
  try {
    const url = execSync('git remote get-url origin', { cwd: root, encoding: 'utf8' }).trim();
    const m = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(url);
    if (m) return [m[1], m[2]];
  } catch {
    /* no git or no remote */
  }
  return null;
}

const repo = repository();
const args = process.argv.slice(2);
if (!repo) {
  console.warn('GitHub deposu bulunamadı: GitHub güncellemeleri bu pakette kapalı olacak.');
  if (!args.some((a) => a.startsWith('--publish'))) args.push('--publish', 'never');
}
const env = { ...process.env, SAMSYNC_GH_OWNER: repo?.[0] ?? 'none', SAMSYNC_GH_REPO: repo?.[1] ?? 'none' };
console.log(`GitHub: ${repo ? repo.join('/') : '-'}`);

const run = (cmd, a) => {
  const r = spawnSync(cmd, a, { cwd: root, env, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run(bin('electron-vite'), ['build']);
// the small program the Windows menus start (needs the Visual C++ compiler; skipped without it)
buildLauncher();
run(bin('electron-builder'), args);
