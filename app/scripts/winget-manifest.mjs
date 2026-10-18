// Writes the winget manifests of a release (version, installer and the two locales) into
// packaging/winget/<version>/, ready to be proposed to microsoft/winget-pkgs:
//   node scripts/winget-manifest.mjs [version] [--installer <SamSync-Setup-x.y.z.exe>]
// The installer's SHA-256 is that of the file on the GitHub release (downloaded once; a local build is never the same
// bytes), or of a local file given with --installer. The repository is the one the git remote names. Nothing is uploaded.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const version = args.find((a) => /^\d+\.\d+\.\d+/.test(a)) ?? pkg.version;
const local = flag('--installer');

function repository() {
  const fromEnv = process.env.SAMSYNC_GH_REPOSITORY || process.env.GITHUB_REPOSITORY;
  if (fromEnv && /^[^/\s]+\/[^/\s]+$/.test(fromEnv)) return fromEnv.split('/');
  const url = execSync('git remote get-url origin', { cwd: root, encoding: 'utf8' }).trim();
  const m = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(url);
  if (!m) throw new Error(`not a GitHub remote: ${url}`);
  return [m[1], m[2]];
}

const [owner, repo] = repository();
const base = `https://github.com/${owner}/${repo}`;
const installerUrl = `${base}/releases/download/v${version}/SamSync-Setup-${version}.exe`;
let bytes;
if (local) {
  if (!fs.existsSync(local)) throw new Error(`Installer not found: ${local}`);
  bytes = fs.readFileSync(local);
} else {
  console.log(`Downloading ${installerUrl} for its SHA-256…`);
  const res = await fetch(installerUrl);
  if (!res.ok) throw new Error(`${installerUrl}: HTTP ${res.status} (is v${version} published?)`);
  bytes = Buffer.from(await res.arrayBuffer());
}
const sha = crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
// winget identifiers are Publisher.Name: the author's name without spaces
const id = `${String(pkg.author).replace(/[^A-Za-z0-9]/g, '')}.SamSync`;
const MV = '1.12.0';
const header = (type) => `# yaml-language-server: $schema=https://aka.ms/winget-manifest.${type}.${MV}.schema.json\n`;

const files = {
  [`${id}.yaml`]: `${header('version')}
PackageIdentifier: ${id}
PackageVersion: ${version}
DefaultLocale: en-US
ManifestType: version
ManifestVersion: ${MV}
`,
  [`${id}.installer.yaml`]: `${header('installer')}
PackageIdentifier: ${id}
PackageVersion: ${version}
InstallerType: nullsoft
InstallModes:
  - interactive
  - silent
  - silentWithProgress
UpgradeBehavior: install
FileExtensions:
  - samsync-pack
Installers:
  - Architecture: x64
    InstallerUrl: ${installerUrl}
    InstallerSha256: ${sha}
ManifestType: installer
ManifestVersion: ${MV}
`,
  [`${id}.locale.en-US.yaml`]: `${header('defaultLocale')}
PackageIdentifier: ${id}
PackageVersion: ${version}
PackageLocale: en-US
Publisher: ${pkg.author}
PublisherUrl: https://github.com/${owner}
PackageName: SamSync
PackageUrl: ${base}
License: GPL-3.0-only
LicenseUrl: ${base}/blob/HEAD/LICENSE
Copyright: Copyright (C) 2026 ${pkg.author}
ShortDescription: Send files, folders and Git changes to many machines at the same relative path; compare, sync and undo.
Description: |-
  SamSync copies files, folders and Git commits or local changes to many machines at once, at the same path relative to each
  machine's root. It compares before it writes, keeps backups so a send can be undone, syncs folders two-way, watches folders
  and sends what changes, and relays a send through one machine of a group to the others.
Tags:
  - file-sync
  - deployment
  - copy
  - smb
  - sftp
  - git
ReleaseNotesUrl: ${base}/releases/tag/v${version}
ManifestType: defaultLocale
ManifestVersion: ${MV}
`,
  [`${id}.locale.tr-TR.yaml`]: `${header('locale')}
PackageIdentifier: ${id}
PackageVersion: ${version}
PackageLocale: tr-TR
Publisher: ${pkg.author}
PackageName: SamSync
License: GPL-3.0-only
LicenseUrl: ${base}/blob/HEAD/LICENSE
ShortDescription: Dosyaları, klasörleri ve Git değişikliklerini birden çok makineye aynı göreli yolla gönderir; karşılaştırır, eşitler, geri alır.
ManifestType: locale
ManifestVersion: ${MV}
`,
};

const out = path.resolve(root, '..', 'packaging', 'winget', version);
fs.mkdirSync(out, { recursive: true });
for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(out, name), text);
console.log(`${id} ${version}\n  installer sha256 ${sha} (${(bytes.length / 1048576).toFixed(1)} MB)\n  → ${out}`);
console.log(`Check with: winget validate --manifest "${out}"   then propose it to microsoft/winget-pkgs (manifests/${id[0].toLowerCase()}/${id.replace('.', '/')}/${version}).`);
