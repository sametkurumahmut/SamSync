// A sync job as a file of its own, to move one job between configurations without editing config.json:
//   { "samsyncSyncJob": 1, "job": { ... } }
import type { Endpoint, SyncJob } from '../shared/types';
import { randomBytes } from 'node:crypto';
import { t } from '../shared/i18n';

export const JOB_FILE_VERSION = 1;

/** The file text. The schedule's machine is left out: it names a machine of the configuration it came from. */
export function jobFileText(job: SyncJob): string {
  const out: SyncJob = { ...job };
  if (out.schedule) {
    const { machineId: _m, ...schedule } = out.schedule;
    out.schedule = schedule;
  }
  return `${JSON.stringify({ samsyncSyncJob: JOB_FILE_VERSION, job: out }, null, 2)}\n`;
}

function isEndpoint(e: unknown): e is Endpoint {
  const x = e as Record<string, unknown> | null;
  if (!x || typeof x !== 'object') return false;
  if (x.kind === 'local') return typeof x.path === 'string';
  return x.kind === 'node' && typeof x.nodeId === 'string';
}

/**
 * The job of a job file, ready to append to `existing`: a new id when its id is taken, a name that is not
 * taken yet, no last run. A schedule runs on this machine (`localNodeId`); when this machine is unknown it
 * is switched off, since a schedule without a machine would run on every machine sharing the configuration.
 */
export function jobFromFile(raw: unknown, existing: readonly SyncJob[], localNodeId?: string): SyncJob {
  const r = raw as Record<string, any> | null;
  const j = r && typeof r === 'object' ? (r.job as Record<string, any> | undefined) : undefined;
  if (!r || r.samsyncSyncJob !== JOB_FILE_VERSION || !j || typeof j !== 'object') throw new Error(t('Bu dosya bir SamSync senkron işi değil.'));
  const pairs = Array.isArray(j.pairs) ? j.pairs : [];
  if (!pairs.length || !pairs.every((p: any) => p && isEndpoint(p.left) && isEndpoint(p.right))) throw new Error(t('Senkron işinin klasör çiftleri eksik ya da bozuk.'));

  const ids = new Set(existing.map((x) => x.id));
  let id = typeof j.id === 'string' && j.id.trim() ? j.id.trim() : '';
  while (!id || ids.has(id)) id = `job-${randomBytes(3).toString('hex')}`;

  const names = new Set(existing.map((x) => x.name.trim().toLowerCase()));
  const base = (typeof j.name === 'string' && j.name.trim()) || t('İçe aktarılan iş');
  let name = base;
  for (let n = 2; names.has(name.toLowerCase()); n++) name = `${base} (${n})`;

  const filter = j.filter && typeof j.filter === 'object' ? j.filter : {};
  const job: SyncJob = {
    ...(j as SyncJob),
    id,
    name,
    pairs: pairs.map((p: any, i: number) => ({ ...p, id: typeof p.id === 'string' && p.id ? p.id : `p${i + 1}` })),
    compare: j.compare ?? 'timeSize',
    variant: j.variant ?? 'mirror',
    filter: { ...filter, include: Array.isArray(filter.include) ? filter.include : [], exclude: Array.isArray(filter.exclude) ? filter.exclude : [] },
    deletion: j.deletion ?? 'versioning',
    versioningKeep: typeof j.versioningKeep === 'number' ? j.versioningKeep : 5,
  };
  delete job.lastRun;
  if (job.schedule) {
    const { machineId: _m, ...schedule } = job.schedule;
    job.schedule = localNodeId ? { ...schedule, machineId: localNodeId } : { ...schedule, enabled: false };
  }
  return job;
}
