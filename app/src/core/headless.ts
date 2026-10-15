// SamSync.exe --plan-only / --check-only: the old tool's -PlanOnly and -CheckOnly, without a window.
//   --plan-only   where every item would go on every target; nothing is read on the targets
//   --check-only  is every item the same on every target? One row per target; exit code 0 = all the same
// The table goes to stdout and everything else (machine, warnings, summary, errors) to stderr, so the table can be
// piped on. Column names and state values are ASCII and the same as the old tool's, for scripts that read them.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig, LocalIdentity, LocalSettings, NodeConfig, SendOptions, TargetPlan } from '../shared/types';
import type { CoreContext } from './context';
import { expandTargetIds } from './context';
import { DEFAULT_SETTINGS, loadConfig, readJson } from './config';
import { detectIdentity } from './identity';
import { createLogger, type Logger } from './logger';
import { buildSendPlan } from './plan';
import { joinRoot, mapToRel, normalizeAbs, relIsWithin } from './paths';
import { nodeRootLabel } from './transport';
import { errMessage } from './util';
import { baseSendOptions, targetOptions } from '../shared/options';
import { resolveLang, setLang, systemLang, t } from '../shared/i18n';

export type HeadlessMode = 'plan' | 'check';

export interface HeadlessRequest {
  mode: HeadlessMode;
  /** Items given on the command line that exist. */
  paths: string[];
  /** Items given on the command line that do not exist. */
  missing: string[];
  /** --to tokens; all targets when empty. */
  targets: string[];
}

export interface HeadlessIO {
  out(line: string): void;
  err(line: string): void;
}

/** Old tool's state values, ASCII so a child process' code page cannot mangle them. */
export type CheckState = 'Ayni' | 'Farkli' | 'Yok' | 'Erisilemedi' | 'Hata';

export interface CheckRow {
  Target: string;
  TargetId: string;
  State: CheckState;
  Changes: number;
  Missing: number;
  DestNewer: number;
  Extras: number;
}

/** Plain text table: a header row and left aligned columns. */
export function table(rows: Record<string, string | number>[]): string[] {
  if (!rows.length) return [];
  const cols = Object.keys(rows[0]);
  const width = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c]).length)));
  const line = (cells: string[]) => cells.map((c, i) => (i === cells.length - 1 ? c : c.padEnd(width[i]))).join('  ');
  return [line(cols), line(width.map((w) => '-'.repeat(w))), ...rows.map((r) => line(cols.map((c) => String(r[c]))))];
}

/** --to tokens to targets (node ids, group:, profile:, all, last) and the options saved with a profile or the last send. */
export function resolveHeadlessTargets(
  cfg: AppConfig,
  settings: Pick<LocalSettings, 'lastTargets' | 'lastOptions'>,
  tokens: string[],
  localNodeId?: string,
): { nodes: NodeConfig[]; options: Partial<SendOptions>; empty: string[] } {
  const nodes: NodeConfig[] = [];
  const empty: string[] = [];
  let options: Partial<SendOptions> = {};
  for (const token of tokens.length ? tokens : ['all']) {
    const k = token.trim().toLowerCase();
    let found: NodeConfig[];
    if (k === 'last') {
      found = expandTargetIds(cfg, settings.lastTargets ?? [], localNodeId);
      options = { ...options, ...(settings.lastOptions ?? {}) };
    } else {
      found = expandTargetIds(cfg, [token], localNodeId);
      if (k.startsWith('profile:')) {
        const p = cfg.profiles.find((x) => x.name.toLowerCase() === k.slice(8) || x.id.toLowerCase() === k.slice(8));
        if (p?.options) options = { ...options, ...p.options };
      }
    }
    if (!found.length) empty.push(token);
    for (const n of found) if (!nodes.includes(n)) nodes.push(n);
  }
  return { nodes, options, empty };
}

/** The old tool's option names for what is on for one target. */
function optionNames(o: SendOptions): string {
  const names = [o.backup && 'Backup', o.mode === 'update' && 'OnlyNewer', o.mode === 'mirror' && 'Mirror', o.dryRun && 'DryRun'];
  return names.filter(Boolean).join(',');
}

/** One target's row of the equality check, counted the way the old tool did (robocopy /L per item). */
export function checkRow(tp: TargetPlan, items: { rel: string }[]): CheckRow {
  // the column order is the old tool's
  const row = (State: CheckState, Changes = 0, Missing = 0, DestNewer = 0, Extras = 0): CheckRow => ({ Target: tp.targetName, TargetId: tp.targetId, State, Changes, Missing, DestNewer, Extras });
  if (!tp.reachable) return row(tp.failed ? 'Hata' : 'Erisilemedi');
  // an item that is not on the target at all counts once as missing, not as all the files inside it
  const missing = items.filter((it) => tp.ops.some((o) => o.category === 'new' && o.rel.toLowerCase() === it.rel.toLowerCase()));
  const underMissing = (rel: string) => missing.some((m) => relIsWithin(rel, m.rel, true));
  let changes = 0;
  let newer = 0;
  let extras = 0;
  for (const o of tp.ops) {
    if (o.category === 'extra') extras++;
    else if (o.category !== 'deleted' && !underMissing(o.rel)) {
      changes++;
      if (o.category === 'targetNewer') newer++;
    }
  }
  const state: CheckState = items.length > 0 && missing.length === items.length ? 'Yok' : changes === 0 && missing.length === 0 ? 'Ayni' : 'Farkli';
  return row(state, changes, missing.length, newer, extras);
}

