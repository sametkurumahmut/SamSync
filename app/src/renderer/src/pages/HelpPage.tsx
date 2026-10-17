// Help: a search over everything the bot knows, the FAQ by topic, and a button for the bot itself.
import { useMemo, useState } from 'react';
import { Bot, Search, ChevronDown, ChevronRight, ArrowRight, BookOpen, CircleHelp, ExternalLink } from 'lucide-react';
import { FAQ, FAQ_TOPICS, type FaqTopic } from '@shared/help/faq';
import { useApp } from '../store/app';
import { api } from '../lib/api';
import { helpIndex, helpLang } from '../lib/help';
import { inlineMarkdown } from '../components/WhatsNew';
import { Button } from '../components/ui';
import { readStored, writeStored } from '../lib/persist';
import { cls } from '../lib/format';
import { t } from '@shared/i18n';

export function HelpPage() {
  const lang = helpLang();
  const setPage = useApp((s) => s.setPage);
  const repositoryUrl = useApp((s) => s.boot?.repositoryUrl);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Set<string>>(() => new Set(readStored<string[]>('samsync.help.open', [])));
  const toggle = (id: string) => {
    const next = new Set(open);
    next.has(id) ? next.delete(id) : next.add(id);
    setOpen(next);
    writeStored('samsync.help.open', [...next]);
  };
  const ql = q.trim();
  const hits = useMemo(() => (ql.length >= 2 ? helpIndex(lang).search(ql, 8) : []), [ql, lang]);
  const faqHits = new Set(hits.filter((h) => h.doc.kind === 'faq').map((h) => h.doc.faq!.id));
  const readmeHits = hits.filter((h) => h.doc.kind === 'readme');

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>{t('Yardım')}</h1>
          <div className="sub">{t('Sık sorulan sorular ve SamSync’i anlatan bot. Her yanıt ilgili sayfayı açabilir.')}</div>
        </div>
        <Button variant="primary" icon={<Bot size={15} />} onClick={() => useApp.setState({ helpBot: true })}>
          {t('Bota sor')}
        </Button>
      </div>
      <div className="page-body">
        <div className="help-search">
          <Search size={15} className="faint" />
          <input className="input grow" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Ara: röle, paket, yedek, zamanlama…')} autoFocus />
          {ql && (
            <span className="faint" style={{ fontSize: 12 }}>
              {t('{n} sonuç', { n: hits.length })}
            </span>
          )}
        </div>

        {ql && readmeHits.length > 0 && (
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-head">
              <div className="icon-tile">
                <BookOpen size={15} />
              </div>
              <h2>{t('README’den')}</h2>
            </div>
            <div className="card-body col" style={{ gap: 10 }}>
              {readmeHits.slice(0, 3).map((h) => (
                <div key={h.doc.id} className="help-readme-hit">
                  <div className="row" style={{ gap: 8 }}>
                    <b style={{ fontSize: 13 }}>{h.doc.section ?? h.doc.title}</b>
                    <span className="spacer" />
                    {h.doc.page && (
                      <button className="link-btn" onClick={() => setPage(h.doc.page!)}>
                        {t('Sayfayı aç')} <ArrowRight size={11} />
                      </button>
                    )}
                  </div>
                  <p className="muted" style={{ fontSize: 12.5, margin: '4px 0 0' }}>
                    {h.doc.body.slice(0, 420)}
                    {h.doc.body.length > 420 ? '…' : ''}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {FAQ_TOPICS.map((topic) => {
          const entries = FAQ.filter((f) => f.topic === topic.id && (!ql || faqHits.has(f.id)));
          if (!entries.length) return null;
          return <TopicCard key={topic.id} id={topic.id} title={topic[lang]} entries={entries} lang={lang} open={open} toggle={toggle} forceOpen={!!ql} setPage={setPage} />;
        })}
        {ql && !hits.length && (
          <div className="card">
            <div className="card-body muted" style={{ fontSize: 13 }}>
              {t('Bu sözcüklerle bir şey bulunamadı. Bota sorabilir ya da başka bir deyişle arayabilirsin.')}
            </div>
          </div>
        )}
        <div className="row faint" style={{ fontSize: 12, marginTop: 14, gap: 12 }}>
          <span>{t('Belgelerin tamamı README dosyasındadır (uygulamayla birlikte gelir).')}</span>
          {repositoryUrl && (
            <button className="link-btn row" style={{ gap: 4 }} onClick={() => void api.openExternal(repositoryUrl)}>
              <ExternalLink size={11} /> GitHub
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function TopicCard({ id, title, entries, lang, open, toggle, forceOpen, setPage }: { id: FaqTopic; title: string; entries: typeof FAQ; lang: 'tr' | 'en'; open: Set<string>; toggle: (id: string) => void; forceOpen: boolean; setPage: (p: NonNullable<(typeof FAQ)[number]['page']>) => void }) {
  return (
    <div className="card help-topic" id={`help-${id}`} style={{ marginBottom: 12 }}>
      <div className="card-head">
        <div className="icon-tile">
          <CircleHelp size={15} />
        </div>
        <h2>{title}</h2>
        <span className="faint" style={{ fontSize: 12 }}>
          {t('{n} soru', { n: entries.length })}
        </span>
      </div>
      <div className="help-faq">
        {entries.map((f) => {
          const on = forceOpen || open.has(f.id);
          return (
            <div key={f.id} className={cls('help-faq-item', on && 'open')}>
              <button className="help-faq-q" onClick={() => toggle(f.id)} aria-expanded={on}>
                {on ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span>{f.q[lang]}</span>
              </button>
              {on && (
                <div className="help-faq-a">
                  <p>{inlineMarkdown(f.a[lang])}</p>
                  {f.page && (
                    <button className="link-btn row" style={{ gap: 4 }} onClick={() => setPage(f.page!)}>
                      {t('Sayfayı aç')} <ArrowRight size={11} />
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
