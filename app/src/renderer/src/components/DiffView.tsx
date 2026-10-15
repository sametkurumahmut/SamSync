import { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Columns2, Rows3, FileWarning, CheckCircle2, Copy } from 'lucide-react';
import type { DiffLine, DiffResult } from '@shared/types';
import { Button, Segmented } from './ui';
import { bytes, cls, dateTime } from '../lib/format';

type SplitRow = { kind: 'hunk'; text: string } | { kind: 'pair'; l?: DiffLine; r?: DiffLine };

function toSplit(lines: DiffLine[]): SplitRow[] {
  const out: SplitRow[] = [];
  let dels: DiffLine[] = [];
  let adds: DiffLine[] = [];
  const flush = () => {
    const n = Math.max(dels.length, adds.length);
    for (let i = 0; i < n; i++) out.push({ kind: 'pair', l: dels[i], r: adds[i] });
    dels = [];
    adds = [];
  };
  for (const l of lines) {
    if (l.t === 'del') dels.push(l);
    else if (l.t === 'add') adds.push(l);
    else {
      flush();
      if (l.t === 'hunk') out.push({ kind: 'hunk', text: l.text });
      else out.push({ kind: 'pair', l, r: l });
    }
  }
  flush();
  return out;
}

export function DiffView({ diff, loading, error, title, emptyHint }: { diff: DiffResult | null; loading?: boolean; error?: string; title?: React.ReactNode; emptyHint?: string }) {
  const [mode, setMode] = useState<'unified' | 'split'>(() => (localStorage.getItem('samsync.diffMode') as 'unified' | 'split') || 'unified');
  const setModeP = (m: 'unified' | 'split') => {
    localStorage.setItem('samsync.diffMode', m);
    setMode(m);
  };
  const parent = useRef<HTMLDivElement>(null);
  const lines = diff?.lines ?? [];
  const split = useMemo(() => (mode === 'split' ? toSplit(lines) : []), [lines, mode]);
  const count = mode === 'split' ? split.length : lines.length;
  const v = useVirtualizer({ count, getScrollElement: () => parent.current, estimateSize: () => 20, overscan: 30 });

  const copy = () => {
    const text = lines.map((l) => (l.t === 'add' ? '+' : l.t === 'del' ? '-' : l.t === 'hunk' ? '' : ' ') + l.text).join('\n');
    void navigator.clipboard.writeText(text);
  };

  return (
    <div className="diff">
      <div className="diff-head">
        <div className="grow ellipsis">{title}</div>
        {diff && (diff.additions > 0 || diff.deletions > 0) && (
          <span className="tabular" style={{ fontSize: 12, fontWeight: 600 }}>
            <span style={{ color: 'var(--green)' }}>+{diff.additions}</span> <span style={{ color: 'var(--red)' }}>−{diff.deletions}</span>
          </span>
        )}
        <Segmented
          size="sm"
          value={mode}
          onChange={setModeP}
          options={[
            { value: 'unified', label: '', icon: <Rows3 size={13} />, tip: 'Tek sütun' },
            { value: 'split', label: '', icon: <Columns2 size={13} />, tip: 'Yan yana' },
          ]}
        />
        <Button size="sm" variant="ghost" iconOnly icon={<Copy size={13} />} tip="Farkı panoya kopyala" onClick={copy} disabled={!lines.length} />
      </div>
      {(diff?.leftInfo || diff?.rightInfo) && (
        <div className="diff-meta">
          <div>
            <span className="badge red">{diff.leftLabel ?? 'sol'}</span>
            {diff.leftInfo?.exists ? (
              <span className="faint">
                {bytes(diff.leftInfo.size)} • {dateTime(diff.leftInfo.mtimeMs)}
              </span>
            ) : (
              <span className="faint">yok</span>
            )}
          </div>
          <div>
            <span className="badge green">{diff.rightLabel ?? 'sağ'}</span>
            {diff.rightInfo?.exists ? (
              <span className="faint">
                {bytes(diff.rightInfo.size)} • {dateTime(diff.rightInfo.mtimeMs)}
              </span>
            ) : (
              <span className="faint">yok</span>
            )}
          </div>
        </div>
      )}
      {loading ? (
        <div className="diff-msg">
          <div className="spinner" /> Fark hesaplanıyor…
        </div>
      ) : error ? (
        <div className="diff-msg error">
          <FileWarning size={18} /> {error}
        </div>
      ) : !diff ? (
        <div className="diff-msg faint">{emptyHint ?? 'Farkını görmek için bir dosya seçin'}</div>
      ) : !diff.ok ? (
        <div className="diff-msg">
          <FileWarning size={18} /> {diff.reason}
        </div>
      ) : diff.identical || !lines.length ? (
        <div className="diff-msg">
          <CheckCircle2 size={18} color="var(--green)" /> {diff.reason ?? 'İçerik aynı'}
        </div>
      ) : (
        <div ref={parent} className="diff-scroll selectable">
          {diff.reason && <div className="diff-note">{diff.reason}</div>}
          <div style={{ height: v.getTotalSize(), position: 'relative', minWidth: '100%', width: mode === 'split' ? '100%' : 'max-content' }}>
            {v.getVirtualItems().map((vi) => {
              const style = { position: 'absolute' as const, top: 0, left: 0, right: 0, transform: `translateY(${vi.start}px)`, height: vi.size };
              if (mode === 'unified') {
                const l = lines[vi.index];
                if (l.t === 'hunk')
                  return (
                    <div key={vi.key} className="dl hunk" style={style}>
                      <span className="ln" />
                      <span className="ln" />
                      <span className="code">{l.text}</span>
                    </div>
                  );
                return (
                  <div key={vi.key} className={cls('dl', l.t)} style={style}>
                    <span className="ln">{l.a ?? ''}</span>
                    <span className="ln">{l.b ?? ''}</span>
                    <span className="mk">{l.t === 'add' ? '+' : l.t === 'del' ? '−' : ''}</span>
                    <span className="code">{l.text || ' '}</span>
                  </div>
                );
              }
              const r = split[vi.index];
              if (r.kind === 'hunk')
                return (
                  <div key={vi.key} className="dl hunk" style={style}>
                    <span className="code">{r.text}</span>
                  </div>
                );
              const lt = r.l ? (r.l.t === 'ctx' ? 'ctx' : 'del') : 'none';
              const rt = r.r ? (r.r.t === 'ctx' ? 'ctx' : 'add') : 'none';
              return (
                <div key={vi.key} className="dl split" style={style}>
                  <div className={cls('half', lt)}>
                    <span className="ln">{r.l?.a ?? ''}</span>
                    <span className="code">{r.l?.text ?? ''}</span>
                  </div>
                  <div className={cls('half', rt)}>
                    <span className="ln">{r.r?.b ?? ''}</span>
                    <span className="code">{r.r?.text ?? ''}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
