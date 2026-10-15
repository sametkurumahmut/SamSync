// Publishes the Windows installer to a shared folder so machines without internet can update:
//   npm run release:folder -- "\\dosya-sunucusu\Dagitim\SamSync"
// Copies latest.yml, the NSIS installer and its blockmap from release/<version>/. latest.yml is
// copied last, so clients never see a version whose installer is not there yet.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2];
if (!target) {
  console.error('Kullanım: npm run release:folder -- <klasör>');
  process.exit(1);
}
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const dir = path.join(root, 'release', version);
const yml = path.join(dir, 'latest.yml');
if (!fs.existsSync(yml)) {
  console.error(`${yml} yok. Önce "npm run dist:win" çalıştırın.`);
  process.exit(1);
}
const installer = /^path:\s*(.+)$/m.exec(fs.readFileSync(yml, 'utf8'))?.[1]?.trim().replace(/^['"]|['"]$/g, '');
if (!installer || !fs.existsSync(path.join(dir, installer))) {
  console.error('latest.yml içindeki kurulum dosyası bulunamadı.');
  process.exit(1);
}
fs.mkdirSync(target, { recursive: true });
for (const f of [installer, `${installer}.blockmap`]) {
  if (!fs.existsSync(path.join(dir, f))) continue;
  fs.copyFileSync(path.join(dir, f), path.join(target, f));
  console.log(`kopyalandı: ${f}`);
}
fs.copyFileSync(yml, path.join(target, 'latest.yml'));
console.log(`kopyalandı: latest.yml  →  ${target}  (v${version})`);
