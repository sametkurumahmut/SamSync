// Appends English entries to one of the src/shared/i18n/en/*.ts files, keeping its line endings.
// usage: node scripts/add-en.cjs <part>   with a JSON array of [turkish, english] pairs on stdin
const fs = require('fs');
const path = require('path');
const part = process.argv[2];
const entries = JSON.parse(fs.readFileSync(0, 'utf8'));
const p = path.join(__dirname, '..', 'src', 'shared', 'i18n', 'en', `${part}.ts`);
let s = fs.readFileSync(p, 'utf8');
const nl = s.includes('\r\n') ? '\r\n' : '\n';
const marker = `};${nl}${nl}export default d;`;
if (!s.includes(marker)) throw new Error('marker not found in ' + p);
const q = (v) => "'" + v.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
const block = entries.map(([k, v]) => `  ${/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? k : q(k)}: ${q(v)},`).join(nl);
s = s.replace(marker, `${block}${nl}${marker}`);
fs.writeFileSync(p, s);
console.log(`${part}: +${entries.length}`);
