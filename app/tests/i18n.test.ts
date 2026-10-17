import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { EN, EN_PARTS } from '../src/shared/i18n/en';
import { t, setLang, systemLang, resolveLang } from '../src/shared/i18n';

const SRC = path.join(__dirname, '..', 'src');
const TURKISH = /[çğıöşüÇĞİÖŞÜ]/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (p !== path.join(SRC, 'shared', 'i18n')) out.push(...sourceFiles(p));
    } else if (/\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/** Comments become spaces (newlines kept) so line numbers stay right. Quote strings end at a newline. */
function blankComments(src: string): string {
  let out = '';
  let mode: 'code' | 's' | 'd' | 'tpl' | 'line' | 'block' = 'code';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const c2 = src[i + 1];
    if (mode === 'code') {
      if (c === '/' && c2 === '/') (mode = 'line'), (out += ' ');
      else if (c === '/' && c2 === '*') (mode = 'block'), (out += ' ');
      else {
        if (c === "'") mode = 's';
        else if (c === '"') mode = 'd';
        else if (c === '`') mode = 'tpl';
        out += c;
      }
    } else if (mode === 'line') {
      if (c === '\n') (mode = 'code'), (out += c);
      else out += ' ';
    } else if (mode === 'block') {
      if (c === '*' && c2 === '/') (mode = 'code'), (out += '  '), i++;
      else out += c === '\n' ? c : ' ';
    } else if (c === '\\') {
      out += c + (c2 ?? '');
      i++;
    } else {
      if ((mode === 's' && c === "'") || (mode === 'd' && c === '"') || (mode === 'tpl' && c === '`') || (mode !== 'tpl' && c === '\n')) mode = 'code';
      out += c;
    }
  }
  return out;
}

const CALL = /(?<![\w$.])(?:tk?|tx)\(\s*(?:'((?:\\.|[^'\\\n])*)'|"((?:\\.|[^"\\\n])*)"|`((?:\\.|[^`\\$]|\$(?!\{))*)`)/g;
const DYNAMIC = /(?<![\w$.])(?:tk?|tx)\(\s*`(?:\\.|[^`\\])*?\$\{/g;
const unescape = (s: string) => s.replace(/\\(.)/g, (_, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : c));
const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

interface Scan {
  keys: Map<string, string>;
  dynamic: string[];
  untranslated: string[];
}

function scan(): Scan {
  const keys = new Map<string, string>();
  const dynamic: string[] = [];
  const untranslated: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const rel = path.relative(SRC, file).replace(/\\/g, '/');
    const raw = fs.readFileSync(file, 'utf8');
    let code = blankComments(raw);
    const lineOf = (i: number) => code.slice(0, i).split('\n').length;
    for (const m of code.matchAll(DYNAMIC)) dynamic.push(`${rel}:${lineOf(m.index!)}`);
    for (const m of code.matchAll(CALL)) {
      const key = unescape(m[1] ?? m[2] ?? m[3] ?? '');
      if (!keys.has(key)) keys.set(key, `${rel}:${lineOf(m.index!)}`);
    }
    // what is left with Turkish letters after the t()/tk() texts are blanked was not translated;
    // a file that carries both languages as data (the FAQ, the bot's instructions) says so in its first line
    code = code.replace(CALL, (s) => s.replace(/[^\n]/g, ' '));
    const rawLines = raw.split('\n');
    const wholeFile = rawLines[0]?.includes('i18n-ignore-file');
    if (!wholeFile)
      code.split('\n').forEach((line, i) => {
        if (TURKISH.test(line) && !rawLines[i].includes('i18n-ignore')) untranslated.push(`${rel}:${i + 1}: ${rawLines[i].trim().slice(0, 120)}`);
      });
  }
  return { keys, dynamic, untranslated };
}

const found = scan();

describe('i18n dictionary', () => {
  it('has English for every t()/tk()/tx() text in the sources', () => {
    const missing = [...found.keys].filter(([k]) => !(k in EN)).map(([k, at]) => `${at}  ${JSON.stringify(k)}`);
    expect(missing).toEqual([]);
  });

  it('has no English entry that the sources no longer use', () => {
    expect(Object.keys(EN).filter((k) => !found.keys.has(k))).toEqual([]);
  });

  it('keeps the same placeholders in English', () => {
    const bad: string[] = [];
    for (const [k, v] of Object.entries(EN)) {
      if (typeof v === 'string') {
        if (holes(k).join() !== holes(v).join()) bad.push(`${JSON.stringify(k)} -> ${JSON.stringify(v)}`);
      } else {
        const p = Object.fromEntries(holes(k).map((h) => [h, 2]));
        for (const n of [1, 2]) {
          const out = v({ ...p, ...Object.fromEntries(holes(k).map((h) => [h, n])) });
          if (holes(out).some((h) => !holes(k).includes(h))) bad.push(`${JSON.stringify(k)} -> ${JSON.stringify(out)}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('does not give one Turkish text two different English texts', () => {
    const seen = new Map<string, { part: string; v: string }>();
    const bad: string[] = [];
    // a plural entry is compared by what it gives for one and for two
    const every = (n: number) => new Proxy({}, { get: () => n, has: () => true }) as Record<string, number>;
    const text = (v: (typeof EN)[string]) => (typeof v === 'function' ? `${v(every(1))} | ${v(every(2))}` : v);
    for (const [part, d] of Object.entries(EN_PARTS)) {
      for (const [k, v] of Object.entries(d)) {
        const prev = seen.get(k);
        if (prev && prev.v !== text(v)) bad.push(`${JSON.stringify(k)} in ${prev.part} and ${part}`);
        seen.set(k, { part, v: text(v) });
      }
    }
    expect(bad).toEqual([]);
  });

  it('builds no key at run time from a template', () => {
    expect(found.dynamic).toEqual([]);
  });

  it('leaves no Turkish UI text outside t()/tk()/tx()', () => {
    expect(found.untranslated).toEqual([]);
  });
});

describe('t()', () => {
  afterEach(() => setLang('tr'));

  it('returns the Turkish key with the params filled in, and English when asked', () => {
    expect(t('{n} hedef', { n: 3 })).toBe('3 hedef');
    setLang('en');
    expect(t('Bilinmeyen bir metin {x}', { x: 'y' })).toBe('Bilinmeyen bir metin y');
  });

  it('follows the computer language unless one is picked', () => {
    expect(systemLang(['tr-TR', 'en-US'])).toBe('tr');
    expect(systemLang(['en-US', 'tr-TR'])).toBe('en');
    expect(systemLang(['de-DE'])).toBe('en');
    expect(systemLang([])).toBe('en');
    expect(resolveLang('system', 'tr')).toBe('tr');
    expect(resolveLang('en', 'tr')).toBe('en');
    expect(resolveLang(undefined, 'en')).toBe('en');
  });
});
