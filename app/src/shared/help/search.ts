// i18n-ignore-file: bilingual content by design (both languages written out), not UI strings for t()
// The help bot's offline brain: a small BM25 search over the FAQ and the README of the current language,
// with Turkish- and English-aware word stems and a synonym list, so "gönderim neden yavaş" finds the relay
// and speed answers without any service. Everything here is pure, so it is tested without a window.
import { FAQ, type FaqEntry } from './faq';
import type { AppPage } from '../pages';

export type HelpLang = 'tr' | 'en';

export interface HelpDoc {
  id: string;
  kind: 'faq' | 'readme';
  title: string;
  body: string;
  page?: AppPage;
  /** README: the heading path, for the source line under an answer. */
  section?: string;
  faq?: FaqEntry;
}

export interface HelpHit {
  doc: HelpDoc;
  score: number;
}

export type HelpIntent = 'greeting' | 'thanks' | 'capabilities' | 'question';

export interface HelpAnswer {
  intent: HelpIntent;
  hits: HelpHit[];
  /** How sure the search is about the first hit. */
  confidence: 'high' | 'low' | 'none';
}

// ---------------------------------------------------------------- words

/** Words that mean the same thing for our purposes, across both languages. */
const SYNONYMS: string[][] = [
  ['gönder', 'gönderim', 'yolla', 'send', 'sending', 'transfer', 'kopyala', 'copy', 'at'],
  ['hedef', 'makine', 'machine', 'target', 'node', 'bilgisayar', 'pc', 'istasyon', 'workstation', 'sunucu', 'server'],
  ['röle', 'relay', 'aktarıcı', 'dağıt', 'ana'],
  ['yedek', 'backup', 'geri', 'restore', 'undo', 'eski', 'hâl'],
  ['hız', 'hızlı', 'speed', 'fast', 'slow', 'yavaş', 'performans', 'performance', 'süre', 'sürer', 'uzun'],
  ['paket', 'pack', 'usb', 'disk', 'çevrimdışı', 'offline', 'taşı'],
  ['izle', 'izleme', 'watch', 'otomatik', 'automatic', 'automation', 'otomasyon', 'değişince', 'canlı'],
  ['zamanla', 'zamanlama', 'schedule', 'scheduled', 'saat', 'cron', 'gece', 'periyodik', 'düzenli'],
  ['kısayol', 'shortcut', 'tuş', 'key', 'klavye', 'keyboard', 'hotkey'],
  ['ayar', 'setting', 'settings', 'yapılandır', 'yapılandırma', 'config', 'configuration'],
  ['karşılaştır', 'compare', 'comparison', 'fark', 'diff', 'difference', 'sapma', 'drift'],
  ['senkron', 'sync', 'eşitle', 'synchronize', 'eşzamanla'],
  ['bildirim', 'notification', 'notify', 'telegram', 'webhook', 'teams', 'slack', 'haber'],
  ['manifest', 'envanter', 'inventory', 'sürüm', 'version', 'release', 'hangi'],
  ['hata', 'error', 'sorun', 'problem', 'çalışmıyor', 'olmuyor', 'başarısız', 'failed', 'fail'],
  ['sil', 'delete', 'kaldır', 'remove', 'ayna', 'mirror', 'fazla', 'extra'],
  ['dil', 'language', 'tema', 'theme', 'ölçek', 'scale', 'büyüt', 'zoom', 'yazı', 'font', 'küçük', 'small'],
  ['kilit', 'lock', 'yazıyor', 'writing'],
  ['günlük', 'log', 'rapor', 'report', 'csv', 'tanı', 'diagnostics'],
  ['güncelle', 'güncelleme', 'update', 'setup', 'kurulum', 'install', 'yükle'],
  ['erişilemedi', 'erişim', 'unreachable', 'reach', 'bağlan', 'connect', 'bağlantı', 'paylaşım', 'share', 'ping'],
  ['kullanımda', 'in', 'use', 'kilitli', 'locked', 'dll'],
  ['yarım', 'resume', 'devam', 'iptal', 'cancel', 'kaldığı', 'kopuk', 'broken'],
  ['menü', 'menu', 'explorer', 'sağ', 'tık', 'right', 'click', 'notepad'],
  ['komut', 'command', 'cli', 'satır', 'line', 'görev', 'task', 'scheduler', 'headless'],
  ['git', 'commit', 'değişiklik', 'change', 'repo', 'depo'],
  ['kök', 'root', 'yol', 'path', 'klasör', 'folder', 'dizin', 'directory'],
  ['ekle', 'add', 'yeni', 'new', 'oluştur', 'create', 'tanımla', 'define'],
  ['nedir', 'what', 'nasıl', 'how', 'neden', 'why', 'nerede', 'where', 'hangi', 'which'],
  ['boş', 'blank', 'çöktü', 'crash', 'pencere', 'window', 'açılmıyor'],
  ['genel', 'bakış', 'overview', 'dashboard', 'topoloji', 'topology', 'ağ', 'network', 'çizim', 'harita', 'map'],
  ['incele', 'inceleme', 'review', 'plan', 'onay', 'işaret', 'sign'],
  ['kip', 'mode', 'üzerine', 'overwrite', 'yalnızca', 'update-only'],
  ['profil', 'profile', 'grup', 'group'],
  ['hariç', 'exclude', 'ignore', 'filtre', 'filter', 'dışla', 'samsyncignore'],
  ['sftp', 'ssh', 'parola', 'password', 'anahtar', 'linux'],
];
const SYN_GROUP = new Map<string, number>();
SYNONYMS.forEach((g, i) => g.forEach((w) => SYN_GROUP.set(w, i)));

