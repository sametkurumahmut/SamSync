// Bundles scripts/web-entry.ts (core + HTTP bridge) with esbuild and starts it.
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outfile = path.join(root, 'out/web/entry.mjs');
await build({
  entryPoints: [path.join(root, 'scripts/web-entry.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile,
  packages: 'external',
  logLevel: 'warning',
});
await import(pathToFileURL(outfile).href);
