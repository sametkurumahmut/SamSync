import { describe, it, expect } from 'vitest';
import { runMessage, sendNotification, wantsNotification, type Fetch } from '../src/core/notifications';
import type { RunDetail } from '../src/shared/types';

const run = (over: Partial<RunDetail> = {}): RunDetail => ({
  id: 'r1',
  label: 'Sürüm 3.4',
  origin: 'send',
  startedAt: 1_000_000,
  finishedAt: 1_000_000 + 125 * 60_000,
  status: 'partial',
  dryRun: false,
  targets: [
    { key: 'PC1', title: 'PC1', root: '', total: 10, done: 10, failed: 0, bytesTotal: 100, bytesDone: 100, status: 'ok' },
    { key: 'PC3', title: 'PC3', root: '', total: 10, done: 10, failed: 10, bytesTotal: 100, bytesDone: 0, status: 'failed', error: 'erişilemedi' },
  ],
  opsTotal: 20,
  opsOk: 10,
  opsFailed: 10,
  bytes: 7_100_000_000,
  sources: ['D:\\Release'],
  targetIds: ['PC1', 'PC3'],
  results: [],
  log: [],
  ...over,
});

describe('run notifications', () => {
  it('writes one line of the result and the failed machines', () => {
    const m = runMessage(run(), { host: 'LAPTOP', user: 'LAPTOP\\ayse', version: '2.0.4' });
    expect(m.text.split('\n')[0]).toMatch(/^△ Sürüm 3\.4 — 1\/2 .* 10 .* 10 .* 2 sa 5 dk$/);
    expect(m.text).toContain('• PC3: erişilemedi');
    // who sent it, as whoami writes it: a local account already names the computer
    expect(m.text.split('\n').pop()).toMatch(/^(Gönderen|Sent by): LAPTOP\\ayse • SamSync 2\.0\.4$/);
    expect(m.payload.user).toBe('LAPTOP\\ayse');
    expect(runMessage(run(), { host: 'PC7', user: 'CORP\\ayse' }).text.split('\n').pop()).toMatch(/CORP\\ayse, PC7$/);
    expect(m.payload.status).toBe('partial');
    expect((m.payload.targets as { id: string }[]).map((x) => x.id)).toEqual(['PC1', 'PC3']);
  });

  it('goes out only for the outcomes the settings ask for, and never for a dry run', () => {
    const s = { webhookUrl: 'http://x', onSuccess: false, onFailure: true };
    expect(wantsNotification(s, { status: 'ok', dryRun: false })).toBe(false);
    expect(wantsNotification(s, { status: 'failed', dryRun: false })).toBe(true);
    expect(wantsNotification(s, { status: 'failed', dryRun: true })).toBe(false);
    expect(wantsNotification({ onSuccess: true, onFailure: true }, { status: 'ok', dryRun: false })).toBe(false);
  });

  it('posts JSON to the webhook and text to the Telegram bot, reporting each channel', async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fetchImpl: Fetch = async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: !url.includes('bad'), status: url.includes('bad') ? 500 : 200, text: async () => 'boom' };
    };
    const m = runMessage(run({ status: 'ok' }), { host: 'H' });
    const r = await sendNotification({ webhookUrl: 'http://hook/bad', telegramToken: 'T', telegramChatId: '42', onSuccess: true, onFailure: true }, m, fetchImpl);
    expect(r.webhook).toMatch(/HTTP 500/);
    expect(r.telegram).toBe('ok');
    expect(calls[0].url).toBe('http://hook/bad');
    expect((calls[0].body as { event: string }).event).toBe('run-done');
    expect(calls[1].url).toBe('https://api.telegram.org/botT/sendMessage');
    expect((calls[1].body as { chat_id: string; text: string }).chat_id).toBe('42');
    expect((calls[1].body as { text: string }).text).toContain('Sürüm 3.4');
  });
});
