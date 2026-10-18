// Removes English entries whose Turkish key is no longer used, from whichever src/shared/i18n/en/*.ts holds them.
// usage: node scripts/rm-en.cjs   with a JSON array of Turkish keys on stdin
const fs = require('fs');
const path = require('path');
const keys = JSON.parse(fs.readFileSync(0, 'utf8'));
const dir = path.join(__dirname, '..', 'src', 'shared', 'i18n', 'en');
const q = (v) => v.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
let removed = 0;
for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.ts') && n !== 'index.ts')) {
  const p = path.join(dir, f);
  const s = fs.readFileSync(p, 'utf8');
  const nl = s.includes('\r\n') ? '\r\n' : '\n';
  const lines = s.split(nl);
  const keep = lines.filter((line) => {
    const m = /^  (?:'((?:\\.|[^'])*)'|([A-Za-z_][A-Za-z0-9_]*)): /.exec(line);
    if (!m) return true;
    const k = m[1] != null ? m[1] : m[2];
    const hit = keys.some((key) => q(key) === k || key === k);
    if (hit) removed++;
    return !hit;
  });
  if (keep.length !== lines.length) fs.writeFileSync(p, keep.join(nl));
}
console.log(`removed ${removed} of ${keys.length}`);
if (removed !== keys.length) process.exit(1);
