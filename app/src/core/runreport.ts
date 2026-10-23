// A run as one HTML page to hand on (mail it, attach it to a ticket, print it): what was sent where, how each machine
// ended, the errors with what they likely mean. Self-contained: no scripts, no outside files.
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { RunDetail } from '../shared/types';
import { errorHint } from '../shared/errorhint';
import { formatBytes, stamp } from './util';
import { locale, t } from '../shared/i18n';

const MAX_ERRORS = 500;

const STATUS_TEXT: Record<string, () => string> = {
  ok: () => t('Başarılı'),
  partial: () => t('Kısmen'),
  failed: () => t('Hatalı'),
  cancelled: () => t('İptal edildi'),
  running: () => t('Sürüyor'),
  queued: () => t('Sırada'),
};

export async function writeRunHtml(run: RunDetail, outDir: string, releaseName?: string): Promise<string> {
  await fsp.mkdir(outDir, { recursive: true });
  const safe = run.label.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60).trim() || 'run';
  const file = path.join(outDir, `rapor-${stamp(new Date(run.startedAt))}-${safe}.html`);
  const h = (s: unknown) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  const when = (ms?: number) => (ms ? new Date(ms).toLocaleString(locale()) : '');
  const took = (a?: number, b?: number) => (a && b ? `${Math.max(1, Math.round((b - a) / 1000))} ${t('sn')}` : '');
  const status = (s: string) => (STATUS_TEXT[s] ?? (() => s))();
  const titleOf = new Map(run.targets.map((x) => [x.key, x.title]));

  const machines = run.targets
    .map((x) => {
      const hint = x.status === 'failed' || x.status === 'partial' ? errorHint(x.error) : null;
      const via = x.via ? ` <span class="m">${h(t('{relay} üzerinden', { relay: titleOf.get(x.via) ?? x.via }))}</span>` : '';
      return `<tr class="${h(x.status)}"><td>${h(x.title)}${via}</td><td class="s">${h(status(x.status))}</td><td class="n">${x.done - x.failed}/${x.total}</td><td class="n">${h(formatBytes(x.bytesDone))}</td><td class="n">${h(took(x.startedAt, x.finishedAt))}</td><td>${h(x.error)}${hint ? `<div class="hint">${h(hint)}</div>` : ''}</td></tr>`;
    })
    .join('\n');
  const failed = run.results.filter((r) => !r.ok);
  const errors = failed
    .slice(0, MAX_ERRORS)
    .map((r) => `<tr><td>${h(titleOf.get(r.key) ?? r.key)}</td><td class="p">${h(r.rel)}</td><td>${h(r.error)}</td></tr>`)
    .join('\n');
  const head = [
    when(run.startedAt),
    took(run.startedAt, run.finishedAt),
    formatBytes(run.bytes),
    t('{ok} başarılı, {failed} hatalı', { ok: run.opsOk, failed: run.opsFailed }),
    run.dryRun ? t('deneme çalıştırması') : '',
  ].filter(Boolean);
  const html = `<!doctype html><html lang="${h(locale())}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${h(run.label)}</title><style>
body{font:13px system-ui,sans-serif;margin:24px;color:#222;max-width:1100px}h1{font-size:19px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 6px}
.meta{color:#555}.note{margin:10px 0;padding:8px 10px;background:#fff8e6;border-left:3px solid #d97706;white-space:pre-wrap}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:4px 8px;border-bottom:1px solid #ddd;vertical-align:top}
td.n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}td.p{font-family:ui-monospace,Consolas,monospace;word-break:break-all}.m{color:#666;font-size:12px}
tr.ok td.s{color:#18794e}tr.partial td.s{color:#a35200}tr.failed td.s{color:#c0262d}tr.cancelled td.s{color:#666}.hint{color:#a35200;font-size:12px;margin-top:2px}
ul{margin:4px 0;padding-left:18px}li{font-family:ui-monospace,Consolas,monospace}
</style></head><body>
<h1>${h(run.label)}${releaseName ? ` — ${h(releaseName)}` : ''}</h1>
<div class="meta">${h(status(run.status))} • ${head.map(h).join(' • ')}</div>
${run.note ? `<div class="note">${h(run.note)}</div>` : ''}
${run.sources.length ? `<h2>${h(t('Kaynaklar'))}</h2><ul>${run.sources.map((s) => `<li>${h(s)}</li>`).join('')}</ul>` : ''}
<h2>${h(t('Makineler'))}</h2>
<table><thead><tr><th>${h(t('Makine'))}</th><th>${h(t('Sonuç'))}</th><th>${h(t('İşlem'))}</th><th>${h(t('Aktarılan'))}</th><th>${h(t('Süre'))}</th><th>${h(t('Hata'))}</th></tr></thead><tbody>
${machines}
</tbody></table>
${failed.length ? `<h2>${h(t('Hatalar ({n})', { n: failed.length }))}</h2><table><thead><tr><th>${h(t('Makine'))}</th><th>${h(t('Göreli yol'))}</th><th>${h(t('Hata'))}</th></tr></thead><tbody>
${errors}
</tbody></table>${failed.length > MAX_ERRORS ? `<p class="meta">${h(t('… ve {n} hata daha', { n: failed.length - MAX_ERRORS }))}</p>` : ''}` : ''}
<p class="meta">SamSync • ${h(when(Date.now()))}</p>
</body></html>`;
  await fsp.writeFile(file, html, 'utf8');
  return file;
}
