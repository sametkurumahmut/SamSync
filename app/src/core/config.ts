import fs from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig, CopySettings, NodeConfig, Profile, SyncJob, LocalSettings } from '../shared/types';
import { t } from '../shared/i18n';

export const DEFAULT_COPY: CopySettings = {
  retryCount: 2,
  waitSeconds: 1,
  parallelTargets: 8,
  parallelFiles: 16,
  backupKeep: 5,
  backupFolderName: '_SamSyncYedek',
  verify: false,
  timeToleranceSec: 2,
  ignoreDstShift: true,
  postCommand: '',
  postCommandTimeoutSeconds: 60,
  bandwidthMBps: 0,
  excludeFiles: [],
  excludeDirs: ['.git', '.svn', '.vs', 'node_modules'],
  outsideRoots: 'own',
};

export { DEFAULT_AUTOMATION, automationSettings } from '../shared/automation';

export const DEFAULT_SETTINGS: LocalSettings = {
  theme: 'dark',
  accent: '#2f7cf6',
  language: 'system',
  recentRepos: [],
  lastTargets: [],
  density: 'comfortable',
  gitLogPageSize: 60,
  probeIntervalSec: 45,
  confirmBeforeRun: true,
  closeRunPanelOnSuccess: false,
  updateAutoCheck: true,
  updateAutoDownload: true,
  watches: [],
  scheduleRuns: {},
  automationPaused: false,
  closeToTray: false,
  launchAtLogin: false,
};

export function emptyConfig(): AppConfig {
  return { schema: 2, nodes: [], copy: { ...DEFAULT_COPY }, profiles: [], syncJobs: [] };
}

const ID_RE = /^[A-Za-z0-9._-]+$/;

export class ConfigError extends Error {}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === 'string' && v.trim()) return v.split(';').map((x) => x.trim()).filter(Boolean);
  return [];
}

