// One machine's history: every run that reached it, newest first, with how it went there, the release points and the
// health checks; a row opens the run in History.
import { useEffect, useState } from 'react';
import { History as HistoryIcon, Tag } from 'lucide-react';
import type { NodeConfig, TimelineEntry } from '@shared/types';
import { useApp } from '../store/app';
import { api } from '../lib/api';
import { Button, ListSkeleton, Modal } from './ui';
import { StatusIcon, CheckBadge } from './RunPanel';
import { bytes, dateTime, duration } from '../lib/format';
import { locale, t } from '@shared/i18n';

export function MachineTimeline({ node, onClose }: { node: NodeConfig; onClose: () => void }) {
  const [rows, setRows] = useState<TimelineEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .machineTimeline(node.id)
      .then(setRows)
      .catch((e) => setError((e as Error).message));
  }, [node.id]);
  const open = (runId: string) => {
    onClose();
    useApp.setState({ openRunId: runId });
    useApp.getState().setPage('history');
  };
  // grouped by day, as the History page does
  const days = new Map<string, TimelineEntry[]>();
  for (const r of rows ?? []) {
    const k = new Date(r.at).toDateString();
    days.set(k, [...(days.get(k) ?? []), r]);
  }
  return (
    <Modal
      size="medium"
      title={t('{name}: geçmiş', { name: node.name })}
      icon={<HistoryIcon size={16} />}
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={onClose}>
          {t('Kapat')}
        </Button>
      }
    >
      {error && <div className="alert error">{error}</div>}
      {!rows && !error && <ListSkeleton rows={6} />}
      {rows && !rows.length && <p className="muted">{t('Bu makineye henüz bir şey gönderilmedi.')}</p>}
      <div className="timeline">
        {[...days.entries()].map(([day, list]) => (
          <div key={day}>
            <div className="timeline-day">{new Date(list[0].at).toLocaleDateString(locale())}</div>
            {list.map((r) => (
              <button key={r.runId} type="button" className="timeline-row" onClick={() => open(r.runId)} data-tip={[r.label, dateTime(r.at), r.error ?? ''].filter(Boolean).join('\n')}>
                <StatusIcon status={r.status} size={14} />
                <span className="grow ellipsis" style={{ textAlign: 'left' }}>
                  {r.label}
                  {r.dryRun ? ` (${t('deneme')})` : ''}
                </span>
                {r.release && (
                  <span className="badge violet nowrap">
                    <Tag size={10} /> {r.release}
                  </span>
                )}
                {r.check && <CheckBadge check={r.check} />}
                {r.deferred && <span className="badge amber">{t('kuyrukta')}</span>}
                <span className="faint tabular nowrap" style={{ fontSize: 11.5 }}>
                  {new Date(r.at).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })}
                  {r.bytes > 0 ? ` • ${bytes(r.bytes)}` : ''}
                  {r.finishedAt && r.finishedAt > r.at ? ` • ${duration(r.finishedAt - r.at)}` : ''}
                  {r.via ? ` • ${t('{relay} üzerinden', { relay: r.via })}` : ''}
                  {r.failed > 0 ? ` • ${t('{n} hata', { n: r.failed })}` : ''}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </Modal>
  );
}
