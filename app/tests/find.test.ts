import { describe, it, expect } from 'vitest';
import { foldText, matchScore } from '../src/shared/fold';

describe('settings search folding', () => {
  it('folds case, accents and the dotted and dotless i to plain letters', () => {
    expect(foldText('Röle bitirme süresi')).toBe('role bitirme suresi');
    expect(foldText('İÇERİK Işık ĞŞÜ')).toBe('icerik isik gsu');
    expect(foldText('Telegram’a gönder')).toBe('telegram’a gonder');
  });

  it('keeps the length, so a match in the folded text is a range in the original', () => {
    for (const s of ['İstanbul İzmir', 'Ayarlarda ara: “x”', 'emoji 🚀 ok', 'ß straße', 'ﬁle']) {
      expect(foldText(s)).toHaveLength(s.length);
    }
    const text = 'Röle kapalıysa gruptan başka bir makine röle olsun';
    const at = foldText(text).indexOf(foldText('ROLE OLSUN'));
    expect(text.slice(at, at + 'role olsun'.length)).toBe('röle olsun');
  });

  it('scores the command palette: start, inside, every word, letters in order', () => {
    expect(matchScore('Görünüm ayarları', 'gorunum')).toBe(3);
    expect(matchScore('Ayarlar › Görünüm', 'GÖRÜN')).toBe(2);
    expect(matchScore('PC-1 Makineler Lab-B 10.10.1.31', 'lab-b pc-1')).toBe(2);
    expect(matchScore('PC-1 Makineler Lab-A', 'lab-b pc-1')).toBe(0);
    expect(matchScore('Klavye kısayolları', 'kvks')).toBe(1);
    expect(matchScore('anything', '')).toBe(1);
    expect(matchScore('anything', '   ')).toBe(1);
    expect(matchScore('PC-1 Makineler Lab-B', 'lab ')).toBe(2);
    expect(matchScore('PC-1 Makineler Lab-B', ' lab-b   pc-1 ')).toBe(2);
  });
});