function clampInt(v: unknown, def: number, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * Accepts both the v2 format and the legacy PowerShell config.json (localRoot / localRoots,
 * copy.retryCount ...) and returns a validated v2 config. Throws ConfigError with a message in the UI language.
 */
export function normalizeConfig(raw: unknown): AppConfig {
  if (!raw || typeof raw !== 'object') throw new ConfigError(t('Yapılandırma bir JSON nesnesi olmalı.'));
  const r = raw as Record<string, any>;
  const nodesRaw: any[] = Array.isArray(r.nodes) ? r.nodes : [];
  const seen = new Set<string>();
  const nodes: NodeConfig[] = nodesRaw.map((n, i) => {
    const id = String(n?.id ?? '').trim();
    if (!id || !ID_RE.test(id)) throw new ConfigError(t("Node #{n}: id yalnızca harf, rakam, nokta, alt çizgi ve tire içerebilir: '{id}'", { n: i + 1, id }));
    const key = id.toLowerCase();
    if (seen.has(key)) throw new ConfigError(t('Node id değerleri benzersiz olmalı (büyük/küçük harf duyarsız): {id}', { id }));
    seen.add(key);
    const localRoots = [...(n.localRoot ? [String(n.localRoot)] : []), ...asStringArray(n.localRoots)];
    const uniqRoots = localRoots.filter((x, j) => localRoots.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === j);
    const transport = n.transport === 'path' || n.transport === 'sftp' ? n.transport : 'smb';
    const node: NodeConfig = {
      id,
      name: String(n.name ?? id).trim() || id,
      address: String(n.address ?? '').trim(),
      localRoots: uniqRoots,
      networkRoot: String(n.networkRoot ?? '').trim().replace(/^[\\/]+|[\\/]+$/g, ''),
      enabled: n.enabled !== false,
      transport,
    };
    const group = String(n.group ?? '').trim();
    // the group is a menu label and, as group:<name>, a target id on command lines: the same characters as an id
    if (group && !ID_RE.test(group))
      throw new ConfigError(t("Node #{n}: group yalnızca harf, rakam, nokta, alt çizgi ve tire içerebilir: '{group}'", { n: i + 1, group }));
    if (group) node.group = group;
    const names = asStringArray(n.localNames);
    if (names.length) node.localNames = names;
    if (n.path) node.path = String(n.path).trim();
    if (n.color) node.color = String(n.color);
    if (n.notes) node.notes = String(n.notes);
    if (n.relay === true) node.relay = true;
    if (n.sftp && typeof n.sftp === 'object') {
      node.sftp = {
        host: n.sftp.host ? String(n.sftp.host) : undefined,
        port: n.sftp.port ? clampInt(n.sftp.port, 22, 1, 65535) : undefined,
        username: String(n.sftp.username ?? ''),
        privateKeyPath: n.sftp.privateKeyPath ? String(n.sftp.privateKeyPath) : undefined,
        useAgent: !!n.sftp.useAgent,
        root: String(n.sftp.root ?? '/'),
      };
    }
    if (transport === 'smb' && !node.address) throw new ConfigError(t('{id}: address (IP veya bilgisayar adı) gerekli.', { id }));
    if (transport === 'smb' && !node.networkRoot && !node.path) throw new ConfigError(t('{id}: networkRoot gerekli (örnek: Share\\Release).', { id }));
    if (transport === 'path' && !node.path) throw new ConfigError(t('{id}: path transport için hedef klasör (path) gerekli.', { id }));
    if (transport === 'sftp' && (!node.sftp || !node.sftp.username)) throw new ConfigError(t('{id}: sftp için kullanıcı adı gerekli.', { id }));
    return node;
  });

  const c = r.copy ?? {};
  const copy: CopySettings = {
    retryCount: clampInt(c.retryCount, DEFAULT_COPY.retryCount, 0, 100),
    waitSeconds: clampInt(c.waitSeconds, DEFAULT_COPY.waitSeconds, 0, 60),
    parallelTargets: clampInt(c.parallelTargets, DEFAULT_COPY.parallelTargets, 1, 32),
    parallelFiles: clampInt(c.parallelFiles, DEFAULT_COPY.parallelFiles, 1, 64),
    backupKeep: clampInt(c.backupKeep, DEFAULT_COPY.backupKeep, 0, 1000),
    backupFolderName: String(c.backupFolderName || DEFAULT_COPY.backupFolderName).replace(/[\\/]/g, ''),
    verify: !!c.verify,
    timeToleranceSec: clampInt(c.timeToleranceSec, DEFAULT_COPY.timeToleranceSec, 0, 3600),
    ignoreDstShift: c.ignoreDstShift !== false,
    relayAckSeconds: clampInt(c.relayAckSeconds, 60, 5, 3600),
    relayTimeoutMinutes: clampInt(c.relayTimeoutMinutes, 15, 1, 24 * 60),
    relayQueueMinutes: clampInt(c.relayQueueMinutes, 5, 0, 24 * 60),
    relayQueueDays: clampInt(c.relayQueueDays, 7, 1, 90),
    manifestMaxDays: clampInt(c.manifestMaxDays, 7, 0, 365),
    postCommand: c.postCommand ? String(c.postCommand) : '',
    postCommandTimeoutSeconds: clampInt(c.postCommandTimeoutSeconds, 60, 1, 3600),
    bandwidthMBps: Math.max(0, Math.min(10000, Number(c.bandwidthMBps) || 0)),
    excludeFiles: c.excludeFiles !== undefined ? asStringArray(c.excludeFiles) : [...DEFAULT_COPY.excludeFiles],
    excludeDirs: c.excludeDirs !== undefined ? asStringArray(c.excludeDirs) : [...DEFAULT_COPY.excludeDirs],
    outsideRoots: c.outsideRoots === 'fullPath' ? 'fullPath' : 'own',
  };

  const profiles: Profile[] = (Array.isArray(r.profiles) ? r.profiles : [])
    .filter((p: any) => p && p.name)
    .map((p: any) => ({
      id: String(p.id || p.name),
      name: String(p.name),
      targetIds: asStringArray(p.targetIds),
      options: p.options && typeof p.options === 'object' ? p.options : undefined,
      icon: p.icon ? String(p.icon) : undefined,
    }));

  const syncJobs: SyncJob[] = (Array.isArray(r.syncJobs) ? r.syncJobs : []).filter((j: any) => j && j.id && Array.isArray(j.pairs));

  const cfg: AppConfig = { schema: 2, nodes, copy, profiles, syncJobs };
  // menuTitle belongs to the PowerShell tool's own menu; reading it here would also write it back as title
  if (r.title) cfg.title = String(r.title);
  const show = String(r.menuShowNodes ?? '').toLowerCase();
  if (show === 'auto' || show === 'always' || show === 'never') cfg.menuShowNodes = show;
  if (r.notepadPlusPlusShortcuts && typeof r.notepadPlusPlusShortcuts === 'object') {
    cfg.notepadPlusPlusShortcuts = Object.fromEntries(Object.entries(r.notepadPlusPlusShortcuts).map(([k, v]) => [k, String(v ?? '')]));
  }
  if (r.smbPathTemplate && typeof r.smbPathTemplate === 'object') cfg.smbPathTemplate = r.smbPathTemplate;
  if (r.update && typeof r.update === 'object') {
    const src = ['github', 'url', 'folder', 'off'].includes(r.update.source) ? r.update.source : 'github';
    cfg.update = { source: src };
    if (r.update.url) cfg.update.url = String(r.update.url).trim();
    if (r.update.folder) cfg.update.folder = String(r.update.folder).trim();
  }
  return cfg;
}

export function isLegacyConfig(raw: unknown): boolean {
  const r = raw as Record<string, any>;
  return !!r && typeof r === 'object' && r.schema !== 2 && Array.isArray(r.nodes);
}

export async function readJson(file: string): Promise<unknown> {
  let text = await fs.readFile(file, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new ConfigError(t('{file} geçerli JSON değil: {error}', { file: path.basename(file), error: (e as Error).message }));
  }
}

export async function loadConfig(file: string): Promise<AppConfig> {
  return normalizeConfig(await readJson(file));
}

/** Writes JSON atomically (temp file + rename) so a crash never leaves a half written config. */
export async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  await fs.rename(tmp, file);
}

