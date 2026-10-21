// "Busy": SamSync on a machine says programs keep its target folder busy (started from inside it, or listed in its
// Settings › Agent). The badge names them on hover; a click asks the machine which files they hold open there.
import { useEffect, useState } from 'react';
import { Lock, RefreshCw } from 'lucide-react';
import type { BusyFiles, BusyProgram, ProbeResult } from '@shared/types';
import { api } from '../lib/api';
import { Button, ListSkeleton, Modal } from './ui';
import { cls } from '../lib/format';
import { t } from '@shared/i18n';

/** The programs keeping a machine busy, as its last probe saw them (only while SamSync there answers). */
export function busyOf(p: ProbeResult | undefined): BusyProgram[] {
  return p?.ok && p.agent?.alive && p.agent.busyBy?.length ? p.agent.busyBy : [];
}

/** The status dot: green, amber while busy, red when unreachable, pulsing while not probed yet. */
export function dotClass(p: ProbeResult | undefined, probing = false): string {
  if (!p) return probing ? 'pending' : '';
  if (!p.ok) return 'bad';
  return busyOf(p).length ? 'busy' : 'ok';
}

export function BusyBadge({ nodeId, name, programs, held, small }: { nodeId: string; name: string; programs: BusyProgram[] | string[]; held?: boolean; small?: boolean }) {
  const [open, setOpen] = useState(false);
  const names = [...new Set(programs.map((p) => (typeof p === 'string' ? p : p.name)))];
  if (!names.length) return null;
  const tip = [t('Hedef klasörü kullanan programlar:'), ...names, held ? t('Bu makine program kapanınca gönderim alır') : t('Değiştirilecek dosyalar kullanımda olabilir'), t('Tıklayınca açık tuttukları dosyalar')].join('\n');
  return (
    <>
      <button
        type="button"
        className={cls('badge amber busy-badge', small && 'sm')}
        data-tip={tip}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <Lock size={10} /> {t('meşgul')}
      </button>
      {open && <BusyFilesModal nodeId={nodeId} name={name} onClose={() => setOpen(false)} />}
    </>
  );
}

function BusyFilesModal({ nodeId, name, onClose }: { nodeId: string; name: string; onClose: () => void }) {
  const [data, setData] = useState<BusyFiles | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    api
      .busyFiles(nodeId)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [nodeId, tick]);
  return (
    <Modal
      title={t('{name}: hedef klasörü kullanan programlar', { name })}
      icon={<Lock size={16} />}
      onClose={onClose}
      footer={
        <>
          <Button icon={<RefreshCw size={13} />} onClick={() => setTick((x) => x + 1)}>
            {t('Yenile')}
          </Button>
          <span className="spacer" />
          <Button variant="primary" onClick={onClose}>
            {t('Kapat')}
          </Button>
        </>
      }
    >
      {error && <div className="alert error">{error}</div>}
      {!data && !error && <ListSkeleton rows={4} />}
      {data && !data.programs.length && <p className="muted">{t('Şu an hedef klasörü kullanan program yok.')}</p>}
      {data?.programs.map((p) => (
        <div key={p.pid} className="busy-program">
          <div className="row" style={{ gap: 6 }}>
            <b>{p.name}</b>
            <span className="faint">PID {p.pid}</span>
            {p.path && (
              <span className="faint mono truncate" title={p.path}>
                {p.path}
              </span>
            )}
          </div>
          {p.files.length ? (
            <div className="busy-files">
              {p.files.map((f) => (
                <div key={f} className="mono truncate">
                  {f}
                </div>
              ))}
            </div>
          ) : (
            <div className="faint" style={{ fontSize: 12 }}>
              {t('Hedef klasörde açık tuttuğu dosya görünmüyor (listede adıyla meşgul sayılıyor)')}
            </div>
          )}
        </div>
      ))}
    </Modal>
  );
}
