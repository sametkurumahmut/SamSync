// One-time import of the old wizard's state: its profiles and its last selection with the per machine columns.
// The PowerShell tool kept them in %LOCALAPPDATA%\<its folder>\wizard-state.json, per config file:
//   { "version": 1, "configs": { "<config path, lower case>": {
//       "global":   { "excludeFiles": "*.pdb;*.tmp", "excludeDirectories": ".git", "notify": true, "parallelTargets": 4, ... },
//       "targets":  { "<node id>": { "selected": true, "backup": false, "onlyNewer": false, "mirror": false } },
//       "profiles": { "<name>": { "global": { ... }, "targets": { ... } } } } } }
// The folder is found by looking for that file, so the old tool's name is not written here.
import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig, Profile, SendMode, SendOptions, TargetOptions } from '../shared/types';
import { readJson } from './config';

export const WIZARD_STATE_FILE = 'wizard-state.json';

interface StoredTarget {
  selected?: unknown;
  backup?: unknown;
  onlyNewer?: unknown;
  mirror?: unknown;
}

interface StoredSettings {
  global?: Record<string, unknown>;
  targets?: Record<string, StoredTarget>;
  profiles?: Record<string, StoredSettings>;
}

export interface WizardState {
  configs: Record<string, StoredSettings>;
}

export interface WizardConversion {
  /** The config path the chosen entry was saved for. */
  configKey: string;
  lastTargets: string[];
  lastOptions: Partial<SendOptions>;
  profiles: Profile[];
  /** Machine ids in the file that the current config does not have. */
  unknownTargets: string[];
}

export function isWizardState(raw: unknown): raw is WizardState {
  const c = (raw as { configs?: unknown } | null)?.configs;
  return !!c && typeof c === 'object' && !Array.isArray(c);
}

/** Every %LOCALAPPDATA%\*\wizard-state.json that holds wizard settings. */
export async function findWizardStates(localAppData = process.env.LOCALAPPDATA): Promise<string[]> {
  if (!localAppData) return [];
  let dirs: fs.Dirent[];
  try {
    dirs = await fs.promises.readdir(localAppData, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const file = path.join(localAppData, d.name, WIZARD_STATE_FILE);
    if (!fs.existsSync(file)) continue;
    try {
      if (isWizardState(await readJson(file))) found.push(file);
    } catch {
      /* not ours */
    }
  }
  return found;
}

const bool = (v: unknown, def: boolean) => (v == null ? def : !!v);
/** "*.pdb;*.tmp, desktop.ini" as the old tool split it. */
const patterns = (v: unknown) => (typeof v === 'string' ? v.split(/[;,]/).map((x) => x.trim()).filter(Boolean) : []);

function modeOf(t: StoredTarget): SendMode {
  if (bool(t.mirror, false)) return 'mirror';
  if (bool(t.onlyNewer, false)) return 'update';
  return 'overwrite';
}

/** The value most targets have; on a tie the first of `order` (the safer choice) wins. */
function majority<T>(values: T[], order: T[]): T {
  let best = order[0];
  let bestCount = -1;
  for (const v of order) {
    const n = values.filter((x) => x === v).length;
    if (n > bestCount) {
      best = v;
      bestCount = n;
    }
  }
  return best;
}

/**
 * One saved wizard table as SamSync send options: the mode and backup most selected machines had become the
 * general options and every machine that differs gets its own exception, so nothing changes for any machine.
 */
function convertSettings(s: StoredSettings, cfg: AppConfig, unknown: Set<string>, onlySelected: boolean): { targetIds: string[]; options: Partial<SendOptions> } {
  const byId = new Map(cfg.nodes.map((n) => [n.id.toLowerCase(), n.id]));
  const rows: { id: string; selected: boolean; mode: SendMode; backup: boolean }[] = [];
  for (const [rawId, t] of Object.entries(s.targets ?? {})) {
    const id = byId.get(rawId.toLowerCase());
    if (!id) {
      unknown.add(rawId);
      continue;
    }
    rows.push({ id, selected: bool(t?.selected, true), mode: modeOf(t ?? {}), backup: bool(t?.backup, false) });
  }
  const chosen = rows.filter((r) => r.selected);
  const basis = chosen.length ? chosen : rows;
  const mode = majority(basis.map((r) => r.mode), ['overwrite', 'update', 'mirror'] as SendMode[]);
  const backup = majority(basis.map((r) => r.backup), [false, true]);
  const perTarget: Record<string, TargetOptions> = {};
  // the last selection keeps the columns of unticked machines too (ticking one later brings them back, as in the
  // wizard); a profile only needs its own machines
  for (const r of onlySelected ? chosen : rows) {
    const own: TargetOptions = {};
    if (r.mode !== mode) own.mode = r.mode;
    if (r.backup !== backup) own.backup = r.backup;
    if (own.mode || own.backup != null) perTarget[r.id] = own;
  }
  const g = s.global ?? {};
  const options: Partial<SendOptions> = { mode, backup, perTarget };
  // the wizard's lists come on top of the config's, so .git and friends stay left out
  const files = patterns(g.excludeFiles);
  const dirs = patterns(g.excludeDirectories);
  if (files.length) options.excludeFiles = [...new Set([...cfg.copy.excludeFiles, ...files])];
  if (dirs.length) options.excludeDirs = [...new Set([...cfg.copy.excludeDirs, ...dirs])];
  if (g.notify != null) options.notify = !!g.notify;
  const parallel = Number(g.parallelTargets);
  if (Number.isFinite(parallel) && parallel >= 1) options.parallelTargets = Math.min(32, Math.round(parallel));
  return { targetIds: chosen.map((r) => r.id), options };
}

/**
 * Picks the entry saved for this config (by path; the folder may have moved since, so otherwise the entry that knows
 * the most of this config's machines) and converts its last selection and its profiles.
 */
export function convertWizardState(state: WizardState, cfg: AppConfig, configPath: string): WizardConversion | null {
  const entries = Object.entries(state.configs).filter(([, v]) => v && typeof v === 'object');
  if (!entries.length) return null;
  const ids = new Set(cfg.nodes.map((n) => n.id.toLowerCase()));
  const known = (s: StoredSettings | undefined) => Object.keys(s?.targets ?? {}).filter((k) => ids.has(k.toLowerCase())).length;
  const score = ([key, v]: [string, StoredSettings]) =>
    (path.normalize(key).toLowerCase() === path.normalize(configPath).toLowerCase() ? 100000 : 0) + known(v) + Object.values(v.profiles ?? {}).reduce((n, p) => n + known(p), 0);
  const [configKey, entry] = entries.reduce((a, b) => (score(b) > score(a) ? b : a));

  const unknown = new Set<string>();
  const last = convertSettings(entry, cfg, unknown, false);
  const profiles: Profile[] = Object.entries(entry.profiles ?? {}).map(([name, p]) => {
    const c = convertSettings(p ?? {}, cfg, unknown, true);
    return { id: name.replace(/[^\w.-]/g, '_'), name, targetIds: c.targetIds, options: c.options };
  });
  return { configKey, lastTargets: last.targetIds, lastOptions: last.options, profiles, unknownTargets: [...unknown] };
}
