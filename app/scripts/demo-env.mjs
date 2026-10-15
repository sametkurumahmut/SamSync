// Creates a self-contained demo: a source tree, several "machines" (plain folders) with partly
// diverged content, and a config.json that points at them. Nothing outside the demo folder is touched.
//   node scripts/demo-env.mjs [folder] [extraLocalRoot]
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

const entity = (name, hp, extra = '') => `<?xml version="1.0" encoding="utf-8"?>\n<Entity name="${name}">\n  <Engine power="${hp}" torque="${hp * 4}" />\n  <Hydraulics pressure="320" flow="210" />\n  <Bucket capacity="1.4" />${extra}\n</Entity>\n`;
w(path.join(src, 'Data/EntityConfigurations/ModelHeavyIndustry/Ornek300LC.entity'), entity('Ornek300LC', 245, '\n  <Camera fov="72" />'), 1);
w(path.join(src, 'Data/EntityConfigurations/ModelHeavyIndustry/Komatsu D155.entity'), entity('Komatsu D155', 354), 3);
w(path.join(src, 'Data/EntityConfigurations/ModelHeavyIndustry/CAT 950.entity'), entity('CAT 950', 220), 8);
w(path.join(src, 'Data/EntityConfigurations/Vehicles/Truck_6x4.entity'), entity('Truck 6x4', 410), 2);
w(path.join(src, 'Data/Scenarios/Egitim_01.xml'), '<Scenario id="1" weather="clear" />\n', 5);
w(path.join(src, 'Data/Scenarios/Egitim_02.xml'), '<Scenario id="2" weather="rain" night="true" />\n', 0.2);
w(path.join(src, 'Config/settings.ini'), '[Display]\nWidth=3840\nHeight=1080\nVSync=1\n[Audio]\nVolume=80\n', 0.5);
w(path.join(src, 'Models/Excavator/arm.fbx'), Buffer.alloc(180_000, 7), 12);
w(path.join(src, 'Models/Excavator/bucket.fbx'), Buffer.alloc(96_000, 3), 2);
w(path.join(src, 'Audio/engine_idle.wav'), Buffer.alloc(420_000, 1), 20);

const machines = {
  'U1-Trainer': { group: 'Unit1', name: 'Eğitmen - 10.10.1.10' },
  'U1-IG1': { group: 'Unit1', name: 'IG1 - 10.10.1.11' },
  'U1-IG2': { group: 'Unit1', name: 'IG2 - 10.10.1.12' },
  'U1-IG3': { group: 'Unit1', name: 'IG3 - 10.10.1.13' },
  'U2-Trainer': { group: 'Unit2', name: 'Eğitmen - 10.10.1.30' },
  'U2-IG1': { group: 'Unit2', name: 'IG1 - 10.10.1.31' },
  'U2-IG2': { group: 'Unit2', name: 'IG2 - 10.10.1.32', missing: true },
  Arsiv: { name: 'Arşiv sunucusu' },
};
for (const [id, m] of Object.entries(machines)) if (!m.missing) fs.mkdirSync(path.join(tg, id), { recursive: true });

// U1-Trainer: fully in sync
for (const rel of ['Data/EntityConfigurations/ModelHeavyIndustry/Ornek300LC.entity', 'Data/EntityConfigurations/ModelHeavyIndustry/Komatsu D155.entity', 'Data/EntityConfigurations/ModelHeavyIndustry/CAT 950.entity', 'Data/EntityConfigurations/Vehicles/Truck_6x4.entity', 'Data/Scenarios/Egitim_01.xml', 'Data/Scenarios/Egitim_02.xml', 'Config/settings.ini', 'Models/Excavator/arm.fbx', 'Models/Excavator/bucket.fbx'])
  copy(rel, 'U1-Trainer');
// U1-IG1: older Ornek, missing scenario 2, an extra file
copy('Data/EntityConfigurations/ModelHeavyIndustry/Komatsu D155.entity', 'U1-IG1');
copy('Data/EntityConfigurations/ModelHeavyIndustry/CAT 950.entity', 'U1-IG1');
w(path.join(tg, 'U1-IG1/Data/EntityConfigurations/ModelHeavyIndustry/Ornek300LC.entity'), entity('Ornek300LC', 230), 6);
copy('Data/Scenarios/Egitim_01.xml', 'U1-IG1');
w(path.join(tg, 'U1-IG1/Data/Scenarios/Eski_Senaryo.xml'), '<Scenario id="0" />\n', 40);
w(path.join(tg, 'U1-IG1/Config/settings.ini'), '[Display]\nWidth=1920\nHeight=1080\nVSync=1\n[Audio]\nVolume=80\n', 30);
// U1-IG2: target has a newer Ornek (someone edited it there)
copy('Data/EntityConfigurations/ModelHeavyIndustry/Komatsu D155.entity', 'U1-IG2');
w(path.join(tg, 'U1-IG2/Data/EntityConfigurations/ModelHeavyIndustry/Ornek300LC.entity'), entity('Ornek300LC', 260, '\n  <Camera fov="80" />\n  <!-- yerinde düzenlendi -->'), 0.05);
// U1-IG3 and others: empty (everything new)

const nodes = [
  {
    id: 'Gelistirme',
    name: 'Geliştirme makinesi',
    address: os.hostname(),
    localNames: [os.hostname()],
    localRoots: [src, ...(extraRoot ? [extraRoot] : [])],
    networkRoot: 'Sim\\ActiveRelease',
    enabled: true,
  },
  ...Object.entries(machines).map(([id, m]) => ({
    id,
    name: m.name,
    ...(m.group ? { group: m.group } : {}),
    address: id.toLowerCase(),
    localRoots: ['C:\\Sim\\ActiveRelease'],
    networkRoot: 'Sim\\ActiveRelease',
    transport: 'path',
    path: path.join(tg, id),
    enabled: true,
  })),
];

const config = {
  schema: 2,
  nodes,
  copy: { retryCount: 1, waitSeconds: 1, backupKeep: 5, excludeFiles: ['*.tmp', 'Thumbs.db'], excludeDirs: ['.git', 'node_modules'] },
  profiles: [{ id: 'U1-IG', name: "Unit1 IG'ler", targetIds: ['U1-IG1', 'U1-IG2', 'U1-IG3'] }],
  syncJobs: [
    {
      id: 'job-data',
      name: 'Data → Unit1 Eğitmen',
      pairs: [{ id: 'p1', left: { kind: 'local', path: path.join(src, 'Data') }, right: { kind: 'node', nodeId: 'U1-IG1', subPath: 'Data' } }],
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
fs.writeFileSync(path.join(base, 'userdata', 'settings.json'), JSON.stringify({ configPath: path.join(base, 'config.json'), lastTargets: ['U1-IG1', 'U1-IG2', 'U1-IG3', 'U1-Trainer'] }, null, 2));
console.log(base);
