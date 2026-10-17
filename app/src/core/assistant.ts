// i18n-ignore-file: bilingual content by design (both languages written out), not UI strings for t()
// The help bot's cloud half: when a Claude API key is set on this machine, questions go to Claude with the
// FAQ and the README as its only knowledge, so the answers stay about SamSync. Without a key the bot
// answers from the offline search alone (see shared/help/search.ts).
import Anthropic from '@anthropic-ai/sdk';
import { FAQ } from '../shared/help/faq';
import { t } from '../shared/i18n';
import type { AssistantReply, AssistantTurn } from '../shared/types';

export const ASSISTANT_MODEL = 'claude-opus-5-5';
/** The secrets.json key the API key is kept under (next to the SFTP passwords, encrypted by the OS). */
export const ASSISTANT_SECRET = 'assistant:claude';


/** The system prompt: who the bot is, how to answer, and everything it knows (the FAQ and the README). */
export function assistantSystem(lang: 'tr' | 'en', readme: string, appVersion?: string): string {
  const faq = FAQ.map((f) => `Q: ${f.q[lang]}\nA: ${f.a[lang]}`).join('\n\n');
  const rules =
    lang === 'tr'
      ? `Sen SamSync'in yardım botusun. SamSync, dosyaları, klasörleri ve Git değişikliklerini birden çok makineye aynı göreli yolla gönderen, karşılaştıran ve eşitleyen bir masaüstü uygulamasıdır (sürüm ${appVersion ?? '?'}). Kullanıcılar bir sürümü ya da veriyi birden çok makineye dağıtan ekiplerdir.
Kurallar:
- Yalnızca aşağıdaki SSS ve README'den bildiklerinle, SamSync hakkında yanıt ver. Belgede olmayan bir şeyi uydurma; bilmiyorsan "bunu belgelerde bulamadım" de ve en yakın konuyu öner.
- Türkçe, kısa ve somut yaz: hangi sayfa, hangi düğme, hangi sırayla. Gerekirse numaralı adımlar. Uzun girişler yapma.
- Uygulamadaki adları olduğu gibi kullan (Gönder, İncele ve gönder, Hedefler, Röle, Paket yaz…).
- Sayfa adlarını **kalın** yaz; dosya ve komut adlarını \`tek tırnak\` içinde yaz.
- SamSync dışındaki konulara girme; kibarca bu uygulamayla ilgili sorulara yanıt verdiğini söyle.`
      : `You are SamSync's help bot. SamSync is a desktop app that sends, compares and syncs files, folders and Git changes to several machines under the same relative path (version ${appVersion ?? '?'}). The users are teams distributing a release or data to several machines.
Rules:
- Answer only about SamSync and only from the FAQ and README below. Never invent a feature; when you cannot find it, say "I could not find that in the documentation" and point at the closest topic.
- Write in English, short and concrete: which page, which button, in what order. Numbered steps when they help. No long preambles.
- Use the names as they appear in the app (Send, Review and send, Targets, Relay, Write pack…).
- Page names in **bold**; file and command names in \`code\`.
- Stay on SamSync; politely say you answer questions about this app only.`;
  return `${rules}\n\n=== ${lang === 'tr' ? 'SSS' : 'FAQ'} ===\n${faq}\n\n=== README ===\n${readme}`;
}

/**
 * One question to Claude with the conversation so far. The system prompt is cached between calls (it is the
 * same text every time), so a question costs its own tokens plus a small cache read.
 */
export async function askAssistant(apiKey: string, system: string, turns: AssistantTurn[], opts: { signal?: AbortSignal } = {}): Promise<AssistantReply> {
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000 });
  const messages = turns.slice(-12).map((m) => ({ role: m.role, content: m.content }));
  if (!messages.length || messages[messages.length - 1].role !== 'user') throw new Error(t('Soru yok'));
  const response = await client.beta.messages.create(
    {
      model: ASSISTANT_MODEL,
      max_tokens: 2048,
      // a help chat: quick, short answers
      output_config: { effort: 'low' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages,
    },
    { signal: opts.signal },
  );
  if (response.stop_reason === 'refusal') throw new Error(t('Yanıt verilmedi (içerik güvenliği).'));
  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join('\n')
    .trim();
  const u = response.usage;
  return { text, model: response.model, usage: { input: u.input_tokens, output: u.output_tokens, cached: u.cache_read_input_tokens ?? 0 } };
}

/** The error as a line for the user: wrong key, no credit, rate limit, network. */
export function assistantError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return t('API anahtarı geçersiz.');
  if (e instanceof Anthropic.RateLimitError) return t('Hız sınırı: biraz sonra yeniden deneyin.');
  if (e instanceof Anthropic.PermissionDeniedError) return t('Bu anahtarın izni yok (kredi ya da model erişimi).');
  if (e instanceof Anthropic.APIConnectionError) return t('Claude’a ulaşılamadı (ağ).');
  if (e instanceof Anthropic.APIError) return `${t('Claude hatası')} ${e.status ?? ''}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}
