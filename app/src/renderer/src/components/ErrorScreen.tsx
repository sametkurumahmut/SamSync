// The last line of defence for the window: when a page throws while rendering, React would otherwise unmount
// everything and leave a blank window (the 2.0.1 experience). This boundary shows the error instead, with the
// two things that help: reload, and a diagnostics folder to send along.
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, Copy, FolderSearch, RotateCw } from 'lucide-react';
import { api } from '../lib/api';
import { t } from '@shared/i18n';
import { Button } from './ui';

interface State {
  error: Error | null;
  stack: string;
  diagnostics?: string | null;
  busy?: boolean;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, stack: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const stack = `${error.stack ?? error.message}\n${info.componentStack ?? ''}`.trim();
    this.setState({ stack });
    void api.clientError(`${error.message}\n${stack}`).catch(() => undefined);
  }

  render() {
    const { error, stack, diagnostics, busy } = this.state;
    if (!error) return this.props.children;
    const text = `${error.message}\n\n${stack}`;
    return (
      <div className="crash">
        <div className="crash-card">
          <div className="icon-tile red lg">
            <AlertTriangle size={20} />
          </div>
          <h2>{t('Arayüz hata verdi')}</h2>
          <p className="muted">{t('Hata günlüğe yazıldı. Yeniden yüklemek genelde yeter; sürerse tanı klasörünü paylaşın.')}</p>
          <pre className="crash-trace selectable">{text}</pre>
          {diagnostics && (
            <div className="row" style={{ gap: 8 }}>
              <span className="faint">{t('Tanı klasörü:')}</span>
              <button className="link-btn mono" onClick={() => void api.openPath(diagnostics)}>
                {diagnostics}
              </button>
            </div>
          )}
          <div className="row" style={{ gap: 8, marginTop: 6 }}>
            <Button variant="primary" icon={<RotateCw size={14} />} onClick={() => location.reload()}>
              {t('Yeniden yükle')}
            </Button>
            <Button
              icon={<FolderSearch size={14} />}
              loading={busy}
              onClick={async () => {
                this.setState({ busy: true });
                const dir = await api.exportDiagnostics().catch(() => null);
                this.setState({ busy: false, diagnostics: dir });
              }}
            >
              {t('Tanı klasörü oluştur')}
            </Button>
            <Button icon={<Copy size={14} />} onClick={() => void navigator.clipboard.writeText(text)}>
              {t('Hatayı kopyala')}
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
