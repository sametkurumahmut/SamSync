import { CheckCircle2, XCircle, Info, AlertTriangle, X } from 'lucide-react';
import { useApp } from '../store/app';

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          {t.kind === 'ok' && <CheckCircle2 size={18} color="var(--green)" />}
          {t.kind === 'error' && <XCircle size={18} color="var(--red)" />}
          {t.kind === 'warn' && <AlertTriangle size={18} color="var(--amber)" />}
          {t.kind === 'info' && <Info size={18} color="var(--accent)" />}
          <div className="t-body">
            <div className="t-title">{t.title}</div>
            {t.message && <div className="t-msg">{t.message}</div>}
            {t.action && (
              <button
                className="link-btn"
                style={{ marginTop: 6, fontSize: 12.5 }}
                onClick={() => {
                  t.action!.run();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
          <button className="btn ghost icon sm" style={{ width: 22, height: 22 }} onClick={() => dismiss(t.id)}>
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
