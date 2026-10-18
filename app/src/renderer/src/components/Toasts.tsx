import { CheckCircle2, XCircle, Info, AlertTriangle, X } from 'lucide-react';
import { useApp } from '../store/app';
import { t } from '@shared/i18n';

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  return (
    // a named region that screen readers announce as it changes; errors interrupt, the rest waits its turn
    <div className="toasts" role="region" aria-label={t('Bildirimler')} aria-live="polite">
      {toasts.map((x) => (
        <div key={x.id} className="toast" role={x.kind === 'error' ? 'alert' : 'status'}>
          {x.kind === 'ok' && <CheckCircle2 size={18} color="var(--green)" />}
          {x.kind === 'error' && <XCircle size={18} color="var(--red)" />}
          {x.kind === 'warn' && <AlertTriangle size={18} color="var(--amber)" />}
          {x.kind === 'info' && <Info size={18} color="var(--accent)" />}
          <div className="t-body">
            <div className="t-title">{x.title}</div>
            {x.message && <div className="t-msg">{x.message}</div>}
            {x.action && (
              <button
                className="link-btn"
                style={{ marginTop: 6, fontSize: 12.5 }}
                onClick={() => {
                  x.action!.run();
                  dismiss(x.id);
                }}
              >
                {x.action.label}
              </button>
            )}
          </div>
          <button className="btn ghost icon sm" style={{ width: 22, height: 22 }} aria-label={t('Kapat')} onClick={() => dismiss(x.id)}>
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
