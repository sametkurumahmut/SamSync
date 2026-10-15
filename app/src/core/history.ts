import fsp from 'node:fs/promises';
import path from 'node:path';
import type { RunDetail, RunSummary } from '../shared/types';
import { stamp } from './util';

const MAX_RUNS = 300;

export class History {
  private dir: string;
  private index: RunSummary[] | null = null;

  constructor(userData: string) {
    this.dir = path.join(userData, 'history');
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
    await fsp.writeFile(path.join(this.dir, `${run.id}.json`), JSON.stringify(run), 'utf8');
    const idx = await this.load();
    const { results: _r, log: _l, ...summary } = run;
    const i = idx.findIndex((x) => x.id === run.id);
    if (i >= 0) idx[i] = summary;
    else idx.push(summary);
    idx.sort((a, b) => b.startedAt - a.startedAt);
    const removed = idx.splice(MAX_RUNS);
    for (const r of removed) await fsp.rm(path.join(this.dir, `${r.id}.json`), { force: true }).catch(() => undefined);
    await fsp.writeFile(path.join(this.dir, 'index.json'), JSON.stringify(idx), 'utf8');
  }

  async get(id: string): Promise<RunDetail | null> {
    if (!/^[\w.-]+$/.test(id)) return null;
    try {
      return JSON.parse(await fsp.readFile(path.join(this.dir, `${id}.json`), 'utf8')) as RunDetail;
    } catch {
      return null;
    }
  }

  async remove(id: string): Promise<void> {
    const idx = await this.load();
    const i = idx.findIndex((x) => x.id === id);
    if (i >= 0) idx.splice(i, 1);
    await fsp.rm(path.join(this.dir, `${id}.json`), { force: true }).catch(() => undefined);
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
    const titles = new Map(run.targets.map((t) => [t.key, t]));
    const rows = [['Zaman', 'Hedef', 'Hedef kökü', 'İşlem', 'Göreli yol', 'Sonuç', 'Yedeklendi', 'Hata'].join(';')];
    for (const r of run.results) {
      const t = titles.get(r.key);
      rows.push(
        [new Date(run.startedAt).toLocaleString('tr-TR'), t?.title ?? r.key, t?.root ?? '', r.kind, r.rel, r.ok ? 'başarılı' : 'hatalı', r.backedUp ? 'evet' : '', r.error ?? '']
          .map(esc)
          .join(';'),
      );
    }
    await fsp.mkdir(outDir, { recursive: true });
    const file = path.join(outDir, `rapor-${stamp(new Date(run.startedAt))}.csv`);
    await fsp.writeFile(file, '﻿' + rows.join('\r\n') + '\r\n', 'utf8');
    return file;
  }
}
