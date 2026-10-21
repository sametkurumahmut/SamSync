// Settings › Web interface: server mode on or off, its port, whether the network may reach it, and its password.
// Changed only at the computer itself; a browser sees the state.
import { useEffect, useState } from 'react';
import { Globe, KeyRound, Copy, AlertTriangle, Eye } from 'lucide-react';
import type { WebUiState } from '@shared/types';
import { useApp } from '../store/app';
import { api } from '../lib/api';
import { Button, Field, Modal, ToggleRow } from './ui';
import { t } from '@shared/i18n';

export function WebUiSection({ Section }: { Section: (p: { id: string; icon: React.ReactNode; title: string; desc?: React.ReactNode; children: React.ReactNode }) => React.ReactElement }) {
  const remote = useApp((s) => !!s.boot?.remote);
  const toast = useApp((s) => s.toast);
  const [st, setSt] = useState<WebUiState | null>(null);
  const [port, setPort] = useState('');
  const [pwOpen, setPwOpen] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = () =>
    void api.webUiState().then((s) => {
      setSt(s);
      setPort(String(s.port));
    });
  useEffect(load, []);
  const apply = async (patch: Parameters<typeof api.webUiConfigure>[0]) => {
    setBusy(true);
    try {
      const s = await api.webUiConfigure(patch);
      setSt(s);
      setPort(String(s.port));
      if (s.error) toast('error', t('Web arayüzü başlatılamadı'), s.error);
    } catch (e) {
      toast('error', t('Web arayüzü'), (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!st) return null;
  return (
    <Section id="webui" icon={<Globe size={15} />} title={t('Web arayüzü (sunucu kipi)')} desc={t('Bu bilgisayar SamSync’i ağdaki tarayıcılara sunar: diğer makinelere kurulum gerekmez')}>
      {!st.available ? (
        <p className="muted">{t('Bu özellik yalnızca masaüstü uygulamasında kullanılabilir.')}</p>
      ) : remote ? (
        <p className="muted">{t('Web arayüzü bu bilgisayardan değil, SamSync’in çalıştığı bilgisayardan ayarlanır.')}</p>
      ) : (
        <>
          <ToggleRow
            title={t('Web arayüzünü aç')}
            desc={st.hasPassword ? t('Tarayıcıdan parola ile girilir') : t('Önce bir parola belirleyin')}
            on={st.enabled}
            disabled={busy || !st.hasPassword}
            onChange={(v) => void apply({ enabled: v })}
          />
          <ToggleRow title={t('Ağdan erişilebilir')} desc={t('Kapalıyken yalnızca bu bilgisayardan (127.0.0.1) açılır')} on={st.lan} disabled={busy} onChange={(v) => void apply({ lan: v })} />
          <ToggleRow
            title={t('HTTPS (şifreli bağlantı)')}
            desc={t('Tarayıcı ile bu bilgisayar arasındaki trafik şifrelenir. Sertifikayı bu bilgisayar kendisi üretir: tarayıcı ilk girişte uyarır, bir kez kabul edilir.')}
            on={!!st.https}
            disabled={busy}
            onChange={(v) => void apply({ https: v })}
          />
          <div className="row" style={{ gap: 12, alignItems: 'flex-end', marginTop: 8 }}>
            <Field label={t('Kapı (port)')} style={{ width: 140 }}>
              <input className="input mono" type="number" min={1024} max={65535} value={port} onChange={(e) => setPort(e.target.value)} onBlur={() => Number(port) !== st.port && void apply({ port: Number(port) })} />
            </Field>
            <Button icon={<KeyRound size={14} />} onClick={() => setPwOpen(true)}>
              {st.hasPassword ? t('Parolayı değiştir…') : t('Parola belirle…')}
            </Button>
            <Button icon={<Eye size={14} />} onClick={() => setViewerOpen(true)} tip={t('İkinci bir parola: onunla giren her şeyi görür ama hiçbir şeyi değiştiremez (gönderemez, ayar yapamaz)')}>
              {st.hasViewer ? t('İzleyici parolasını değiştir…') : t('İzleyici parolası…')}
            </Button>
            {st.hasViewer && <Button variant="ghost" onClick={() => void apply({ viewerPassword: null })}>{t('İzleyiciyi kaldır')}</Button>}
          </div>
          {st.running && st.urls.length > 0 && (
            <div className="col" style={{ gap: 4, marginTop: 12 }}>
              <span className="faint" style={{ fontSize: 12 }}>
                {t('Adres')} • {t('{n} tarayıcı bağlı', { n: st.clients })}
              </span>
              {st.urls.map((u) => (
                <div key={u} className="row" style={{ gap: 6 }}>
                  <a className="mono" href={u} onClick={(e) => (e.preventDefault(), void api.openExternal(u))}>
                    {u}
                  </a>
                  <Button size="sm" variant="ghost" iconOnly icon={<Copy size={12} />} tip={t('Kopyala')} onClick={() => void navigator.clipboard.writeText(u)} />
                </div>
              ))}
            </div>
          )}
          {st.running && st.fingerprint && (
            <div className="col" style={{ gap: 2, marginTop: 10 }}>
              <span className="faint" style={{ fontSize: 12 }}>
                {t('Sertifika parmak izi (SHA-256): tarayıcının gösterdiğiyle aynıysa uyarıyı kabul edin')}
              </span>
              <span className="mono selectable" style={{ fontSize: 11.5, wordBreak: 'break-all' }}>
                {st.fingerprint}
              </span>
            </div>
          )}
          {st.error && <div className="alert error" style={{ marginTop: 10 }}>{st.error}</div>}
          <div className="alert warn" style={{ marginTop: 12 }}>
            <AlertTriangle size={15} />
            <span>
              {st.https
                ? t('Giren kişi bu bilgisayarın dosyalarını seçip makinelere gönderebilir. Parolayı yalnızca güvendiğiniz kişilere verin.')
                : t('Giren kişi bu bilgisayarın dosyalarını seçip makinelere gönderebilir. Bağlantı şifrelenmez (HTTP): yalnızca güvenilen ağda kullanın ya da HTTPS’i açın.')}
            </span>
          </div>
          {pwOpen && <PasswordDialog onClose={() => setPwOpen(false)} onSave={(pw) => void apply({ password: pw })} />}
          {viewerOpen && <PasswordDialog title={t('İzleyici parolası')} onClose={() => setViewerOpen(false)} onSave={(pw) => void apply({ viewerPassword: pw })} />}
        </>
      )}
    </Section>
  );
}

function PasswordDialog({ title, onClose, onSave }: { title?: string; onClose: () => void; onSave: (pw: string) => void }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const short = a.length > 0 && a.length < 8;
  const ok = a.length >= 8 && a === b;
  return (
    <Modal
      title={title ?? t('Web arayüzü parolası')}
      icon={<KeyRound size={16} />}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Vazgeç')}</Button>
          <Button
            variant="primary"
            disabled={!ok}
            onClick={() => {
              onClose();
              onSave(a);
            }}
          >
            {t('Kaydet')}
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 10 }}>
        <Field label={t('Parola')} help={short ? t('En az 8 karakter') : t('Bu bilgisayarda yalnızca özeti (scrypt) saklanır')}>
          <input className="input" type="password" autoFocus value={a} onChange={(e) => setA(e.target.value)} />
        </Field>
        <Field label={t('Parola (tekrar)')} error={b && a !== b ? t('Parolalar aynı değil') : undefined}>
          <input className="input" type="password" value={b} onChange={(e) => setB(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok && (onClose(), onSave(a))} />
        </Field>
      </div>
    </Modal>
  );
}
