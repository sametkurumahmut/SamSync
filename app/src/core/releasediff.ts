// What changed on the machines between two points of the history (release points, or any two sends): every file the
// runs in between wrote or deleted there, by its net change. Built from the run results in the history, so it needs
// no machine to be reachable; a file written and later deleted again within the span does not show.
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { ReleaseDiff, ReleaseDiffFile, RunDetail, RunSummary } from '../shared/types';
import { stamp } from './util';
import { locale, t } from '../shared/i18n';

/** The files listed at most; the counts stay whole. */
export const RELEASE_DIFF_MAX = 20_000;

export async function releaseDiff(list: RunSummary[], get: (id: string) => Promise<RunDetail | null>, aId: string, bId: string | null, names: Map<string, string> = new Map()): Promise<ReleaseDiff> {
  const a = list.find((r) => r.id === aId);
  if (!a) throw new Error(t('Çalıştırma bulunamadı'));
  const keys = new Set(a.targets.map((x) => x.key));
  const touches = (r: RunSummary) => !r.dryRun && r.targets.some((x) => keys.has(x.key));
  // the other end: the run named, or the newest one that reached these machines
  const b = bId ? list.find((r) => r.id === bId) : [...list].filter(touches).sort((x, y) => y.startedAt - x.startedAt)[0];
  if (!b) throw new Error(t('Çalıştırma bulunamadı'));
  const [from, to] = a.startedAt <= b.startedAt ? [a, b] : [b, a];
  const between = list.filter((r) => r.startedAt > from.startedAt && r.startedAt <= to.startedAt && touches(r)).sort((x, y) => x.startedAt - y.startedAt);
  const files = new Map<string, { first: ReleaseDiffFile['change']; last: ReleaseDiffFile['change']; machines: Set<string>; sends: Set<string>; lastAt: number; rel: string }>();
  for (const s of between) {
    const d = await get(s.id);
    if (!d) continue;
    const titles = new Map(d.targets.map((x) => [x.key, x.title]));
    for (const r of d.results) {
      if (!r.ok || r.kind === 'mkdir' || !keys.has(r.key)) continue;
      const change: ReleaseDiffFile['change'] = r.kind === 'delete' ? 'removed' : r.created ? 'added' : 'changed';
      const k = r.rel.toLowerCase();
      const e = files.get(k) ?? { first: change, last: change, machines: new Set<string>(), sends: new Set<string>(), lastAt: 0, rel: r.rel };
      e.last = change;
      e.machines.add(titles.get(r.key) ?? r.key);
      e.sends.add(s.id);
      e.lastAt = d.startedAt;
      files.set(k, e);
    }
  }
  const out: ReleaseDiffFile[] = [];
  const counts = { added: 0, changed: 0, removed: 0 };
  for (const e of files.values()) {
    // written and gone again within the span: nothing changed in the end
    if (e.first === 'added' && e.last === 'removed') continue;
    const change: ReleaseDiffFile['change'] = e.last === 'removed' ? 'removed' : e.first === 'added' ? 'added' : 'changed';
    counts[change]++;
    if (out.length < RELEASE_DIFF_MAX) out.push({ rel: e.rel, change, machines: [...e.machines].sort(), sends: e.sends.size, lastAt: e.lastAt });
  }
  out.sort((x, y) => x.rel.localeCompare(y.rel));
  const end = (r: RunSummary) => ({ runId: r.id, label: r.label, at: r.startedAt, name: names.get(r.id) });
  return { from: end(from), to: end(to), runs: between.length, files: out, counts };
}

const CHANGE_TEXT: Record<ReleaseDiffFile['change'], () => string> = { added: () => t('eklendi'), changed: () => t('değişti'), removed: () => t('silindi') };

/** The diff as a CSV (for a spreadsheet) or a self-contained HTML page (to read or send on), in the reports folder. */
export async function writeReleaseDiff(diff: ReleaseDiff, outDir: string, format: 'csv' | 'html'): Promise<string> {
  await fsp.mkdir(outDir, { recursive: true });
  const name = (e: ReleaseDiff['from']) => e.name || e.label;
  const file = path.join(outDir, `fark-${stamp(new Date(diff.from.at))}-${stamp(new Date(diff.to.at))}.${format}`);
  const when = (ms: number) => new Date(ms).toLocaleString(locale());
  if (format === 'csv') {
    const esc = (v: unknown) => {
      const s = v == null ? '' : String(v);
      return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = [[t('Değişiklik'), t('Göreli yol'), t('Makineler'), t('Gönderim'), t('Son')].join(';')];
    for (const f of diff.files) rows.push([CHANGE_TEXT[f.change](), f.rel, f.machines.join(', '), f.sends, when(f.lastAt)].map(esc).join(';'));
    await fsp.writeFile(file, '﻿' + rows.join('\r\n') + '\r\n', 'utf8');
    return file;
  }
  const h = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const title = t('{from} → {to}', { from: name(diff.from), to: name(diff.to) });
  const body = diff.files.map((f) => `<tr class="${f.change}"><td>${h(CHANGE_TEXT[f.change]())}</td><td class="p">${h(f.rel)}</td><td>${h(f.machines.join(', '))}</td><td>${f.sends}</td><td>${h(when(f.lastAt))}</td></tr>`).join('\n');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${h(title)}</title><style>
body{font:13px system-ui,sans-serif;margin:24px;color:#222}h1{font-size:18px}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:4px 8px;border-bottom:1px solid #ddd}td.p{font-family:ui-monospace,Consolas,monospace}tr.added td:first-child{color:#18794e}tr.changed td:first-child{color:#a35200}tr.removed td:first-child{color:#c0262d}
</style></head><body><h1>${h(title)}</h1><p>${h(when(diff.from.at))} → ${h(when(diff.to.at))} • ${h(t('{n} gönderim', { n: diff.runs }))} • ${h(t('{added} eklendi, {changed} değişti, {removed} silindi', diff.counts))}</p>
<table><thead><tr><th>${h(t('Değişiklik'))}</th><th>${h(t('Göreli yol'))}</th><th>${h(t('Makineler'))}</th><th>${h(t('Gönderim'))}</th><th>${h(t('Son'))}</th></tr></thead><tbody>
${body}
</tbody></table></body></html>`;
  await fsp.writeFile(file, html, 'utf8');
  return file;
}
