import { useEffect, useState } from 'react';
import { CheckCircle2, Search, XCircle } from 'lucide-react';
import type { FileTrace } from '@shared/types';
import { api } from '../lib/api';
import { Button, Modal, SearchInput, useDebounced } from './ui';
import { shortDateTime } from '../lib/format';
import { MachineName } from './MachineName';
import { useApp } from '../store/app';
import { t } from '@shared/i18n';

/** Where a file went: the history's runs whose results name it, one line per run and machine; a click opens the run. */
export function FileTraceModal({ onClose, onOpen }: { onClose: () => void; onOpen: (runId: string) => void }) {
  const [q, setQ] = useState('');
  const query = useDebounced(q, 250);
  const [rows, setRows] = useState<FileTrace[] | null>(null);
  const [busy, setBusy] = useState(false);
  const nodes = useApp((s) => s.boot!.config.nodes);
  const nameOf = (id: string) => nodes.find((n) => n.id === id)?.name ?? id;
  useEffect(() => {
    if (!query.trim()) return setRows(null);
    let live = true;
    setBusy(true);
    api
      .findInHistory(query, 300)
      .then((r) => live && setRows(r))
      .catch(() => live && setRows([]))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
  }, [query]);
  return (
    <Modal
      title={t('Dosya izi')}
      icon={<Search size={16} />}
      onClose={onClose}
      size="medium"
      footer={<Button onClick={onClose}>{t('Kapat')}</Button>}
    >
      <p className="muted" style={{ marginTop: 0 }}>
        {t('Bir dosya adı ya da yolun bir parçası: geçmişteki hangi gönderimle hangi makineye gittiği, en yenisi üstte.')}
      </p>
      <SearchInput value={q} onChange={setQ} placeholder={t('örn. app.exe ya da Data/Config')} autoFocus />
      <div style={{ marginTop: 10, maxHeight: 360, overflow: 'auto' }}>
        {busy && (
          <div className="row faint" style={{ padding: 8 }}>
            <div className="spinner" /> {t('Aranıyor…')}
          </div>
        )}
        {rows && !rows.length && !busy && <div className="faint" style={{ padding: 8 }}>{t('Geçmişte bu adla bir dosya yok.')}</div>}
        {rows?.map((r, i) => (
          <button key={`${r.runId}-${r.target}-${r.rel}-${i}`} type="button" className="menu-item" style={{ width: '100%', display: 'grid', gridTemplateColumns: '18px 1fr 150px 120px', gap: 8, alignItems: 'center', textAlign: 'left' }} onClick={() => onOpen(r.runId)}>
            {r.ok ? <CheckCircle2 size={14} color="var(--green)" /> : <XCircle size={14} color="var(--red)" />}
            <span className="col" style={{ minWidth: 0, gap: 1 }}>
              <span className="ellipsis mono" style={{ fontSize: 12 }} title={r.rel}>
                {r.rel}
              </span>
              <span className="faint ellipsis" style={{ fontSize: 11.5 }}>
                {r.label}
                {r.kind === 'delete' ? ` • ${t('silindi')}` : ''}
              </span>
            </span>
            <MachineName name={nameOf(r.target)} size="sm" layout="inline" />
            <span className="faint tabular nowrap" style={{ fontSize: 11.5 }}>
              {shortDateTime(r.startedAt)}
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
