// The two small dialogs around password-protected packs: writing one (an optional password, typed twice) and
// opening one that arrived closed (the password, checked against the file at once).
import { useState } from 'react';
import { FileInput, KeyRound, Package } from 'lucide-react';
import { useApp } from '../store/app';
import { Button, Checkbox, Field, Modal, Segmented, ToggleRow } from './ui';
import { useTargetNodes } from './TargetPicker';
import { api } from '../lib/api';
import { baseName } from '../lib/format';
import { t } from '@shared/i18n';

type PackKind = 'full' | 'pack' | 'machine';

export function PackWriteDialog({ onClose, onWrite }: { onClose: () => void; onWrite: (password?: string, since?: { pack?: string; targetId?: string }) => void }) {
  const [protect, setProtect] = useState(false);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [show, setShow] = useState(false);
  // an incremental pack carries only what changed since an earlier pack, or since what a reachable machine holds
  const [kind, setKind] = useState<PackKind>('full');
  const [sincePack, setSincePack] = useState('');
  const nodes = useTargetNodes();
  const [sinceNode, setSinceNode] = useState(nodes[0]?.id ?? '');
  const isElectron = useApp((s) => s.boot!.isElectron);
  const short = protect && pw.length < 4;
  const mismatch = protect && pw2 !== '' && pw !== pw2;
  const sinceOk = kind === 'full' || (kind === 'pack' ? !!sincePack : !!sinceNode);
  const ready = (!protect || (!short && pw === pw2)) && sinceOk;
  const go = () => {
    if (!ready) return;
    onClose();
    onWrite(protect ? pw : undefined, kind === 'pack' ? { pack: sincePack } : kind === 'machine' ? { targetId: sinceNode } : undefined);
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
      <Field label={t('İçerik')} style={{ marginBottom: 10 }}>
        <Segmented<PackKind>
          value={kind}
          onChange={setKind}
          options={[
            { value: 'full', label: t('Tam'), tip: t('Seçili kaynakların tamamı') },
            { value: 'pack', label: t('Önceki pakete göre'), tip: t('Yalnızca o paketten beri değişen ya da eklenen dosyalar; paket yine bütün listeyi taşır') },
            { value: 'machine', label: t('Makinedeki sürüme göre'), tip: t('Makinenin manifestine göre değişenler; makineye şimdi erişilebilmeli') },
          ]}
        />
      </Field>
      {kind === 'pack' && (
        <Field label={t('Önceki paket')} help={t('Hedef makineye en son uygulanan paket. Uygulanmamış bir paket seçilirse yeni paket o makinede eksik kalır.')} style={{ marginBottom: 10 }}>
          <div className="row" style={{ gap: 6 }}>
            <input className="input mono" value={sincePack} onChange={(e) => setSincePack(e.target.value.trim())} placeholder="…\\surum-20261020-1030.samsync-pack" spellCheck={false} />
            <Button
              icon={<FileInput size={14} />}
              disabled={!isElectron}
              onClick={async () => {
                const [p] = await api.pick({ files: true, title: t('Önceki paket'), filters: [{ name: 'SamSync pack', extensions: ['samsync-pack'] }] });
                if (p) setSincePack(p);
              }}
            >
              {t('Seç…')}
            </Button>
          </div>
        </Field>
      )}
      {kind === 'machine' && (
        <Field label={t('Makine')} help={t('Paket, bu makinenin manifestinde olduğu gibi duran dosyaları atlar; uygulandığında bunlar yerinde olmalıdır.')} style={{ marginBottom: 10 }}>
          <select className="select" aria-label={t('Makine')} value={sinceNode} onChange={(e) => setSinceNode(e.target.value)}>
            {nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </select>
        </Field>
      )}
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
