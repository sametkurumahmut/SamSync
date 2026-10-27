import { describe, it, expect } from 'vitest';
import { changelogSection } from '../src/core/changelog';

const md = `# Sürüm Geçmişi

## Yayımlanmamış

- Taslak madde

## 2.0.4 — 2026-10-18

- **Genel bakış:** makineler ve son gönderimler
  tek ekranda.
- Paket dosyaları: \`.samsync-pack\`.

## 2.0.3 — 2026-10-17

- Manifest.
`;

describe('changelog section', () => {
  it('returns the bullets of one version with its date, joining wrapped lines', () => {
    const s = changelogSection(md, '2.0.4');
    expect(s?.date).toBe('2026-10-18');
    expect(s?.items).toEqual(['**Genel bakış:** makineler ve son gönderimler tek ekranda.', 'Paket dosyaları: `.samsync-pack`.']);
  });

  it('is null for a version that is not in the file, and takes a heading without a date', () => {
    expect(changelogSection(md, '9.9.9')).toBeNull();
    expect(changelogSection(md, '2.0.3')?.items).toEqual(['Manifest.']);
    expect(changelogSection('## 3.0.0\n- a\n- b\n', '3.0.0')).toEqual({ version: '3.0.0', date: undefined, items: ['a', 'b'] });
  });
});

describe('release notes', () => {
  it('show the English part, or the Turkish fold in Turkish', async () => {
    const { notesInLang } = await import('../src/shared/releasenotes');
    const html = '<ul>\n<li>New</li>\n</ul>\n<details>\n<summary>Türkçe</summary>\n<ul>\n<li>Yeni</li>\n</ul>\n</details>';
    expect(notesInLang(html, 'en')).toBe('<ul>\n<li>New</li>\n</ul>');
    expect(notesInLang(html, 'de')).toBe('<ul>\n<li>New</li>\n</ul>');
    expect(notesInLang(html, 'tr')).toBe('<ul>\n<li>Yeni</li>\n</ul>');
    // notes of a release from before the fold stay whole
    expect(notesInLang('<p>Eski</p>', 'tr')).toBe('<p>Eski</p>');
  });

  it('are written English first, with the Turkish folded under it, for the version being built', async () => {
    const { execFileSync } = await import('node:child_process');
    const path = await import('node:path');
    const fs = await import('node:fs');
    const root = path.resolve(__dirname, '..');
    const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const out = execFileSync(process.execPath, [path.join(root, 'scripts', 'release-notes.mjs'), version], { encoding: 'utf8' });
    const fold = out.indexOf('<details>\n<summary>Türkçe</summary>');
    expect(fold).toBeGreaterThan(0);
    expect(out.slice(0, fold)).not.toMatch(/[çğıöşüÇĞİÖŞÜ]/);
    expect(out.trimEnd().endsWith('</details>')).toBe(true);
  });
});
