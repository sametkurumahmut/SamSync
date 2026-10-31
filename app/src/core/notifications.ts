// Telling the team: when a run ends, a message to a webhook (any HTTP endpoint, a Teams/Slack flow) and/or
// to a Telegram chat through a bot, as set in this machine's settings. Nothing here blocks the run.
import type { DriftReport, NodeConfig, NotificationSettings, NotifyKind, RunDetail } from '../shared/types';
import { formatBytes } from './util';
import { t } from '../shared/i18n';
import { driftCounts } from '../shared/drift';
import { machineTitle } from '../shared/machine';
import { DEFAULT_NOTIFY_KINDS } from '../shared/notify';

export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface RunMessage {
  text: string;
  payload: Record<string, unknown>;
}

const STATUS_MARK: Record<RunDetail['status'], string> = { ok: '✓', partial: '△', failed: '✕', cancelled: '–', running: '…' };

/** The message for a finished run: one line of the result, then the machines that failed with why. */
/** Who sent it, as whoami writes it (DOMAIN\user); the computer is named too when the account is not a local one. */
export function senderText(from: { host: string; user?: string }): string {
  if (!from.user) return from.host;
  return from.user.toLowerCase().startsWith(`${from.host.toLowerCase()}\\`) ? from.user : `${from.user}, ${from.host}`;
}

/** At most this many machine names per group (or of no group) in a message; the rest is a count. */
const NAMES_SHOWN = 20;

/**
 * The machines of a run by group: a group that got it on every machine as its name and count, part of a group as
 * its name and those machines, a machine of no group by its own name. `nodes`: the configuration without the sender.
 */
export function targetsText(targets: { key: string; title: string }[], nodes: Pick<NodeConfig, 'id' | 'group' | 'enabled'>[]): string {
  const groupOf = new Map(nodes.map((n) => [n.id, n.group]));
  const groups = new Map<string, string[]>();
  const loose: string[] = [];
  for (const x of targets) {
    const g = groupOf.get(x.key);
    const name = machineTitle(x.title);
    if (g) groups.set(g, [...(groups.get(g) ?? []), name]);
    else loose.push(name);
  }
  const names = (list: string[]) => (list.length > NAMES_SHOWN ? `${list.slice(0, NAMES_SHOWN).join(', ')} ${t('… ve {n} makine daha', { n: list.length - NAMES_SHOWN })}` : list.join(', '));
  const parts = [...groups].map(([g, list]) => {
    const all = nodes.filter((n) => n.group === g && n.enabled).length;
    return list.length >= all ? `${g} (${list.length})` : `${g}: ${names(list)}`;
  });
  if (loose.length) parts.push(names(loose));
  return parts.join('; ');
}

export function runMessage(run: RunDetail, from: { host: string; version?: string; user?: string }, nodes: Pick<NodeConfig, 'id' | 'group' | 'enabled'>[] = []): RunMessage {
  const ms = (run.finishedAt ?? Date.now()) - run.startedAt;
  const mins = Math.round(ms / 60000);
  const took = ms < 90_000 ? t('{n} sn', { n: Math.round(ms / 1000) }) : mins < 120 ? t('{n} dk', { n: mins }) : t('{h} sa {m} dk', { h: Math.floor(mins / 60), m: mins % 60 });
  const okTargets = run.targets.filter((x) => x.status === 'ok').length;
  const head = `${STATUS_MARK[run.status]} ${run.label} — ${t('{ok}/{n} makine', { ok: okTargets, n: run.targets.length })}, ${t('{n} işlem', { n: run.opsOk })}${run.opsFailed ? `, ${t('{n} hatalı', { n: run.opsFailed })}` : ''}, ${formatBytes(run.bytes)}, ${took}`;
  const failed = run.targets.filter((x) => x.status === 'failed' || x.status === 'partial').map((x) => `• ${x.title}: ${x.error ?? t('{n} hata', { n: x.failed })}`);
  const where = run.targets.length ? [`→ ${t('Hedefler: {list}', { list: targetsText(run.targets, nodes) })}`] : [];
  const text = [head, ...where, ...failed, `${t('Gönderen: {who}', { who: senderText(from) })}${from.version ? ` • SamSync ${from.version}` : ''}`].join('\n');
  const groupOf = new Map(nodes.map((n) => [n.id, n.group]));
  const payload = {
    event: 'run-done',
    status: run.status,
    label: run.label,
    origin: run.origin,
    from: from.host,
    user: from.user,
    version: from.version,
    startedAt: new Date(run.startedAt).toISOString(),
    finishedAt: new Date(run.finishedAt ?? Date.now()).toISOString(),
    durationMs: ms,
    opsOk: run.opsOk,
    opsFailed: run.opsFailed,
    bytes: run.bytes,
    sources: run.sources,
    targets: run.targets.map((x) => ({ id: x.key, name: x.title, group: groupOf.get(x.key), status: x.status, done: x.done, failed: x.failed, bytes: x.bytesDone, error: x.error, via: x.via })),
    text,
  };
  return { text, payload };
}

