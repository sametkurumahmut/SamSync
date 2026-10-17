import { createRoot } from 'react-dom/client';
import './styles/global.css';
import './styles/pages.css';
import { App } from './App';
import { useApp } from './store/app';
import { ErrorBoundary } from './components/ErrorScreen';
import { api } from './lib/api';
import { t } from '@shared/i18n';

document.documentElement.classList.add(`platform-${window.samsync ? window.samsync.platform : 'web'}`);

// Errors outside rendering (a handler, a forgotten promise) do not take the window down, but they should not
// vanish either: one toast, and a line in the log for the diagnostics folder.
const seen = new Set<string>();
const report = (what: string, err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  const key = what + msg;
  if (seen.has(key)) return;
  seen.add(key);
  setTimeout(() => seen.delete(key), 30_000);
  void api.clientError(`${what}: ${err instanceof Error ? (err.stack ?? err.message) : msg}`).catch(() => undefined);
  if (useApp.getState().boot) useApp.getState().toast('error', t('Beklenmeyen hata'), msg);
};
window.addEventListener('error', (e) => report('error', e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => report('unhandled', e.reason));

void useApp.getState().init();
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
