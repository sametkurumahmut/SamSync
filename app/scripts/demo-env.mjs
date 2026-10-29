// Creates a self-contained demo: a source tree, several "machines" (plain folders) with partly
// diverged content, and a config.json that points at them. Nothing outside the demo folder is touched.
// The names are deliberately generic (two labs of PCs, a NAS): the README screenshots come from here.
//   node scripts/demo-env.mjs [folder] [extraLocalRoot]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const base = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'samsync-demo'));
const extraRoot = process.argv[3];
fs.rmSync(base, { recursive: true, force: true });
const src = path.join(base, 'src');
const tg = path.join(base, 'targets');
const day = 86400_000;

function w(file, content, ageDays = 0) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  const t = new Date(Date.now() - ageDays * day);
  fs.utimesSync(file, t, t);
}
function copy(rel, target, ageDays) {
  const from = path.join(src, rel);
  const to = path.join(tg, target, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  if (ageDays != null) {
    const t = new Date(Date.now() - ageDays * day);
    fs.utimesSync(to, t, t);
  } else {
    const st = fs.statSync(from);
    fs.utimesSync(to, st.atime, st.mtime);
  }
}

const catalog = (version, items, extra = '') => `{\n  "version": "${version}",\n  "currency": "EUR",\n  "items": [\n${items.map((i) => `    { "sku": "${i[0]}", "name": "${i[1]}", "price": ${i[2]} }`).join(',\n')}\n  ]${extra}\n}\n`;
const ITEMS = [
  ['A-100', 'Base unit', 1290],
  ['A-200', 'Extended unit', 1890],
  ['B-010', 'Mounting kit', 145],
];
w(path.join(src, 'Data/Catalog/products.json'), catalog('3.4', ITEMS, ',\n  "updated": "2026-10-16"'), 1);
w(path.join(src, 'Data/Catalog/prices.csv'), 'sku;price;valid_from\nA-100;1290;2026-10-01\nA-200;1890;2026-10-01\nB-010;145;2026-09-15\n', 3);
w(path.join(src, 'Data/Catalog/regions.json'), '{ "regions": ["EU", "TR", "US"] }\n', 8);
w(path.join(src, 'Data/Profiles/default.json'), '{ "theme": "dark", "language": "auto", "units": "metric" }\n', 2);
w(path.join(src, 'Data/Reports/2026-09.xml'), '<Report month="2026-09" rows="1840" />\n', 5);
w(path.join(src, 'Data/Reports/2026-10.xml'), '<Report month="2026-10" rows="2210" draft="true" />\n', 0.2);
w(path.join(src, 'Config/settings.ini'), '[Display]\nWidth=3840\nHeight=1080\nVSync=1\n[Audio]\nVolume=80\n', 0.5);
w(path.join(src, 'Models/Vehicle/body.obj'), Buffer.alloc(180_000, 7), 12);
w(path.join(src, 'Models/Vehicle/wheels.obj'), Buffer.alloc(96_000, 3), 2);
w(path.join(src, 'Audio/startup.wav'), Buffer.alloc(420_000, 1), 20);

const machines = {
  'A-Server': { group: 'Lab-A', name: 'Server - 10.10.1.10' },
  'A-PC1': { group: 'Lab-A', name: 'PC-1 - 10.10.1.11' },
  'A-PC2': { group: 'Lab-A', name: 'PC-2 - 10.10.1.12' },
  'A-PC3': { group: 'Lab-A', name: 'PC-3 - 10.10.1.13' },
  'B-Server': { group: 'Lab-B', name: 'Server - 10.10.1.30' },
  'B-PC1': { group: 'Lab-B', name: 'PC-1 - 10.10.1.31' },
  'B-PC2': { group: 'Lab-B', name: 'PC-2 - 10.10.1.32', missing: true },
  NAS: { name: 'NAS - 10.10.1.5' },
};
for (const [id, m] of Object.entries(machines)) if (!m.missing) fs.mkdirSync(path.join(tg, id), { recursive: true });

// A-Server: fully in sync
for (const rel of ['Data/Catalog/products.json', 'Data/Catalog/prices.csv', 'Data/Catalog/regions.json', 'Data/Profiles/default.json', 'Data/Reports/2026-09.xml', 'Data/Reports/2026-10.xml', 'Config/settings.ini', 'Models/Vehicle/body.obj', 'Models/Vehicle/wheels.obj'])
  copy(rel, 'A-Server');
// A-PC1: an older catalog, no report for this month, an extra old report, older display settings
copy('Data/Catalog/prices.csv', 'A-PC1');
copy('Data/Catalog/regions.json', 'A-PC1');
w(path.join(tg, 'A-PC1/Data/Catalog/products.json'), catalog('3.3', ITEMS.slice(0, 2)), 6);
copy('Data/Reports/2026-09.xml', 'A-PC1');
w(path.join(tg, 'A-PC1/Data/Reports/2025-12.xml'), '<Report month="2025-12" rows="990" />\n', 40);
w(path.join(tg, 'A-PC1/Config/settings.ini'), '[Display]\nWidth=1920\nHeight=1080\nVSync=1\n[Audio]\nVolume=80\n', 30);
// A-PC2: the catalog is newer there (someone edited it on the machine)
copy('Data/Catalog/prices.csv', 'A-PC2');
w(path.join(tg, 'A-PC2/Data/Catalog/products.json'), catalog('3.4', [...ITEMS, ['C-001', 'Edited locally', 99]], ',\n  "updated": "2026-10-17"'), 0.05);
// A-PC3 and the rest: empty (everything new)

// A short Git history in the source tree for the Git page (generic files, inside this machine's root): three commits
// that end at today's catalog and prices, the display settings changed since and this month's report not added yet.
// Every file keeps its content and date, so the other pages look the same. Skipped when git is not installed.
function demoGit() {
  const who = { GIT_AUTHOR_NAME: 'Demo', GIT_AUTHOR_EMAIL: 'demo@example.com', GIT_COMMITTER_NAME: 'Demo', GIT_COMMITTER_EMAIL: 'demo@example.com' };
  const git = (args, daysAgo = 0) => {
    const at = new Date(Date.now() - daysAgo * day).toISOString();
    return spawnSync('git', args, { cwd: src, stdio: 'ignore', env: { ...process.env, ...who, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at } }).status === 0;
  };
  if (!git(['init', '-q', '-b', 'main'])) return;
  const now = new Map();
  for (const rel of ['Data/Catalog/products.json', 'Data/Catalog/prices.csv', 'Config/settings.ini']) {
    now.set(rel, { data: fs.readFileSync(path.join(src, rel)), at: fs.statSync(path.join(src, rel)).mtime });
  }
  const back = (rel) => {
    const f = path.join(src, rel);
    fs.writeFileSync(f, now.get(rel).data);
    fs.utimesSync(f, now.get(rel).at, now.get(rel).at);
  };
  fs.writeFileSync(path.join(src, 'Data/Catalog/products.json'), catalog('3.3', ITEMS.slice(0, 2)));
  fs.writeFileSync(path.join(src, 'Data/Catalog/prices.csv'), 'sku;price;valid_from\nA-100;1250;2026-09-01\nA-200;1850;2026-09-01\n');
  fs.writeFileSync(path.join(src, 'Config/settings.ini'), '[Display]\nWidth=1920\nHeight=1080\nVSync=1\n[Audio]\nVolume=80\n');
  git(['add', '-A', '--', '.', ':(exclude)Data/Reports/2026-10.xml']);
  git(['commit', '-q', '-m', 'Initial data, models and settings'], 9);
  back('Data/Catalog/prices.csv');
  git(['add', 'Data/Catalog/prices.csv']);
  git(['commit', '-q', '-m', 'Update the price list'], 3);
  back('Data/Catalog/products.json');
  git(['add', 'Data/Catalog/products.json']);
  git(['commit', '-q', '-m', 'Catalog 3.4: add the mounting kit'], 1);
  back('Config/settings.ini');
}
demoGit();

const nodes = [
  {
    id: 'Dev',
    name: 'Dev-PC',
    address: os.hostname(),
    localNames: [os.hostname()],
    localRoots: [src, ...(extraRoot ? [extraRoot] : [])],
    networkRoot: 'Share\\Release',
    enabled: true,
  },
  ...Object.entries(machines).map(([id, m]) => ({
    id,
    name: m.name,
    ...(m.group ? { group: m.group } : {}),
    address: id.toLowerCase(),
    localRoots: ['D:\\Release'],
    networkRoot: 'Share\\Release',
    transport: 'path',
    path: path.join(tg, id),
    enabled: true,
  })),
];

const config = {
  schema: 2,
  nodes,
  copy: { retryCount: 1, waitSeconds: 1, backupKeep: 5, excludeFiles: ['*.tmp', 'Thumbs.db'], excludeDirs: ['.git', 'node_modules'] },
  profiles: [{ id: 'A-PCs', name: 'Lab-A PCs', targetIds: ['A-PC1', 'A-PC2', 'A-PC3'] }],
  syncJobs: [
    {
      id: 'job-data',
      name: 'Data ⇄ Lab-A PC-1',
      pairs: [{ id: 'p1', left: { kind: 'local', path: path.join(src, 'Data') }, right: { kind: 'node', nodeId: 'A-PC1', subPath: 'Data' } }],
      compare: 'timeSize',
      variant: 'mirror',
      filter: { include: [], exclude: [] },
      deletion: 'versioning',
      versioningKeep: 5,
    },
  ],
};
fs.mkdirSync(path.join(base, 'userdata'), { recursive: true });
fs.writeFileSync(path.join(base, 'config.json'), JSON.stringify(config, null, 2));
fs.writeFileSync(path.join(base, 'userdata', 'settings.json'), JSON.stringify({ configPath: path.join(base, 'config.json'), lastTargets: ['A-PC1', 'A-PC2', 'A-PC3', 'A-Server'] }, null, 2));
console.log(base);
