import { structuredPatch, type StructuredPatch } from 'diff';
import type { DiffLine, DiffResult } from '../shared/types';

export const MAX_TEXT_DIFF_BYTES = 4 * 1024 * 1024;

export function isBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

export function decodeText(buf: Buffer): string {
  let b = buf;
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) b = b.subarray(3);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch {
    try {
      return new TextDecoder('windows-1254').decode(b);
    } catch {
      return b.toString('latin1');
    }
  }
}

export interface TextDiffOptions {
  context?: number;
  leftLabel?: string;
  rightLabel?: string;
  ignoreWhitespace?: boolean;
}

/** Line diff of two buffers in the same shape git diffs are parsed into. */
export function textDiff(left: Buffer, right: Buffer, opts: TextDiffOptions = {}): DiffResult {
  const base = { leftLabel: opts.leftLabel, rightLabel: opts.rightLabel, additions: 0, deletions: 0, lines: [] as DiffLine[] };
  if (left.length > MAX_TEXT_DIFF_BYTES || right.length > MAX_TEXT_DIFF_BYTES)
    return { ...base, ok: false, tooLarge: true, reason: 'Dosya satır farkı için çok büyük (4 MB üstü)' };
  if (isBinary(left) || isBinary(right)) return { ...base, ok: false, binary: true, identical: left.equals(right), reason: left.equals(right) ? 'İkili dosyalar aynı' : 'İkili dosya: satır farkı gösterilemez' };
  if (left.equals(right)) return { ...base, ok: true, identical: true };
  const a = decodeText(left).replace(/\r\n/g, '\n');
  const b = decodeText(right).replace(/\r\n/g, '\n');
  if (a === b) return { ...base, ok: true, identical: true, reason: 'Yalnızca satır sonları (CRLF/LF) farklı' };
  const patch = (structuredPatch as any)('a', 'b', a, b, undefined, undefined, {
    context: opts.context ?? 3,
    timeout: 4000,
    ignoreWhitespace: opts.ignoreWhitespace,
  }) as StructuredPatch | undefined;
  if (!patch) return { ...base, ok: false, tooLarge: true, reason: 'Fark hesaplanamayacak kadar karmaşık' };
  const lines: DiffLine[] = [];
  let additions = 0;
  let deletions = 0;
  for (const h of patch.hunks) {
    lines.push({ t: 'hunk', text: `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@` });
    let ai = h.oldStart;
    let bi = h.newStart;
    for (const l of h.lines) {
      const c = l[0];
      const text = l.slice(1);
      if (c === '+') {
        lines.push({ t: 'add', b: bi++, text });
        additions++;
      } else if (c === '-') {
        lines.push({ t: 'del', a: ai++, text });
        deletions++;
      } else if (c === ' ') lines.push({ t: 'ctx', a: ai++, b: bi++, text });
    }
  }
  return { ...base, ok: true, lines, additions, deletions, identical: lines.length === 0 };
}
