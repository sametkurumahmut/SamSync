import { AlertTriangle, RefreshCw, Sparkles } from 'lucide-react';
import { useApp } from '../store/app';
import { Button, Modal } from './ui';
import { api } from '../lib/api';
import { shortDate } from '../lib/format';
import { getLang, t } from '@shared/i18n';
import { notesInLang } from '@shared/releasenotes';

/** The release notes as plain text: the update feed carries them as HTML. */
function plainNotes(notes: string): string {
  return notes
    .replace(/<\/(p|li|h[1-6]|div|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The downloaded update, offered in the app's own window instead of the system's plain box: what the version
 * brings, when it came out, and a warning while a send is still running (installing restarts the app).
 */
export function UpdateDialog() {
  const open = useApp((s) => s.updatePrompt);
  const update = useApp((s) => s.update);
  const running = useApp((s) => Object.values(s.runs).filter((r) => !r.done).length);
  const close = () => useApp.setState({ updatePrompt: false });
  if (!open || !update || update.phase !== 'ready') return null;
  const version = update.version ?? '';
  const notes = update.notes ? plainNotes(notesInLang(update.notes, getLang())) : '';
  return (
    <Modal
      title={t('SamSync v{version} kurulmaya hazır', { version })}
      icon={
        <div className="icon-tile accent">
          <Sparkles size={15} />
        </div>
      }
      onClose={close}
      footer={
        <>
          <span className="faint" style={{ fontSize: 12 }}>
            {t('Kurulum birkaç saniye sürer; uygulama kapanıp yeni sürümle açılır.')}
          </span>
          <span className="spacer" />
          <Button onClick={close}>{t('Daha sonra')}</Button>
          <Button variant="primary" icon={<RefreshCw size={14} />} disabled={running > 0} tip={running > 0 ? t('Önce süren gönderimin bitmesini bekleyin') : undefined} onClick={() => void api.updateInstall()}>
            {t('Şimdi kur ve yeniden başlat')}
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 12 }}>
        <div className="row" style={{ gap: 8 }}>
          <span className="badge accent">v{version}</span>
          {update.releaseDate && <span className="faint" style={{ fontSize: 12.5 }}>{t('Yayın: {date}', { date: shortDate(new Date(update.releaseDate).getTime()) })}</span>}
          {update.currentVersion && <span className="faint" style={{ fontSize: 12.5 }}>{t('Şu an: v{version}', { version: update.currentVersion })}</span>}
        </div>
        {running > 0 && (
          <div className="alert warn">
            <AlertTriangle size={15} />
            <span>{t('{n} gönderim sürüyor. Kurulum uygulamayı kapatır; önce bitmesini bekleyin.', { n: running })}</span>
          </div>
        )}
        {notes ? (
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>{t('Bu sürümde')}</div>
            <div className="update-notes selectable">{notes}</div>
          </div>
        ) : (
          <div className="faint" style={{ fontSize: 12.5 }}>{t('Sürüm notları, yayın sayfasında.')}</div>
        )}
      </div>
    </Modal>
  );
}
