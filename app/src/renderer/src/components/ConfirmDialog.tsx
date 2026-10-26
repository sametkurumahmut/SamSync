// "Are you sure?" in the app's own look, instead of the browser's plain confirm box: askConfirm() opens it from
// anywhere (a page, the store) and resolves with the answer. One at a time; a second waits for the first.
import { useEffect, useState } from 'react';
import { AlertTriangle, HelpCircle } from 'lucide-react';
import { Button, Modal } from './ui';
import { t } from '@shared/i18n';

interface Ask {
  message: string;
  /** What the yes button says (default: OK). */
  ok?: string;
  /** Something is deleted, overwritten or switched off: the yes button is red. */
  danger?: boolean;
  resolve: (yes: boolean) => void;
}

let show: ((a: Ask) => void) | null = null;

/** Asks the question in the app's dialog; true for yes. Without the dialog mounted (a test), the plain box. */
export function askConfirm(message: string, opts: { ok?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    if (!show) return resolve(window.confirm(message));
    show({ message, ...opts, resolve });
  });
}

export function ConfirmHost() {
  const [queue, setQueue] = useState<Ask[]>([]);
  useEffect(() => {
    show = (a) => setQueue((q) => [...q, a]);
    return () => {
      show = null;
    };
  }, []);
  const cur = queue[0];
  if (!cur) return null;
  const answer = (yes: boolean) => {
    cur.resolve(yes);
    setQueue((q) => q.slice(1));
  };
  return (
    <Modal
      title="SamSync"
      icon={cur.danger ? <AlertTriangle size={16} color="var(--amber)" /> : <HelpCircle size={16} />}
      onClose={() => answer(false)}
      footer={
        <>
          {/* Enter answers the focused button: for a question that deletes or overwrites, that is the safe one */}
          <Button autoFocus={cur.danger} onClick={() => answer(false)}>
            {t('Vazgeç')}
          </Button>
          <Button variant={cur.danger ? 'danger' : 'primary'} autoFocus={!cur.danger} onClick={() => answer(true)}>
            {cur.ok ?? t('Tamam')}
          </Button>
        </>
      }
    >
      <p className="confirm-text">{cur.message}</p>
    </Modal>
  );
}