/** The message when a send starts (Settings › Notifications › on start): what goes, to which machines, from whom. */
export function startMessage(label: string, targets: { key: string; title: string }[], bytes: number, ops: number, from: { host: string; version?: string; user?: string }, nodes: Pick<NodeConfig, 'id' | 'group' | 'enabled'>[] = []): RunMessage {
  const text = [
    `▶ ${label} — ${t('başladı: {n} makine, {ops} işlem, {size}', { n: targets.length, ops, size: formatBytes(bytes) })}`,
    `→ ${t('Hedefler: {list}', { list: targetsText(targets, nodes) })}`,
    `${t('Gönderen: {who}', { who: senderText(from) })}${from.version ? ` • SamSync ${from.version}` : ''}`,
  ].join('\n');
  const groupOf = new Map(nodes.map((n) => [n.id, n.group]));
  return { text, payload: { event: 'run-start', label, from: from.host, user: from.user, version: from.version, bytes, ops, targets: targets.map((x) => ({ id: x.key, name: x.title, group: groupOf.get(x.key) })), text } };
}

/** Whether this run should go out, by the settings. */
/** The message of a drift check that found changes: one line per machine. */
export function driftMessage(reports: DriftReport[], from: { host: string; version?: string; user?: string }): RunMessage {
  const drifted = reports.filter((r) => r.changed + r.added + r.removed > 0);
  const lines = [`△ ${t('Sapma: {n} makinede son gönderimden sonra değişen dosyalar var', { n: drifted.length })}`];
  for (const r of drifted.slice(0, 20)) lines.push(`• ${r.name}: ${driftCounts(r)}`);
  if (drifted.length > 20) lines.push(t('… ve {n} makine daha', { n: drifted.length - 20 }));
  lines.push(`${t('Denetleyen: {who}', { who: senderText(from) })}${from.version ? ` • SamSync ${from.version}` : ''}`);
  return {
    text: lines.join('\n'),
    payload: { kind: 'drift', machines: drifted.map((r) => ({ id: r.nodeId, name: r.name, changed: r.changed, added: r.added, removed: r.removed })), host: from.host, user: from.user, version: from.version },
  };
}

/** The channels that are set and switched on. */
export function activeChannels(s: NotificationSettings | undefined): { webhook: boolean; telegram: boolean } {
  return { webhook: !!s?.webhookUrl && s.webhookEnabled !== false, telegram: !!(s?.telegramToken && s.telegramChatId) && s.telegramEnabled !== false };
}

/** True when at least one channel is set and switched on. */
export function hasChannel(s: NotificationSettings | undefined): boolean {
  const c = activeChannels(s);
  return c.webhook || c.telegram;
}

/** True when this kind of run reports at all (Settings › Notifications › which runs; the Send page alone unless chosen). */
export function kindWanted(s: NotificationSettings | undefined, kind: NotifyKind): boolean {
  return (s?.kinds ?? DEFAULT_NOTIFY_KINDS).includes(kind);
}

export function wantsNotification(s: NotificationSettings | undefined, run: Pick<RunDetail, 'status' | 'dryRun'>, kind?: NotifyKind): boolean {
  // a cancel is someone's own choice, not news for the team (the run window and History still show it)
  if (!s || run.dryRun || run.status === 'cancelled') return false;
  if (!hasChannel(s) || (kind && !kindWanted(s, kind))) return false;
  return run.status === 'ok' ? !!s.onSuccess : !!s.onFailure;
}

async function post(fetchImpl: Fetch, url: string, body: unknown): Promise<void> {
  const r = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}${await r.text().then((x) => (x ? `: ${x.slice(0, 200)}` : '')).catch(() => '')}`);
}

/** Sends the message to every channel that is set and switched on; one result line per channel ('ok' or the error). */
export async function sendNotification(s: NotificationSettings, m: RunMessage, fetchImpl: Fetch = globalThis.fetch as unknown as Fetch): Promise<{ webhook?: string; telegram?: string }> {
  const out: { webhook?: string; telegram?: string } = {};
  const on = activeChannels(s);
  if (on.webhook && s.webhookUrl) {
    try {
      await post(fetchImpl, s.webhookUrl, m.payload);
      out.webhook = 'ok';
    } catch (e) {
      out.webhook = e instanceof Error ? e.message : String(e);
    }
  }
  if (on.telegram && s.telegramToken && s.telegramChatId) {
    try {
      await post(fetchImpl, `https://api.telegram.org/bot${s.telegramToken}/sendMessage`, { chat_id: s.telegramChatId, text: m.text, disable_web_page_preview: true });
      out.telegram = 'ok';
    } catch (e) {
      out.telegram = e instanceof Error ? e.message : String(e);
    }
  }
  return out;
}
