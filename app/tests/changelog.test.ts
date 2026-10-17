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
