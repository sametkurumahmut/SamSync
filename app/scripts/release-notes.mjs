// The CHANGELOG section of one version, for the notes of its GitHub release: the update window in the app shows
// them. Without notes GitHub shows the tagged commit's message instead.
//   node scripts/release-notes.mjs <version|vX.Y.Z> [out-file]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const version = (process.argv[2] ?? '').replace(/^v/, '').trim();
if (!version) {
  console.error('usage: node scripts/release-notes.mjs <version> [out-file]');
  process.exit(2);
}
const lines = fs.readFileSync(path.join(here, '..', 'CHANGELOG.md'), 'utf8').replace(/\r\n/g, '\n').split('\n');
const start = lines.findIndex((l) => l === `## ${version}` || l.startsWith(`## ${version} `));
if (start < 0) {
  console.error(`CHANGELOG.md has no section for ${version}`);
  process.exit(1);
}
let end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
if (end < 0) end = lines.length;
const body = `${lines.slice(start + 1, end).join('\n').trim()}\n`;
if (process.argv[3]) fs.writeFileSync(process.argv[3], body);
else process.stdout.write(body);
