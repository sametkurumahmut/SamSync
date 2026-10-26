import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileJson, FolderOpen, Save, Upload, Wand2 } from 'lucide-react';
import { useApp } from '../store/app';
import { api } from '../lib/api';
import { useUnsaved } from '../lib/unsaved';
import { Button, Modal } from './ui';
import { t } from '@shared/i18n';
import { askConfirm } from './ConfirmDialog';

/** Where JSON.parse stopped, as line and column, so the message points at the text. */
function parseError(text: string): string | null {
  try {
    JSON.parse(text);
    return null;
  } catch (e) {
    const msg = (e as Error).message;
    const pos = Number(/position (\d+)/.exec(msg)?.[1]);
    if (!Number.isFinite(pos)) return msg;
    const before = text.slice(0, pos);
    const line = before.split('\n').length;
    const col = pos - before.lastIndexOf('\n');
    return t('Satır {line}, sütun {col}: {error}', { line, col, error: msg.replace(/ in JSON at position \d+.*$/, '') });
  }
}

/** The configuration file as JSON: edit, check, save, load another file into it, export a copy. */
export function ConfigEditor({ onClose }: { onClose: () => void }) {
  const boot = useApp((s) => s.boot!);
  const setBoot = useApp((s) => s.setBoot);
  const toast = useApp((s) => s.toast);
  const [original, setOriginal] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    void api.configText().then((s) => {
      setOriginal(s);
      setText(s);
    });
  }, []);

  const error = useMemo(() => (original == null ? null : parseError(text)), [text, original]);
  const dirty = original != null && text !== original;
  useUnsaved('config.json', t('Yapılandırma (JSON)'), dirty);

  const save = async () => {
    setSaving(true);
    setServerError(null);
    try {
      const b = await api.saveConfigText(text);
      setBoot(b);
      setOriginal(text);
      toast('ok', t('Yapılandırma kaydedildi'), t('{n} makine', { n: b.config.nodes.length }));
      onClose();
    } catch (e) {
      setServerError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    } finally {
      setSaving(false);
    }
  };

  const format = () => {
    try {
      setText(`${JSON.stringify(JSON.parse(text), null, 2)}\n`);
    } catch {
      /* the error is shown already */
    }
  };

  const load = async () => {
    const [p] = await api.pick({ files: true, title: t('Yüklenecek config.json'), filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (!p) return;
    try {
      setText(await api.configText(p));
      toast('info', t('Dosya düzenleyiciye yüklendi'), t('Gözden geçirip Kaydet’e basınca mevcut yapılandırmanın yerine geçer.'));
    } catch (e) {
      toast('error', t('Dosya okunamadı'), (e as Error).message);
    }
  };

  const exportCopy = async () => {
    const p = await api.pickSave({ title: t('Yapılandırmayı dışa aktar'), defaultPath: 'config.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (!p) return;
    await api.exportConfig(p);
    toast('ok', t('Yapılandırma dışa aktarıldı'), p);
  };

  return (
    <Modal
      size="wide"
      closeOnScrim={false}
      title={t('Yapılandırmayı düzenle')}
      icon={
        <div className="icon-tile accent">
          <FileJson size={16} />
        </div>
      }
      onClose={async () => {
        if (dirty && !(await askConfirm(t('Kaydedilmemiş değişiklikler var: {what}. Sayfadan çıkılsın mı? Bu değişiklikler kaybolur.', { what: t('Yapılandırma (JSON)') }), { danger: true }))) return;
        onClose();
      }}
      footer={
        <>
          <Button size="sm" icon={<FolderOpen size={13} />} disabled={!boot.isElectron} onClick={() => void load()}>
            {t('Dosyadan yükle…')}
          </Button>
          <Button size="sm" icon={<Upload size={13} />} disabled={!boot.isElectron} onClick={() => void exportCopy()}>
            {t('Dışa aktar…')}
          </Button>
          <Button size="sm" variant="ghost" icon={<Wand2 size={13} />} disabled={!!error} onClick={format}>
            {t('Biçimlendir')}
          </Button>
          <span className="spacer" />
          <Button onClick={onClose}>{t('Vazgeç')}</Button>
          <Button variant="primary" icon={<Save size={14} />} loading={saving} disabled={!dirty || !!error || !boot.configWritable} onClick={() => void save()}>
            {t('Kaydet')}
          </Button>
        </>
      }
    >
      <div className="mono faint selectable" style={{ fontSize: 12, marginBottom: 8, wordBreak: 'break-all' }}>
        {boot.configPath}
      </div>
      {original == null ? (
        <div className="spinner" />
      ) : (
        <textarea
          className="input mono"
          spellCheck={false}
          value={text}
          onChange={(e) => setText(e.target.value)}
          style={{ width: '100%', height: '56vh', resize: 'vertical', fontSize: 12.5, lineHeight: 1.5, whiteSpace: 'pre', tabSize: 2 }}
        />
      )}
      <div className="row" style={{ marginTop: 8, gap: 6, fontSize: 12.5 }}>
        {error || serverError ? (
          <span className="row" style={{ gap: 6, color: 'var(--red)' }}>
            <AlertTriangle size={14} /> <span className="selectable">{serverError ?? error}</span>
          </span>
        ) : (
          <span className="row faint" style={{ gap: 6 }}>
            <CheckCircle2 size={14} color="var(--green)" /> {dirty ? t('Geçerli JSON; kaydedince yapılandırma denetlenir.') : t('Değişiklik yok')}
          </span>
        )}
        {!boot.configWritable && <span style={{ color: 'var(--amber)' }}>{t('Dosya yazılamıyor; yalnızca okunur.')}</span>}
      </div>
    </Modal>
  );
}
