// What changed in the version that just started, once, from the changelog that ships with the app.
import { Sparkles, ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ChangelogSection } from '@shared/types';
import { useApp } from '../store/app';
import { api } from '../lib/api';
import { Button, Modal } from './ui';
import { t } from '@shared/i18n';

/** The little markdown the changelog uses: **bold** and `code`. */
export function inlineMarkdown(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) out.push(<b key={k++}>{tok.slice(2, -2)}</b>);
    else out.push(<code key={k++}>{tok.slice(1, -1)}</code>);
    last = m.index + tok.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

export function WhatsNewModal() {
  const section = useApp((s) => s.whatsNew);
  const repositoryUrl = useApp((s) => s.boot?.repositoryUrl);
  const saveSettings = useApp((s) => s.saveSettings);
  if (!section) return null;
  const close = () => {
    useApp.setState({ whatsNew: null });
    void saveSettings({ lastSeenVersion: section.version });
  };
  return (
    <Modal
      size="medium"
      title={
        <span className="row" style={{ gap: 8 }}>
          {t('Bu sürümde yeni')} <span className="badge accent">v{section.version}</span>
          {section.date && <span className="faint" style={{ fontSize: 12, fontWeight: 400 }}>{section.date}</span>}
        </span>
      }
      icon={
        <div className="icon-tile accent">
          <Sparkles size={16} />
        </div>
      }
      onClose={close}
      footer={
        <>
          {repositoryUrl && (
            <Button variant="ghost" icon={<ExternalLink size={13} />} onClick={() => void api.openExternal(`${repositoryUrl}/releases/tag/v${section.version}`)}>
              {t('Sürüm notları')}
            </Button>
          )}
          <span className="spacer" />
          <Button variant="primary" onClick={close}>
            {t('Tamam')}
          </Button>
        </>
      }
    >
      <ul className="whats-new">
        {section.items.map((item, i) => (
          <li key={i}>{inlineMarkdown(item)}</li>
        ))}
      </ul>
    </Modal>
  );
}
