// The network scan as a panel: start it, watch the addresses go by, and turn the machines that answered into
// targets. The Targets page opens it in a dialog (one machine at a time into the editor); the setup wizard embeds
// it with check boxes.
import { useEffect, useRef, useState } from 'react';
import { Radar, Square, Plus, Check, Server, KeyRound, HardDrive } from 'lucide-react';
import type { DiscoveredHost, NodeConfig } from '@shared/types';
import { api, newTaskId, onEvent } from '../lib/api';
import { Button, Checkbox, Empty, Modal, Progress } from './ui';
import { MachineName } from './MachineName';
import { cls } from '../lib/format';
import { t } from '@shared/i18n';

const slug = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'PC';

/** A node drawn up from a scan result: the short host name (or the address) as name and id, the first share as root. */
export function nodeFromHost(h: DiscoveredHost, opts: { group?: string; folder?: string } = {}): Partial<NodeConfig> {
  const short = (h.hostname ?? '').split('.')[0];
  const name = short || h.address;
  const smb = h.ports.includes(445) || !h.ports.includes(22);
  const folder = opts.folder || 'Release';
  const share = h.shares?.[0] || 'Share';
  return {
    id: slug(name),
    name,
    address: h.address,
    group: opts.group || undefined,
    transport: smb ? 'smb' : 'sftp',
    networkRoot: `${share}\\${folder}`,
    localNames: short ? [short] : undefined,
    enabled: true,
    localRoots: [],
    ...(smb ? {} : { sftp: { username: '', root: '/' } }),
  };
}

export interface DiscoverProgress {
  done: number;
  total: number;
  found: number;
}

export function DiscoverPanel({
  autoStart,
  selected,
  onToggle,
  onAdd,
  compact,
}: {
  autoStart?: boolean;
  /** With these two the rows carry check boxes (the wizard); without them an Add button (the Targets page). */
  selected?: Set<string>;
  onToggle?: (h: DiscoveredHost, on: boolean) => void;
  onAdd?: (h: DiscoveredHost) => void;
  compact?: boolean;
}) {
  const [hosts, setHosts] = useState<DiscoveredHost[] | null>(null);
  const [progress, setProgress] = useState<DiscoverProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const task = useRef<string | null>(null);

  const start = async () => {
    if (running) return;
    const id = newTaskId();
    task.current = id;
    setRunning(true);
    setError(null);
    setHosts(null);
    setProgress({ done: 0, total: 0, found: 0 });
    const off = onEvent((e) => {
      if (e.type === 'task-progress' && e.taskId === id) setProgress({ done: e.done ?? 0, total: e.total ?? 0, found: Number(/\d+/.exec(e.message)?.[0] ?? 0) });
    });
    try {
      setHosts(await api.discoverHosts(id));
    } catch (e) {
      const msg = (e as Error).message;
      if (!msg.includes(t('İptal edildi'))) setError(msg);
      setHosts([]);
    } finally {
      off();
      setRunning(false);
      task.current = null;
    }
  };
  const stop = () => task.current && void api.cancelTask(task.current);
  useEffect(() => {
    if (autoStart) void start();
    return () => {
      if (task.current) void api.cancelTask(task.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pct = progress && progress.total ? (100 * progress.done) / progress.total : 0;
  return (
    <div className="discover">
      <div className="row" style={{ gap: 10 }}>
        {running ? (
          <Button size="sm" icon={<Square size={13} />} onClick={stop}>
            {t('Durdur')}
          </Button>
        ) : (
          <Button size="sm" variant={hosts ? 'default' : 'primary'} icon={<Radar size={14} />} onClick={() => void start()}>
            {hosts ? t('Yeniden tara') : t('Ağı tara')}
          </Button>
        )}
        <div className="grow col" style={{ gap: 4, minWidth: 0 }}>
          {progress && (running || !hosts) ? (
            <>
              <Progress value={pct} indeterminate={!progress.total} />
              <span className="faint" style={{ fontSize: 11.5 }}>
                {progress.total ? t('{done}/{total} adres denendi • {found} makine yanıt verdi', { done: progress.done, total: progress.total, found: progress.found }) : t('Alt ağlar belirleniyor…')}
              </span>
            </>
          ) : hosts ? (
            <span className="faint" style={{ fontSize: 12 }}>
              {hosts.length ? t('{n} makine yanıt verdi. SMB paylaşımı olanlar dosya hedefi olabilir; yalnızca SSH açık olanlar SFTP ile.', { n: hosts.length }) : t('Yanıt veren makine yok. Makineler açık mı, dosya paylaşımı (445) ya da SSH (22) erişilebilir mi?')}
            </span>
          ) : (
            <span className="faint" style={{ fontSize: 12 }}>
              {t('Bu bilgisayarın bulunduğu alt ağlardaki adresler dosya paylaşımı ve SSH kapılarından denenir; hiçbir şey yazılmaz.')}
            </span>
          )}
        </div>
      </div>
      {error && <div className="alert error" style={{ marginTop: 8 }}>{error}</div>}
      {hosts && hosts.length > 0 && (
        <div className={cls('discover-list', compact && 'compact')}>
          {hosts.map((h) => {
            const smb = h.ports.includes(445);
            const on = selected?.has(h.address) ?? false;
            const known = !!h.nodeId;
            return (
              <div key={h.address} className={cls('discover-row', on && 'on', known && 'known')} onClick={() => !known && onToggle?.(h, !on)}>
                {onToggle && <Checkbox checked={on} disabled={known} onChange={(v) => onToggle(h, v)} />}
                <div className="icon-tile">{smb ? <Server size={14} /> : <KeyRound size={14} />}</div>
                <MachineName className="grow" name={h.hostname?.split('.')[0] || h.address} address={h.address} sub={<span className="row" style={{ gap: 4 }}>{h.ports.map((p) => <span key={p} className="badge">{p === 445 ? 'SMB' : p === 22 ? 'SSH' : p}</span>)}</span>} />
                <div className="row" style={{ gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: '45%' }}>
                  {h.shares?.slice(0, 4).map((s) => (
                    <span key={s} className="chip static" title={`\\\\${h.address}\\${s}`}>
                      <HardDrive size={11} /> {s}
                    </span>
                  ))}
                  {h.shares && h.shares.length > 4 && <span className="faint">+{h.shares.length - 4}</span>}
                  {smb && h.shares && !h.shares.length && <span className="faint" style={{ fontSize: 11 }}>{t('paylaşım listelenemedi')}</span>}
                </div>
                {known ? (
                  <span className="badge green">
                    <Check size={10} /> {h.nodeId}
                  </span>
                ) : (
                  onAdd && (
                    <Button size="sm" icon={<Plus size={13} />} onClick={() => onAdd(h)}>
                      {t('Ekle')}
                    </Button>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}
      {hosts && !hosts.length && !error && <Empty art="search" title={t('Makine bulunamadı')} />}
    </div>
  );
}

export function DiscoverDialog({ onClose, onPick }: { onClose: () => void; onPick: (h: DiscoveredHost) => void }) {
  return (
    <Modal size="wide" title={t('Ağı tara')} icon={<Radar size={16} />} onClose={onClose} footer={<Button onClick={onClose}>{t('Kapat')}</Button>}>
      <DiscoverPanel autoStart onAdd={onPick} />
    </Modal>
  );
}
