// The CHANGELOG section of one version, for the notes of its GitHub release: English first (CHANGELOG.md), then
// the Turkish (CHANGELOG.tr.md) folded under a "Türkçe" heading. The update window in the app shows the part in
// its own language (shared/releasenotes.ts). Without notes GitHub shows the tagged commit's message instead.
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

/** The body of the version's section in one changelog, or null when it has none. */
function section(file) {
  const full = path.join(here, '..', file);
  if (!fs.existsSync(full)) return null;
  const lines = fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((l) => l === `## ${version}` || l.startsWith(`## ${version} `));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  if (end < 0) end = lines.length;
  return lines.slice(start + 1, end).join('\n').trim();
}

const en = section('CHANGELOG.md');
if (!en) {
  // a release page is English first: a version without its English notes is not released
  console.error(`CHANGELOG.md has no section for ${version}`);
  process.exit(1);
}
const tr = section('CHANGELOG.tr.md');
const body = tr ? `${en}\n\n<details>\n<summary>Türkçe</summary>\n\n${tr}\n\n</details>\n` : `${en}\n`;
if (process.argv[3]) fs.writeFileSync(process.argv[3], body);
else process.stdout.write(body);
