// The help bot: a chat drawer that answers questions about SamSync. Offline it searches the FAQ and the
// README (shared/help/search.ts); with a Claude API key set on this machine it asks Claude, with the same
// documents as its only knowledge. Each answer can open the page it talks about.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Bot, Send, Sparkles, X, ArrowRight, Trash2, BookOpen, CircleHelp, Loader2, Wand2 } from 'lucide-react';
import type { AppPage } from '@shared/pages';
import { answer, starterQuestions, type HelpAnswer, type HelpHit } from '@shared/help/search';
import { FAQ_TOPICS } from '@shared/help/faq';
import { useApp, type HelpMessage } from '../store/app';
import { api } from '../lib/api';
import { helpIndex, helpLang } from '../lib/help';
import { inlineMarkdown } from './WhatsNew';
import { Button, useEscapeLayer } from './ui';
import { cls } from '../lib/format';
import { t } from '@shared/i18n';

let seq = 1;
const nextId = () => `m${Date.now().toString(36)}${seq++}`;

/** The answer text and the places to go, for a search result. */
function offlineReply(a: HelpAnswer, lang: 'tr' | 'en'): Omit<HelpMessage, 'id' | 'role'> {
  if (a.intent === 'greeting') return { text: t('Merhaba! SamSync hakkında sorabilirsin: nasıl gönderirim, röle nedir, paket nasıl yazılır, yedekten nasıl dönerim… Ne yapmak istiyorsun?') };
  if (a.intent === 'thanks') return { text: t('Rica ederim. Başka bir şey olursa buradayım.') };
  if (a.intent === 'capabilities') {
    const topics = FAQ_TOPICS.map((x) => x[lang]).join(' • ');
    return { text: t('SamSync ile dosya ve klasörleri birden çok makineye aynı göreli yolla gönderebilir, göndermeden karşılaştırabilir, klasörleri eşitleyebilir, değişince ya da zamanında kendiliğinden gönderebilir, röle ile dağıtabilir, diskle götürülen sürümü paket olarak uygulayabilir, yedekten geri dönebilirsin. Konular: {topics}. Bir konuyu sor ya da aşağıdaki sorulardan birine tıkla.', { topics }), hits: a.hits.slice(0, 3) };
  }
  const best = a.hits[0];
  if (!best || a.confidence === 'none') {
    return { text: t('Bunu belgelerde bulamadım. Başka sözcüklerle sorabilir ya da SSS sayfasındaki konulara bakabilirsin.'), hits: a.hits.slice(0, 3), unsure: true };
  }
  const text = best.doc.kind === 'faq' ? best.doc.body : best.doc.body.length > 900 ? best.doc.body.slice(0, 900) + '…' : best.doc.body;
  return { text: a.confidence === 'low' ? `${t('Sanırım şunu soruyorsun:')} **${best.doc.title}**\n\n${text}` : text, source: best, hits: a.hits.slice(1, 4), unsure: a.confidence === 'low' };
}

function Paragraphs({ text }: { text: string }) {
  const out: ReactNode[] = [];
  text.split(/\n{2,}|\n(?=\d+\))/).forEach((p, i) => {
    const lines = p.split('\n');
    out.push(
      <p key={i}>
        {lines.map((l, j) => (
          <span key={j}>
            {inlineMarkdown(l)}
            {j < lines.length - 1 && <br />}
          </span>
        ))}
      </p>,
    );
  });
  return <>{out}</>;
}

function HitButton({ hit, onGo }: { hit: HelpHit; onGo: (p: AppPage) => void }) {
  const ask = useApp((s) => s.askHelp);
  return (
    <button className="help-hit" onClick={() => (hit.doc.kind === 'faq' ? void ask(hit.doc.title) : hit.doc.page ? onGo(hit.doc.page) : undefined)}>
      {hit.doc.kind === 'faq' ? <CircleHelp size={12} /> : <BookOpen size={12} />}
      <span className="ellipsis">{hit.doc.kind === 'faq' ? hit.doc.title : (hit.doc.section ?? hit.doc.title)}</span>
    </button>
  );
}

