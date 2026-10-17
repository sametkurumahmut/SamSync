import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { answer, buildHelpIndex, readmeDocs, stem, terms } from '../src/shared/help/search';
import { FAQ, FAQ_TOPICS } from '../src/shared/help/faq';

const readmeTr = fs.readFileSync(path.join(__dirname, '..', 'README.tr.md'), 'utf8');
const readmeEn = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
const tr = buildHelpIndex('tr', readmeTr);
const en = buildHelpIndex('en', readmeEn);

const first = (idx: typeof tr, q: string) => answer(idx, q).hits[0]?.doc;

describe('help bot', () => {
  it('stems Turkish and English words lightly', () => {
    expect(stem('gönderimleri', 'tr')).toBe('gönderim');
    expect(stem('makinelerde', 'tr')).toBe('makine');
    expect(stem('yedekleri', 'tr')).toBe('yedek');
    expect(stem('sending', 'en')).toBe('send');
    expect(stem('machines', 'en')).toBe('machine');
    expect(terms('Röle nedir, ne zaman kullanılır?', 'tr')).toContain('rol');
  });

  it('cuts the README into sections with a page for each', () => {
    const docs = readmeDocs(readmeTr, 'tr');
    expect(docs.length).toBeGreaterThan(15);
    expect(docs.some((d) => d.section?.includes('Senkron') && d.page === 'sync')).toBe(true);
    expect(tr.size).toBe(FAQ.length + docs.length);
  });

  it('answers the usual questions with the right FAQ entry (Turkish)', () => {
    expect(first(tr, 'röle nedir')?.id).toBe('faq-relay-what');
    expect(first(tr, 'nasıl gönderirim, ilk kez kullanıyorum')?.id).toBe('faq-first-send');
    expect(first(tr, 'sürümü usb ile götüreceğim')?.id).toBe('faq-pack-write');
    expect(first(tr, 'yanlış dosya gönderdim eski haline nasıl dönerim')?.id).toBe('faq-backup-restore');
    expect(first(tr, 'her gece saat 2de otomatik gönder')?.id).toBe('faq-schedule');
    expect(first(tr, 'gonderim neden bu kadar yavas')?.id).toBe('faq-speed-expectation');
    expect(first(tr, 'telegram bildirimi')?.id).toBe('faq-notify');
    expect(first(tr, 'hangi makinede hangi sürüm var')?.id).toBe('faq-inventory');
  });

  it('answers in English too, and reads the README for what the FAQ does not cover', () => {
    expect(first(en, 'how do I undo a send')?.id).toBe('faq-backup-restore');
    expect(first(en, 'what is a relay')?.id).toBe('faq-relay-what');
    expect(first(en, 'keyboard shortcuts')?.id).toBe('faq-shortcuts');
    const hit = answer(en, 'import profiles from the old wizard');
    expect(hit.hits[0]?.doc.kind).toBe('readme');
    expect(hit.hits[0]?.doc.body.toLowerCase()).toContain('wizard');
  });

  it('knows a greeting, thanks and a capabilities question from a real question', () => {
    expect(answer(tr, 'merhaba').intent).toBe('greeting');
    expect(answer(en, 'thanks!').intent).toBe('thanks');
    expect(answer(tr, 'neler yapabilirsin?').intent).toBe('capabilities');
    expect(answer(tr, 'röle nedir').intent).toBe('question');
  });

  it('says so when it does not know', () => {
    const a = answer(tr, 'xyzzy qwerty plugh');
    expect(a.hits).toEqual([]);
    expect(a.confidence).toBe('none');
    expect(answer(tr, 'röle nedir').confidence).toBe('high');
  });

  it('has every FAQ entry in both languages under a known topic', () => {
    const topics = new Set(FAQ_TOPICS.map((t) => t.id));
    const ids = new Set<string>();
    for (const f of FAQ) {
      expect(topics.has(f.topic)).toBe(true);
      expect(f.q.tr && f.q.en && f.a.tr && f.a.en).toBeTruthy();
      expect(ids.has(f.id)).toBe(false);
      ids.add(f.id);
    }
  });
});