const STOP = new Set([
  // Turkish
  've', 'veya', 'ile', 'bir', 'bu', 'şu', 'o', 'için', 'mi', 'mı', 'mu', 'mü', 'de', 'da', 'ki', 'ne', 'ya', 'ama', 'çok', 'daha', 'en', 'her', 'gibi', 'kadar', 'sonra', 'önce', 'olur', 'olsun', 'yapar', 'yapabilir', 'istiyorum', 'lazım', 'gerek', 'gerekir', 'acaba', 'peki', 'şey', 'var', 'yok', 'ben', 'biz', 'siz', 'sen', 'bana', 'bize', 'benim',
  // English
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'it', 'i', 'my', 'me', 'we', 'you', 'do', 'does', 'can', 'could', 'should', 'would', 'want', 'need', 'please', 'with', 'from', 'this', 'that', 'be', 'there', 'get', 'got', 'there',
]);

const TR_SUFFIXES = [
  'lardan', 'lerden', 'larda', 'lerde', 'ların', 'lerin', 'ları', 'leri', 'lara', 'lere', 'larla', 'lerle', 'lar', 'ler',
  'ebilir', 'abilir', 'ebiliyor', 'abiliyor', 'miyor', 'mıyor', 'muyor', 'müyor', 'iyor', 'ıyor', 'uyor', 'üyor', 'yor',
  'mişti', 'mıştı', 'muştu', 'müştü', 'miş', 'mış', 'muş', 'müş', 'ecek', 'acak', 'meli', 'malı', 'mek', 'mak',
  'ından', 'inden', 'undan', 'ünden', 'ından', 'sından', 'sinden', 'dan', 'den', 'tan', 'ten', 'nda', 'nde', 'da', 'de', 'ta', 'te',
  'ının', 'inin', 'unun', 'ünün', 'nın', 'nin', 'nun', 'nün', 'ın', 'in', 'un', 'ün',
  'sını', 'sini', 'sunu', 'sünü', 'ını', 'ini', 'unu', 'ünü', 'yı', 'yi', 'yu', 'yü', 'ı', 'i', 'u', 'ü',
  'ına', 'ine', 'una', 'üne', 'ya', 'ye', 'a', 'e',
  'yla', 'yle', 'la', 'le', 'ım', 'im', 'um', 'üm', 'sın', 'sin', 'sun', 'sün', 'dı', 'di', 'du', 'dü', 'tı', 'ti', 'tu', 'tü', 'sız', 'siz', 'suz', 'süz', 'lık', 'lik', 'luk', 'lük', 'cı', 'ci', 'cu', 'cü', 'çı', 'çi', 'çu', 'çü', 'sı', 'si', 'su', 'sü', 'm', 'n',
];
const EN_SUFFIXES = ['ingly', 'ations', 'ation', 'ness', 'ments', 'ment', 'ings', 'ing', 'edly', 'ied', 'ers', 'ed', 'er', 'ly'];

function lower(s: string, lang: HelpLang): string {
  return lang === 'tr' ? s.replace(/I/g, 'ı').replace(/İ/g, 'i').toLowerCase() : s.toLowerCase();
}

/** Diacritics folded to plain letters, so "gonderim" finds "gönderim" and the other way round. */
function fold(s: string): string {
  return s.replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u').replace(/â/g, 'a').replace(/î/g, 'i').replace(/û/g, 'u');
}