export function HelpBot() {
  const open = useApp((s) => s.helpBot);
  const messages = useApp((s) => s.helpMessages);
  const busy = useApp((s) => s.helpBusy);
  const ai = useApp((s) => s.helpAi);
  const aiReady = useApp((s) => s.assistant?.configured ?? false);
  const ask = useApp((s) => s.askHelp);
  const setPage = useApp((s) => s.setPage);
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lang = helpLang();

  useEscapeLayer(() => useApp.setState({ helpBot: false }), open);
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open, messages.length, busy]);

  if (!open) return null;
  const go = (p: AppPage) => {
    setPage(p);
    useApp.setState({ helpBot: false });
  };
  const submit = () => {
    const q = text.trim();
    if (!q || busy) return;
    setText('');
    void ask(q);
  };
  const starters = starterQuestions(lang);

  return (
    <div className="drawer-scrim" onMouseDown={(e) => e.target === e.currentTarget && useApp.setState({ helpBot: false })}>
      <aside className="drawer help-drawer" role="dialog" aria-label={t('Yardım botu')}>
        <div className="drawer-head">
          <div className="icon-tile accent lg">
            <Bot size={19} />
          </div>
          <div className="grow" style={{ minWidth: 0 }}>
            <b style={{ fontSize: 15 }}>{t('SamSync yardım botu')}</b>
            <div className="muted" style={{ fontSize: 12 }}>
              {ai && aiReady ? t('Claude ile yanıtlıyor; belgelerin dışına çıkmaz.') : t('Çevrimdışı: SSS ve README’den yanıtlar.')}
            </div>
          </div>
          {aiReady && (
            <button className={cls('chip', ai && 'on')} data-tip={ai ? t('Yapay zekâ açık: sorular Claude’a gider') : t('Yapay zekâ kapalı: yalnızca çevrimdışı arama')} onClick={() => useApp.getState().setHelpAi(!ai)}>
              <Sparkles size={12} /> {t('Claude')}
            </button>
          )}
          <Button variant="ghost" iconOnly size="sm" icon={<Trash2 size={15} />} tip={t('Sohbeti temizle')} disabled={!messages.length} onClick={() => useApp.setState({ helpMessages: [] })} />
          <Button variant="ghost" iconOnly size="sm" icon={<X size={16} />} onClick={() => useApp.setState({ helpBot: false })} />
        </div>

        <div className="help-messages" ref={listRef}>
          {!messages.length && (
            <div className="help-welcome">
              <p>{t('Merhaba! SamSync hakkında ne sormak istersin? Birkaç örnek:')}</p>
              <div className="col" style={{ gap: 6 }}>
                {starters.map((f) => (
                  <button key={f.id} className="help-starter" onClick={() => void ask(f.q[lang])}>
                    <ArrowRight size={12} /> {f.q[lang]}
                  </button>
                ))}
              </div>
              <button className="link-btn row" style={{ gap: 4, marginTop: 10 }} onClick={() => go('help')}>
                <BookOpen size={13} /> {t('Bütün sorular: SSS sayfası')}
              </button>
              {!aiReady && (
                <div className="faint" style={{ fontSize: 11.5, marginTop: 10 }}>
                  <Wand2 size={11} /> {t('Ayarlar › Yardım botu’na bir Claude API anahtarı girersen serbest sorulara yapay zekâ ile yanıt verir.')}
                </div>
              )}
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={cls('help-msg', m.role)}>
              {m.role === 'bot' && (
                <div className="help-avatar">
                  <Bot size={14} />
                </div>
              )}
              <div className="help-bubble">
                <Paragraphs text={m.text} />
                {m.role === 'bot' && m.ai && (
                  <span className="help-meta">
                    <Sparkles size={10} /> Claude
                  </span>
                )}
                {m.role === 'bot' && m.source && (
                  <div className="help-source">
                    {m.source.doc.kind === 'faq' ? <CircleHelp size={11} /> : <BookOpen size={11} />}
                    <span className="ellipsis">{m.source.doc.kind === 'faq' ? t('SSS') : `README › ${m.source.doc.section ?? m.source.doc.title}`}</span>
                    {m.source.doc.page && (
                      <button className="link-btn" onClick={() => go(m.source!.doc.page!)}>
                        {t('Sayfayı aç')} <ArrowRight size={11} />
                      </button>
                    )}
                  </div>
                )}
                {m.role === 'bot' && m.hits && m.hits.length > 0 && (
                  <div className="help-hits">
                    <span className="faint" style={{ fontSize: 11 }}>
                      {m.unsure ? t('Belki bunlardan biri:') : t('İlgili:')}
                    </span>
                    {m.hits.map((h) => (
                      <HitButton key={h.doc.id} hit={h} onGo={go} />
                    ))}
                  </div>
                )}
                {m.role === 'bot' && m.error && <div className="help-error">{m.error}</div>}
              </div>
            </div>
          ))}
          {busy && (
            <div className="help-msg bot">
              <div className="help-avatar">
                <Bot size={14} />
              </div>
              <div className="help-bubble muted row" style={{ gap: 6 }}>
                <Loader2 size={13} className="spin" /> {ai && aiReady ? t('Claude düşünüyor…') : t('Aranıyor…')}
              </div>
            </div>
          )}
        </div>

        <div className="drawer-foot help-input">
          <input
            ref={inputRef}
            className="input grow"
            value={text}
            placeholder={t('Bir şey sor: nasıl gönderirim, röle nedir…')}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <Button variant="primary" icon={<Send size={14} />} disabled={!text.trim() || busy} onClick={submit}>
            {t('Sor')}
          </Button>
        </div>
      </aside>
    </div>
  );
}

export { offlineReply };
