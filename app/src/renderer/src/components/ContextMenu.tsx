import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { t } from '@shared/i18n';
import { MenuList, useEscapeLayer, type MenuEntry } from './ui';

/** Where a right click was made and what its menu offers. */
export interface ContextMenuState {
  x: number;
  y: number;
  items: MenuEntry[];
}

/** A menu at the mouse (right click); it closes on an outside click, Escape, scrolling, a resize or leaving the window. */
export function ContextMenu({ menu, onClose, width = 240 }: { menu: ContextMenuState; onClose: () => void; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties>({ left: menu.x, top: menu.y, visibility: 'hidden' });
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ left: Math.max(8, Math.min(menu.x, window.innerWidth - r.width - 8)), top: Math.max(8, Math.min(menu.y, window.innerHeight - r.height - 8)) });
  }, [menu.x, menu.y]);
  useEscapeLayer(onClose);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const gone = () => onClose();
    window.addEventListener('mousedown', down);
    window.addEventListener('blur', gone);
    window.addEventListener('resize', gone);
    document.addEventListener('scroll', gone, true);
    return () => {
      window.removeEventListener('mousedown', down);
      window.removeEventListener('blur', gone);
      window.removeEventListener('resize', gone);
      document.removeEventListener('scroll', gone, true);
    };
  }, [onClose]);
  return createPortal(
    <div ref={ref} className="popover" role="menu" style={{ ...pos, width }} onContextMenu={(e) => e.preventDefault()}>
      <MenuList items={menu.items} onDone={onClose} />
    </div>,
    document.body,
  );
}

/** "Show in Explorer" in the words of the platform's file manager. */
export function showInFileManagerLabel(platform: string): string {
  if (platform === 'darwin') return t('Finder’da göster');
  if (platform === 'linux') return t('Dosya yöneticisinde göster');
  return t('Explorer’da göster');
}