/** Runs --plan-only or --check-only against a loaded config and returns the exit code. */
export async function runHeadless(
  ctx: CoreContext,
  identity: LocalIdentity,
  settings: Pick<LocalSettings, 'lastTargets' | 'lastOptions' | 'sendDefaults'>,
  req: HeadlessRequest,
  io: HeadlessIO,
): Promise<number> {
  const fail = (msg: string) => {
    io.err(msg);
    ctx.log.error(t('Komut satırı'), msg);
    return 1;
  };
  for (const m of req.missing) io.err(t('Kaynak bulunamadı: {path}', { path: m }));
  if (req.missing.length) return fail(t('{n} kaynak bulunamadı; hiçbir şey denetlenmedi.', { n: req.missing.length }));
  if (!req.paths.length) return fail(t('Kaynak verilmedi. Örnek: SamSync.exe --check-only --to all "C:\\ActiveRelease\\Data"'));
  if (!identity.node) return fail(t('Bu makine yapılandırmadaki bir node ile eşleşmedi: {reason}', { reason: identity.reason }));
  io.err(t('Bu makine: {id} ({reason})', { id: identity.node.id, reason: identity.reason }));

  const to = resolveHeadlessTargets(ctx.config, settings, req.targets, ctx.localNodeId);
  if (to.empty.length) return fail(t('Hedef bulunamadı ya da boş: {ids}', { ids: to.empty.join(', ') }));
  const options: SendOptions = { ...baseSendOptions(ctx.config.copy, settings.sendDefaults), ...to.options, dryRun: false, notify: false, runPostCommand: false };
  const paths = req.paths.map((p) => normalizeAbs(p));

  if (req.mode === 'plan') {
    const rows = paths.flatMap((p) => {
      const m = mapToRel(p, ctx.localRoots);
      return to.nodes.map((n) => ({
        Source: p,
        LocalRoot: m.outside ? t('(kök dışı)') : m.root ?? '',
        LocalMachine: identity.node!.id,
        Target: n.name,
        Destination: joinRoot(nodeRootLabel(ctx.config, n), m.rel),
        Options: optionNames(targetOptions(options, n.id)),
      }));
    });
    for (const line of table(rows)) io.out(line);
    ctx.log.info(t('Komut satırı'), t('Yalnızca plan: {n} işlem hesaplandı, kopyalama yapılmadı.', { n: rows.length }));
    return 0;
  }

  let plan;
  try {
    plan = await buildSendPlan(ctx, { sources: paths.map((p) => ({ kind: 'fs', path: p })), targetIds: to.nodes.map((n) => n.id), options, origin: 'send' });
  } catch (e) {
    return fail(errMessage(e));
  }
  for (const w of plan.warnings) io.err(`! ${w}`);
  const items = plan.sources.filter((s) => s.exists);
  const rows = plan.targets.map((tp) => checkRow(tp, items));
  for (const line of table(rows as unknown as Record<string, string | number>[])) io.out(line);
  for (const tp of plan.targets) if (!tp.reachable && tp.error) io.err(`${tp.targetName}: ${tp.error}`);
  const same = rows.filter((r) => r.State === 'Ayni').length;
  const allSame = same === rows.length && rows.length > 0;
  const summary = allSame ? t('Bütün hedefler aynı ({n}).', { n: rows.length }) : t('Fark var: {same}/{n} hedef aynı.', { same, n: rows.length });
  io.err(summary);
  ctx.log.info(t('Komut satırı'), t('Yalnızca denetim: {summary}', { summary }));
  return allSame ? 0 : 1;
}

export interface HeadlessHost {
  userDataPath: string;
  appVersion: string;
  /** The computer's preferred language tags, for the language of the messages. */
  systemLanguages: string[];
  decrypt?: (enc: string) => string | null;
  env?: NodeJS.ProcessEnv;
}

/** Loads the settings and the config the way the app does, then runs the request. */
export async function headlessFromDisk(host: HeadlessHost, req: HeadlessRequest, io: HeadlessIO): Promise<number> {
  const env = host.env ?? process.env;
  let settings: LocalSettings = { ...DEFAULT_SETTINGS };
  try {
    settings = { ...DEFAULT_SETTINGS, ...((await readJson(path.join(host.userDataPath, 'settings.json'))) as Partial<LocalSettings>) };
  } catch {
    /* first start: defaults */
  }
  setLang(resolveLang(settings.language, systemLang(host.systemLanguages)));
  const logEnv = env.SAMSYNC_LOG;
  const log: Logger = createLogger(logEnv ? path.dirname(logEnv) : path.join(host.userDataPath, 'log'));
  const configPath = env.SAMSYNC_CONFIG || settings.configPath || path.join(host.userDataPath, 'config.json');
  io.err(`SamSync ${host.appVersion} --${req.mode === 'plan' ? 'plan-only' : 'check-only'} • ${configPath}`);
  let config: AppConfig;
  try {
    if (!fs.existsSync(configPath)) throw new Error(t('Yapılandırma dosyası yok: {path}', { path: configPath }));
    config = await loadConfig(configPath);
  } catch (e) {
    io.err(errMessage(e));
    log.error(t('Komut satırı'), t('Yapılandırma okunamadı: {path}', { path: configPath }), e);
    await log.drain?.();
    return 1;
  }
  const identity = detectIdentity(config, settings.localNodeId, env);
  const secrets = async (): Promise<Record<string, string>> => JSON.parse(await fsp.readFile(path.join(host.userDataPath, 'secrets.json'), 'utf8').catch(() => '{}'));
  const ctx: CoreContext = {
    config,
    localRoots: identity.node?.localRoots ?? [],
    localNodeId: identity.node?.id,
    userDataPath: host.userDataPath,
    getSecret: async (id) => {
      const enc = (await secrets())[id];
      return enc && host.decrypt ? host.decrypt(enc) ?? undefined : undefined;
    },
    emit: () => undefined,
    log,
  };
  const code = await runHeadless(ctx, identity, settings, req, io);
  await log.drain?.();
  return code;
}