/** Serialises the config. Empty optional fields are left out so hand edited files stay tidy. */
export function serializeConfig(cfg: AppConfig): AppConfig {
  const nodes = cfg.nodes.map((n) => {
    const o: any = { id: n.id, name: n.name };
    if (n.group) o.group = n.group;
    o.address = n.address;
    if (n.localNames?.length) o.localNames = n.localNames;
    o.localRoots = n.localRoots;
    o.networkRoot = n.networkRoot;
    if (n.transport && n.transport !== 'smb') o.transport = n.transport;
    if (n.path) o.path = n.path;
    if (n.relay) o.relay = true;
    if (n.sftp) {
      const { hasPassword: _h, ...rest } = n.sftp;
      o.sftp = rest;
    }
    if (n.color) o.color = n.color;
    if (n.notes) o.notes = n.notes;
    o.enabled = n.enabled;
    return o as NodeConfig;
  });
  return { ...cfg, schema: 2, nodes };
}

/**
 * Saves the config over an existing file, keeping keys this app does not own (menuTitle,
 * notepadPlusPlusShortcuts, the legacy "version" string ...) so the PowerShell tool can keep
 * reading a shared config.json.
 */
export async function saveConfigFile(file: string, cfg: AppConfig): Promise<void> {
  let existing: Record<string, unknown> = {};
  try {
    const raw = await readJson(file);
    if (raw && typeof raw === 'object') existing = raw as Record<string, unknown>;
  } catch {
    /* new file */
  }
  const out = { ...existing, ...serializeConfig(cfg) } as Record<string, any>;
  // legacy nodes may carry localRoot; the list now holds every root
  out.nodes = (out.nodes as any[]).map((n) => {
    const prev = Array.isArray(existing.nodes) ? (existing.nodes as any[]).find((x) => x?.id === n.id) : undefined;
    const merged = { ...(prev ?? {}), ...n };
    delete merged.localRoot;
    if (!n.group) delete merged.group;
    if (!n.localNames) delete merged.localNames;
    if (!n.path) delete merged.path;
    if (!n.sftp) delete merged.sftp;
    if (!n.transport) delete merged.transport;
    return merged;
  });
  if (out.copy && existing.copy && typeof existing.copy === 'object') out.copy = { ...(existing.copy as object), ...out.copy };
  if (!cfg.update) delete out.update;
  if (!cfg.smbPathTemplate) delete out.smbPathTemplate;
  await writeJsonAtomic(file, out);
}

export function groupsOf(cfg: AppConfig): string[] {
  const seen = new Map<string, string>();
  for (const n of cfg.nodes) if (n.group && !seen.has(n.group.toLowerCase())) seen.set(n.group.toLowerCase(), n.group);
  return [...seen.values()];
}