/** A light stem: strips the common suffixes, never below three letters (Turkish) / four (English). */
export function stem(word: string, lang: HelpLang): string {
  let w = word;
  if (lang === 'tr') {
    // one suffix (the longest that fits), then a plural that may still be left: more rounds eat into stems
    for (const suf of TR_SUFFIXES) {
      if (w.length - suf.length >= 3 && w.endsWith(suf)) {
        w = w.slice(0, -suf.length);
        break;
      }
    }
    for (const suf of ['lar', 'ler']) if (w.length - 3 >= 3 && w.endsWith(suf)) w = w.slice(0, -3);
    // softened final consonants (kitabı → kitap, ağacı → ağaç)
    if (w.length >= 4) w = w.replace(/b$/, 'p').replace(/c$/, 'ç').replace(/d$/, 't').replace(/ğ$/, 'k');
  } else {
    // plurals first: boxes → box, machines → machine, entries → entry
    if (w.length >= 5 && w.endsWith('ies')) w = w.slice(0, -3) + 'y';
    else if (w.length >= 5 && /(ss|x|z|ch|sh)es$/.test(w)) w = w.slice(0, -2);
    else if (w.length >= 4 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
    for (const suf of EN_SUFFIXES) {
      if (w.length - suf.length >= 4 && w.endsWith(suf)) {
        w = w.slice(0, -suf.length);
        break;
      }
    }
  }
  return w;
}

/** The words of a text as search terms: lower case, split, stop words out, stemmed, diacritics folded. */
export function terms(text: string, lang: HelpLang): string[] {
  const out: string[] = [];
  for (const raw of lower(text, lang).split(/[^\p{L}\p{N}+#]+/u)) {
    if (!raw || raw.length < 2 || STOP.has(raw)) continue;
    const st = stem(raw, lang);
    if (STOP.has(st)) continue;
    out.push(fold(st));
  }
  return out;
}

/** The term plus its synonym group, so the query reaches the other language's words. */
function expand(tokens: string[], lang: HelpLang): string[] {
  const out = new Set(tokens);
  for (const tok of tokens) {
    for (const [word, g] of SYN_GROUP) {
      if (fold(stem(lower(word, lang), lang)) === tok || fold(word) === tok) {
        out.add(`§${g}`);
        break;
      }
    }
  }
  return [...out];
}

// ---------------------------------------------------------------- index

interface Indexed {
  doc: HelpDoc;
  tf: Map<string, number>;
  len: number;
  /** the title's words in order, for the phrase bonus */
  titleWords: string[];
}

/** Two words in a row ("what is", "röle nedir") that the title has as well: the question was phrased like the entry. */
function phraseBonus(queryWords: string[], titleWords: string[]): number {
  const title = ' ' + titleWords.join(' ') + ' ';
  let n = 0;
  for (let i = 0; i + 1 < queryWords.length; i++) if (title.includes(' ' + queryWords[i] + ' ' + queryWords[i + 1] + ' ')) n++;
  return n;
}
const words = (s: string, lang: HelpLang) =>
  lower(s, lang)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map(fold);

export class HelpIndex {
  private docs: Indexed[] = [];
  private df = new Map<string, number>();
  private avgLen = 1;

  constructor(
    readonly lang: HelpLang,
    docs: HelpDoc[],
  ) {
    for (const d of docs) {
      const tf = new Map<string, number>();
      const add = (text: string, weight: number) => {
        for (const t of expand(terms(text, lang), lang)) tf.set(t, (tf.get(t) ?? 0) + weight);
      };
      add(d.title, d.kind === 'faq' ? 3 : 2);
      if (d.faq?.keywords?.length) add(d.faq.keywords.join(' '), 3);
      add(d.body, 1);
      let len = 0;
      for (const v of tf.values()) len += v;
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      this.docs.push({ doc: d, tf, len, titleWords: words(d.title, lang) });
    }
    this.avgLen = this.docs.reduce((a, d) => a + d.len, 0) / Math.max(1, this.docs.length);
  }

  get size(): number {
    return this.docs.length;
  }

  search(query: string, limit = 5): HelpHit[] {
    const qTokens = expand(terms(query, this.lang), this.lang);
    if (!qTokens.length) return [];
    const qWords = words(query, this.lang);
    const N = this.docs.length;
    const k1 = 1.2;
    const b = 0.75;
    const hits: HelpHit[] = [];
    for (const d of this.docs) {
      let score = 0;
      for (const t of qTokens) {
        const f = d.tf.get(t);
        if (!f) continue;
        const n = this.df.get(t) ?? 0;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        // synonym-group matches count a little less than the word itself
        const w = t.startsWith('§') ? 0.6 : 1;
        score += w * idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / this.avgLen)));
      }
      if (score > 0) hits.push({ doc: d.doc, score: (score + 1.5 * phraseBonus(qWords, d.titleWords)) * (d.doc.kind === 'faq' ? 1.25 : 1) });
    }
    hits.sort((a, b2) => b2.score - a.score);
    return hits.slice(0, limit);
  }
}

// ---------------------------------------------------------------- README chunks

