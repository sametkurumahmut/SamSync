import fsp from 'node:fs/promises';
import path from 'node:path';
import type { RunDetail, RunLogLine, RunSummary } from '../shared/types';
import type { RunLogWriter } from './context';
import { stamp } from './util';
import { locale, t } from '../shared/i18n';

const MAX_RUNS = 300;
/** More lines than this of a run's log are not loaded back (the file keeps them all). */
const MAX_LOG_LINES = 50_000;

export class History {
  private dir: string;
  private index: RunSummary[] | null = null;

  constructor(userData: string) {
    this.dir = path.join(userData, 'history');
  }

  private logFile(id: string): string {
    return path.join(this.dir, `${id}.log`);
  }

  /** A writer that appends a run's log lines to <id>.log as JSON lines, in order, while the run goes on. */
  openLog(id: string): RunLogWriter {
    const file = this.logFile(id);
    let chain: Promise<void> = fsp.mkdir(this.dir, { recursive: true }).then(() => undefined, () => undefined);
    return {
      write: (lines) => {
        if (!lines.length) return;
        const text = lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
        chain = chain.then(() => fsp.appendFile(file, text, 'utf8')).catch(() => undefined);
      },
      close: () => chain,
    };
  }

  private async readLog(id: string): Promise<RunLogLine[] | null> {
    try {
      const text = await fsp.readFile(this.logFile(id), 'utf8');
      const lines = text.split('\n').filter(Boolean);
      const tail = lines.length > MAX_LOG_LINES ? lines.slice(-MAX_LOG_LINES) : lines;
      const out: RunLogLine[] = [];
      for (const l of tail) {
        try {
          out.push(JSON.parse(l) as RunLogLine);
        } catch {
          /* a line cut by a crash */
        }
      }
      return out;
    } catch {
      return null;
    }
  }

  private async load(): Promise<RunSummary[]> {
    if (this.index) return this.index;
    try {
      const text = await fsp.readFile(path.join(this.dir, 'index.json'), 'utf8');
      this.index = JSON.parse(text) as RunSummary[];
    } catch {
      this.index = [];
    }
    return this.index;
  }

  async list(): Promise<RunSummary[]> {
    return [...(await this.load())].sort((a, b) => b.startedAt - a.startedAt);
  }

  async save(run: RunDetail): Promise<void> {
    await fsp.mkdir(this.dir, { recursive: true });
    // a run whose log went to its own file as it ran keeps only that file; the JSON holds the rest
    const hasLogFile = await fsp
      .stat(this.logFile(run.id))
      .then((s) => s.size > 0)
      .catch(() => false);
    await fsp.writeFile(path.join(this.dir, `${run.id}.json`), JSON.stringify(hasLogFile ? { ...run, log: [] } : run), 'utf8');
    const idx = await this.load();
    const { results: _r, log: _l, ...summary } = run;
    const i = idx.findIndex((x) => x.id === run.id);
    if (i >= 0) idx[i] = summary;
    else idx.push(summary);
    idx.sort((a, b) => b.startedAt - a.startedAt);
    const removed = idx.splice(MAX_RUNS);
    for (const r of removed) {
      await fsp.rm(path.join(this.dir, `${r.id}.json`), { force: true }).catch(() => undefined);
      await fsp.rm(this.logFile(r.id), { force: true }).catch(() => undefined);
    }
    await fsp.writeFile(path.join(this.dir, 'index.json'), JSON.stringify(idx), 'utf8');
  }

  /** Writes (or, when empty, removes) the note of a run in the index and in its own file. */
  async setNote(id: string, note: string): Promise<void> {
    const idx = await this.load();
    const s = idx.find((x) => x.id === id);
    if (!s) throw new Error(t('Çalıştırma bulunamadı'));
    if (note) s.note = note;
    else delete s.note;
    const run = await this.get(id);
    if (run) {
      if (note) run.note = note;
      else delete run.note;
      const hasLogFile = await fsp
        .stat(this.logFile(id))
        .then((st) => st.size > 0)
        .catch(() => false);
      await fsp.writeFile(path.join(this.dir, `${id}.json`), JSON.stringify(hasLogFile ? { ...run, log: [] } : run), 'utf8');
    }
    await fsp.writeFile(path.join(this.dir, 'index.json'), JSON.stringify(idx), 'utf8');
  }

  async get(id: string): Promise<RunDetail | null> {
    if (!/^[\w.-]+$/.test(id)) return null;
    try {
      const run = JSON.parse(await fsp.readFile(path.join(this.dir, `${id}.json`), 'utf8')) as RunDetail;
      if (!run.log?.length) run.log = (await this.readLog(id)) ?? [];
      return run;
    } catch {
      return null;
    }
  }

  async remove(id: string): Promise<void> {
    const idx = await this.load();
    const i = idx.findIndex((x) => x.id === id);
    if (i >= 0) idx.splice(i, 1);
    await fsp.rm(path.join(this.dir, `${id}.json`), { force: true }).catch(() => undefined);
    await fsp.rm(this.logFile(id), { force: true }).catch(() => undefined);
    await fsp.mkdir(this.dir, { recursive: true });
    await fsp.writeFile(path.join(this.dir, 'index.json'), JSON.stringify(idx), 'utf8');
  }

  async clear(): Promise<void> {
    await fsp.rm(this.dir, { recursive: true, force: true });
    this.index = [];
  }

  /** Semicolon separated CSV with a BOM so Excel opens it directly (same columns as the PowerShell reports). */
  async exportCsv(id: string, outDir: string): Promise<string | null> {
    const run = await this.get(id);
    if (!run) return null;
    const esc = (v: unknown) => {
      const s = v == null ? '' : String(v);
      return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const titles = new Map(run.targets.map((x) => [x.key, x]));
    const rows = [[t('Zaman'), t('Hedef'), t('Hedef kökü'), t('İşlem'), t('Göreli yol'), t('Sonuç'), t('Yedeklendi'), t('Hata')].join(';')];
    for (const r of run.results) {
      const tgt = titles.get(r.key);
      rows.push(
        [new Date(run.startedAt).toLocaleString(locale()), tgt?.title ?? r.key, tgt?.root ?? '', r.kind, r.rel, r.ok ? t('başarılı') : t('hatalı'), r.backedUp ? t('evet') : '', r.error ?? '']
          .map(esc)
          .join(';'),
      );
    }
    await fsp.mkdir(outDir, { recursive: true });
    // the run id keeps two runs that start in the same second apart
    const file = path.join(outDir, `rapor-${stamp(new Date(run.startedAt))}-${run.id.slice(-6)}.csv`);
    await fsp.writeFile(file, '﻿' + rows.join('\r\n') + '\r\n', 'utf8');
    return file;
  }
}

/** Keeps the newest reports (their names sort by time). */
export async function pruneReports(dir: string, keep = MAX_RUNS): Promise<void> {
  const names = (await fsp.readdir(dir).catch(() => [] as string[])).filter((n) => /^rapor-.*\.csv$/.test(n)).sort().reverse();
  for (const n of names.slice(keep)) await fsp.rm(path.join(dir, n), { force: true }).catch(() => undefined);
}
