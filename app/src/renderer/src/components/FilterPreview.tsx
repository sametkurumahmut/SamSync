// Send › Filters › "What do they leave out?": the sources walked with the current filters, each file or folder left
// out with the pattern that did it, before anything is compared with a machine.
import { useEffect, useState } from 'react';
import { FileText, Filter, Folder } from 'lucide-react';
import type { FilterPreview, SendOptions } from '@shared/types';
import { useApp } from '../store/app';
import { api } from '../lib/api';
import { Button, Empty, ListSkeleton, Modal } from './ui';
import { num } from '../lib/format';
import { t } from '@shared/i18n';

export function FilterPreviewButton({ options }: { options: SendOptions }) {
  const [open, setOpen] = useState(false);
  const count = useApp((s) => s.sendSources().length);
  return (
    <>
      <Button size="sm" icon={<Filter size={13} />} disabled={!count} tip={count ? undefined : t('Önce kaynak ekleyin')} onClick={() => setOpen(true)}>
        {t('Neyi dışarıda bırakıyor?')}
      </Button>
      {open && <FilterPreviewModal options={options} onClose={() => setOpen(false)} />}
    </>
  );
}

function FilterPreviewModal({ options, onClose }: { options: SendOptions; onClose: () => void }) {
  // the options as they were when it was opened: a change while it is open does not walk again
  const [opts] = useState(options);
  const [res, setRes] = useState<FilterPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const sources = useApp.getState().sendSources();
    api
      .filterPreview({ sources, targetIds: [], options: opts, origin: 'send' })
      .then(setRes)
      .catch((e: Error) => setError(e.message));
  }, [opts]);
  const fromLabel = (f: FilterPreview['excluded'][number]['from']) => (f === 'options' ? t('filtre') : f === 'ignore' ? '.samsyncignore' : 'SamSync');
  return (
    <Modal size="medium" title={t('Filtrelerin dışarıda bıraktıkları')} icon={<Filter size={16} />} onClose={onClose} footer={<Button onClick={onClose}>{t('Kapat')}</Button>}>
      {error && <div className="alert error">{error}</div>}
      {!res && !error && <ListSkeleton rows={6} />}
      {res && (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            {t('{files} dosya ve {dirs} klasör gidecek; {xf} dosya ve {xd} klasör dışarıda kalıyor (klasörün altındakiler ayrıca sayılmaz).', { files: num(res.files), dirs: num(res.dirs), xf: num(res.excludedFiles), xd: num(res.excludedDirs) })}
            {res.capped && ` ${t('Kaynak çok büyük; ilk kısmına bakıldı.')}`}
          </p>
          {res.excluded.length === 0 ? (
            <Empty title={t('Filtreler hiçbir şeyi dışarıda bırakmıyor')} />
          ) : (
            <div className="filter-preview-list">
              {res.excluded.map((x) => (
                <div key={x.path} className="row" style={{ gap: 8, fontSize: 12.5, padding: '3px 0' }}>
                  {x.isDir ? <Folder size={13} className="faint" /> : <FileText size={13} className="faint" />}
                  <span className="mono grow ellipsis selectable" title={x.path}>
                    {x.rel}
                  </span>
                  <span className="badge mono" title={fromLabel(x.from)}>
                    {x.pattern}
                  </span>
                </div>
              ))}
              {res.excludedFiles + res.excludedDirs > res.excluded.length && <div className="faint" style={{ fontSize: 12, paddingTop: 6 }}>{t('… ve {n} öğe daha', { n: num(res.excludedFiles + res.excludedDirs - res.excluded.length) })}</div>}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