/** The README cut into sections: a heading path and the text under it (tables and code kept as text). */
export function readmeDocs(markdown: string, lang: HelpLang): HelpDoc[] {
  const docs: HelpDoc[] = [];
  const stack: string[] = [];
  /** a bold lead ("**Röle** — …", "- **Yedekler** — …") inside a section: its own entry under the section */
  let sub: string | null = null;
  let body: string[] = [];
  let n = 0;
  const flush = () => {
    const text = body.join('\n').trim();
    if (text && stack.length) {
      const title = sub ?? stack[stack.length - 1];
      const section = [...stack, ...(sub ? [sub] : [])].join(' › ');
      docs.push({ id: `readme-${lang}-${n++}`, kind: 'readme', title, body: text.replace(/[*`_>|#]/g, ' ').replace(/\]\([^)]*\)/g, ']').replace(/\s+/g, ' ').slice(0, 1800), section, page: pageOfHeading(stack) });
    }
    body = [];
  };
  for (const line of markdown.split(/\r?\n/)) {
    const m = /^(#{1,4})\s+(.*)$/.exec(line);
    if (m) {
      flush();
      sub = null;
      const level = m[1].length;
      stack.splice(level - 1);
      stack[level - 1] = m[2].trim();
      continue;
    }
    if (/^!\[/.test(line) || /^\|\s*-+/.test(line)) continue;
    const lead = /^(?:[-*]\s+)?\*\*([^*]{3,80})\*\*/.exec(line);
    if (lead) {
      flush();
      sub = lead[1].replace(/[—:–-]\s*$/, '').trim();
    }
    body.push(line);
  }
  flush();
  return docs;
}

function pageOfHeading(stack: string[]): AppPage | undefined {
  const h = stack.join(' ').toLowerCase();
  if (/gönder|send/.test(h) && !/senkron|sync/.test(h)) return 'send';
  if (/karşılaştır|compare/.test(h)) return 'compare';
  if (/git/.test(h)) return 'git';
  if (/senkron|sync/.test(h)) return 'sync';
  if (/otomasyon|automation/.test(h)) return 'automation';
  if (/hedefler|targets|yedekler|backups|geçmiş|history/.test(h)) return 'targets';
  if (/ayarlar|settings|güncelle|update|kurulum|install|menü|menu|komut|command/.test(h)) return 'settings';
  if (/genel bakış|overview/.test(h)) return 'overview';
  return undefined;
}

export function faqDocs(lang: HelpLang): HelpDoc[] {
  return FAQ.map((f) => ({ id: `faq-${f.id}`, kind: 'faq' as const, title: f.q[lang], body: f.a[lang], page: f.page, faq: f }));
}

export function buildHelpIndex(lang: HelpLang, readme?: string): HelpIndex {
  return new HelpIndex(lang, [...faqDocs(lang), ...(readme ? readmeDocs(readme, lang) : [])]);
}

// ---------------------------------------------------------------- answering

const GREETING = /^(merhaba|selam|selamlar|hey|hi|hello|günaydın|iyi akşamlar|iyi günler|naber|nasılsın|sa|slm)\b/i;
const THANKS = /^(teşekkür|teşekkürler|sağ ol|sağol|eyvallah|thanks|thank you|thx|süper|harika|tamam|ok|okay)\b/i;
const CAPABILITIES = /(ne yapabilir|neler yapabilir|ne işe yarar|özellikler|yetenekler|what can (you|it|samsync) do|features|capabilities|help me|yardım et|nasıl kullan)/i;

/** The intent of a line, then the search; `confidence` says whether the first hit deserves to be read out as the answer. */
export function answer(index: HelpIndex, question: string): HelpAnswer {
  const q = question.trim();
  if (!q) return { intent: 'question', hits: [], confidence: 'none' };
  if (GREETING.test(q) && q.split(/\s+/).length <= 3) return { intent: 'greeting', hits: [], confidence: 'none' };
  if (THANKS.test(q) && q.split(/\s+/).length <= 4) return { intent: 'thanks', hits: [], confidence: 'none' };
  if (CAPABILITIES.test(q)) return { intent: 'capabilities', hits: index.search(q, 5), confidence: 'none' };
  const hits = index.search(q, 6);
  if (!hits.length) return { intent: 'question', hits, confidence: 'none' };
  const [a, b] = hits;
  const ratio = b ? a.score / b.score : 2;
  const confidence: HelpAnswer['confidence'] = a.score >= 4 && ratio >= 1.15 ? 'high' : a.score >= 1.6 ? 'low' : 'none';
  return { intent: 'question', hits, confidence };
}

/** A few questions to start with, in the given language. */
export function starterQuestions(lang: HelpLang): FaqEntry[] {
  const ids = ['first-send', 'relay-what', 'pack-write', 'backup-restore', 'schedule', 'speed-expectation'];
  return ids.map((id) => FAQ.find((f) => f.id === id)!).filter(Boolean);
}
