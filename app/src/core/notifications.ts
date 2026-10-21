// Telling the team: when a run ends, a message to a webhook (any HTTP endpoint, a Teams/Slack flow) and/or
// to a Telegram chat through a bot, as set in this machine's settings. Nothing here blocks the run.
import type { NotificationSettings, RunDetail } from '../shared/types';
import { formatBytes } from './util';
import { t } from '../shared/i18n';

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

export function runMessage(run: RunDetail, from: { host: string; version?: string; user?: string }): RunMessage {
  const ms = (run.finishedAt ?? Date.now()) - run.startedAt;
  const mins = Math.round(ms / 60000);
  const took = ms < 90_000 ? t('{n} sn', { n: Math.round(ms / 1000) }) : mins < 120 ? t('{n} dk', { n: mins }) : t('{h} sa {m} dk', { h: Math.floor(mins / 60), m: mins % 60 });
  const okTargets = run.targets.filter((x) => x.status === 'ok').length;
  const head = `${STATUS_MARK[run.status]} ${run.label} — ${t('{ok}/{n} makine', { ok: okTargets, n: run.targets.length })}, ${t('{n} işlem', { n: run.opsOk })}${run.opsFailed ? `, ${t('{n} hatalı', { n: run.opsFailed })}` : ''}, ${formatBytes(run.bytes)}, ${took}`;
  const failed = run.targets.filter((x) => x.status === 'failed' || x.status === 'partial').map((x) => `• ${x.title}: ${x.error ?? t('{n} hata', { n: x.failed })}`);
  const text = [head, ...failed, `${t('Gönderen: {who}', { who: senderText(from) })}${from.version ? ` • SamSync ${from.version}` : ''}`].join('\n');
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
    targets: run.targets.map((x) => ({ id: x.key, name: x.title, status: x.status, done: x.done, failed: x.failed, bytes: x.bytesDone, error: x.error, via: x.via })),
    text,
  };
  return { text, payload };
}

/** Whether this run should go out, by the settings. */
export function wantsNotification(s: NotificationSettings | undefined, run: Pick<RunDetail, 'status' | 'dryRun'>): boolean {
  if (!s || run.dryRun) return false;
  if (!s.webhookUrl && !(s.telegramToken && s.telegramChatId)) return false;
  return run.status === 'ok' ? !!s.onSuccess : !!s.onFailure;
}

async function post(fetchImpl: Fetch, url: string, body: unknown): Promise<void> {
  const r = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}${await r.text().then((x) => (x ? `: ${x.slice(0, 200)}` : '')).catch(() => '')}`);
}

/** Sends the message to every channel that is set; one result line per channel ('ok' or the error). */
export async function sendNotification(s: NotificationSettings, m: RunMessage, fetchImpl: Fetch = globalThis.fetch as unknown as Fetch): Promise<{ webhook?: string; telegram?: string }> {
  const out: { webhook?: string; telegram?: string } = {};
  if (s.webhookUrl) {
    try {
      await post(fetchImpl, s.webhookUrl, m.payload);
      out.webhook = 'ok';
    } catch (e) {
      out.webhook = e instanceof Error ? e.message : String(e);
    }
  }
  if (s.telegramToken && s.telegramChatId) {
    try {
      await post(fetchImpl, `https://api.telegram.org/bot${s.telegramToken}/sendMessage`, { chat_id: s.telegramChatId, text: m.text, disable_web_page_preview: true });
      out.telegram = 'ok';
    } catch (e) {
      out.telegram = e instanceof Error ? e.message : String(e);
    }
  }
  return out;
}
