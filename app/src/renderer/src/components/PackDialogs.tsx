// The two small dialogs around password-protected packs: writing one (an optional password, typed twice) and
// opening one that arrived closed (the password, checked against the file at once).
import { useState } from 'react';
import { KeyRound, Package } from 'lucide-react';
import { useApp } from '../store/app';
import { Button, Checkbox, Field, Modal, ToggleRow } from './ui';
import { baseName } from '../lib/format';
import { t } from '@shared/i18n';

export function PackWriteDialog({ onClose, onWrite }: { onClose: () => void; onWrite: (password?: string) => void }) {
  const [protect, setProtect] = useState(false);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [show, setShow] = useState(false);
  const short = protect && pw.length < 4;
  const mismatch = protect && pw2 !== '' && pw !== pw2;
  const ready = !protect || (!short && pw === pw2);
  const go = () => {
    if (!ready) return;
    onClose();
    onWrite(protect ? pw : undefined);
  };
  return (
    <Modal
      title={t('Paket yaz')}
      icon={<Package size={16} />}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Vazgeç')}</Button>
          <Button variant="primary" disabled={!ready} onClick={go}>
            {t('Klasör seç ve yaz…')}
          </Button>
        </>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>
        {t('Kaynaklar tek bir .samsync-pack dosyasına yazılır; diskle götürülür, hedef makinede SamSync ile uygulanır ve manifest bırakılır.')}
      </p>
      <ToggleRow title={t('Parolayla koru')} desc={t('İçerik AES-256 ile şifrelenir; uygulayan makinede parola sorulur. Parola kaybolursa paket açılamaz.')} on={protect} onChange={setProtect} />
      {protect && (
        <div className="col" style={{ gap: 10, marginTop: 10 }}>
          <Field label={t('Parola')} help={short && pw ? t('En az 4 karakter') : undefined}>
            <input className="input" type={show ? 'text' : 'password'} value={pw} autoFocus onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
          </Field>
          <Field label={t('Parola (tekrar)')} error={mismatch ? t('Parolalar aynı değil') : undefined}>
            <input className="input" type={show ? 'text' : 'password'} value={pw2} onChange={(e) => setPw2(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
          </Field>
          <label className="check-label">
            <Checkbox checked={show} onChange={setShow} /> {t('Parolayı göster')}
          </label>
        </div>
      )}
    </Modal>
  );
}

export function PackUnlockDialog({ path, onClose }: { path: string; onClose: () => void }) {
  const unlockPack = useApp((s) => s.unlockPack);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState(false);
  const go = async () => {
    if (!pw || busy) return;
    setBusy(true);
    const r = await unlockPack(path, pw).catch(() => 'wrong' as const);
    setBusy(false);
    if (r === 'ok') onClose();
    else setWrong(true);
  };
  return (
    <Modal
      title={t('Paket parolası')}
      icon={<KeyRound size={16} />}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Vazgeç')}</Button>
          <Button variant="primary" loading={busy} disabled={!pw} onClick={() => void go()}>
            {t('Aç')}
          </Button>
        </>
      }
    >
      <p className="muted mono ellipsis" title={path} style={{ marginTop: 0 }}>
        {baseName(path)}
      </p>
      <Field label={t('Parola')} error={wrong ? t('Parola yanlış') : undefined} help={t('Paketi yazan kişinin verdiği parola; bir kez girilir, uygulama kapanana dek hatırlanır.')}>
        <input
          className="input"
          type="password"
          value={pw}
          autoFocus
          onChange={(e) => {
            setPw(e.target.value);
            setWrong(false);
          }}
          onKeyDown={(e) => e.key === 'Enter' && void go()}
        />
      </Field>
    </Modal>
  );
}
