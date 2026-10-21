// A path on a card: the whole path on hover, a click shows it in the file manager, a right click offers that and
// copying the path. In a browser (server mode) the path can only be copied: the file manager is on the other computer.
import { useState, type CSSProperties, type ReactNode } from 'react';
import { Copy, FolderOpen } from 'lucide-react';
import { useApp } from '../store/app';
import { api } from '../lib/api';
import { ContextMenu, showInFileManagerLabel, type ContextMenuState } from './ContextMenu';
import { cls } from '../lib/format';
import { t } from '@shared/i18n';

export function PathLink({
  path,
  open,
  icon,
  className,
  style,
}: {
  path: string;
  /** What a click opens; by default the path is shown in its folder. Null: nothing to open (copy only). */
  open?: (() => Promise<void>) | null;
  icon?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const boot = useApp((s) => s.boot!);
  const toast = useApp((s) => s.toast);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const canOpen = boot.isElectron && !boot.remote && open !== null;
  const doOpen = () => void (open ? open() : api.showInFolder(path)).catch((e) => toast('error', t('Klasör açılamadı'), (e as Error).message));
  const copy = () => {
    void navigator.clipboard.writeText(path);
    toast('ok', t('Yol panoya kopyalandı'), path);
  };
  return (
    <>
      <span
        className={cls('path-link mono', canOpen && 'clickable', className)}
        style={style}
        title={canOpen ? `${path}\n${t('Tıklayınca açılır; sağ tık: yolu kopyala')}` : path}
        role={canOpen ? 'button' : undefined}
        tabIndex={canOpen ? 0 : undefined}
        onClick={canOpen ? doOpen : undefined}
        onKeyDown={canOpen ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), doOpen()) : undefined}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenu({
            x: e.clientX,
            y: e.clientY,
            items: [
              { label: showInFileManagerLabel(boot.platform), icon: <FolderOpen size={15} />, disabled: !canOpen, onClick: doOpen },
              { label: t('Yolu kopyala'), icon: <Copy size={15} />, hint: path.length > 34 ? `…${path.slice(-32)}` : path, onClick: copy },
            ],
          });
        }}
      >
        {icon}
        <span className="ellipsis">{path}</span>
      </span>
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </>
  );
}
