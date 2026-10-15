import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type ButtonHTMLAttributes, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Check, Minus, X, Search } from 'lucide-react';
import { cls, splitPath } from '../lib/format';

// Escape closes only the top-most layer (popover over modal over drawer).
const layers: number[] = [];
let layerSeq = 0;
export function useEscapeLayer(onEscape: () => void, active = true) {
  const ref = useRef(onEscape);
  ref.current = onEscape;
  useEffect(() => {
    if (!active) return;
    const id = ++layerSeq;
    layers.push(id);
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || layers[layers.length - 1] !== id) return;
      e.preventDefault();
      ref.current();
    };
    window.addEventListener('keydown', k);
    return () => {
      window.removeEventListener('keydown', k);
      const i = layers.indexOf(id);
      if (i >= 0) layers.splice(i, 1);
    };
  }, [active]);
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger' | 'default';
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;
  iconOnly?: boolean;
  tip?: string;
  tipPos?: 'top' | 'bottom' | 'right';
  active?: boolean;
  loading?: boolean;
};

export function Button({ variant = 'default', size = 'md', icon, iconOnly, tip, tipPos, active, loading, className, children, disabled, ...rest }: BtnProps) {
  return (
    <button
      type="button"
      className={cls('btn', variant !== 'default' && variant, size !== 'md' && size, iconOnly && 'icon', active && 'active', className)}
      data-tip={tip}
      data-tip-pos={tipPos}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <span className="spinner" style={{ width: 13, height: 13 }} /> : icon}
      {!iconOnly && children}
    </button>
  );
}

export function Checkbox({ checked, mixed, onChange, disabled, tip }: { checked: boolean; mixed?: boolean; onChange?: (v: boolean) => void; disabled?: boolean; tip?: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={mixed ? 'mixed' : checked}
      className={cls('check', checked && !mixed && 'on', mixed && 'mixed')}
      disabled={disabled}
      data-tip={tip}
      onClick={(e) => {
        e.stopPropagation();
        onChange?.(mixed ? true : !checked);
      }}
    >
      {mixed ? <Minus size={11} strokeWidth={3.5} /> : checked ? <Check size={11} strokeWidth={3.5} /> : null}
    </button>
  );
}

export function Switch({ on, onChange, disabled }: { on: boolean; onChange?: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={cls('switch', on && 'on')}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange?.(!on);
      }}
    />
  );
}

export function ToggleRow({ title, desc, on, onChange, disabled, icon }: { title: ReactNode; desc?: ReactNode; on: boolean; onChange: (v: boolean) => void; disabled?: boolean; icon?: ReactNode }) {
  return (
    <div className="toggle-row" onClick={() => !disabled && onChange(!on)} style={disabled ? { opacity: 0.5, cursor: 'default' } : undefined}>
      {icon}
      <div className="grow">
        <div className="t-title">{title}</div>
        {desc && <div className="t-desc">{desc}</div>}
      </div>
      <Switch on={on} onChange={onChange} disabled={disabled} />
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  full,
  size,
}: {
  value: T;
  options: { value: T; label: ReactNode; icon?: ReactNode; tip?: string }[];
  onChange: (v: T) => void;
  full?: boolean;
  size?: 'sm';
}) {
  return (
    <div className={cls('segmented', full && 'full', size)} role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" className={cls(o.value === value && 'on')} onClick={() => onChange(o.value)} data-tip={o.tip} data-tip-pos="bottom">
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder, autoFocus, style }: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean; style?: CSSProperties }) {
  return (
    <div className="input-wrap" style={style}>
      <Search size={14} />
      <input className="input sm" value={value} placeholder={placeholder} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
      {value && (
        <button className="btn ghost icon sm clear" onClick={() => onChange('')} style={{ width: 22, height: 22 }}>
          <X size={13} />
        </button>
      )}
    </div>
  );
}

export function TagInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const commit = () => {
    const parts = text
      .split(/[;,\n]/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (parts.length) onChange([...value, ...parts.filter((p) => !value.includes(p))]);
    setText('');
  };
  return (
    <div className="tag-input" onClick={() => ref.current?.focus()}>
      {value.map((t) => (
        <span className="tag mono" key={t}>
          {t}
          <button onClick={() => onChange(value.filter((x) => x !== t))}>
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        ref={ref}
        value={text}
        placeholder={value.length ? '' : placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={commit}
        spellCheck={false}
      />
    </div>
  );
}

export function Field({ label, help, error, children, style }: { label?: ReactNode; help?: ReactNode; error?: ReactNode; children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="field" style={style}>
      {label && <label>{label}</label>}
      {children}
      {error ? <div className="error">{error}</div> : help ? <div className="help">{help}</div> : null}
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}

export function PathText({ path, title }: { path: string; title?: string }) {
  const { dir, name } = splitPath(path);
  return (
    <span className="path" title={title ?? path}>
      {dir && <span className="dir">{'\u200e' + dir + '\u200e'}</span>}
      <span className="name">{name || path}</span>
    </span>
  );
}

export function Progress({ value, state, indeterminate }: { value: number; state?: 'ok' | 'bad'; indeterminate?: boolean }) {
  return (
    <div className={cls('progress', state, indeterminate && 'indeterminate')}>
      <div style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Modal({
  title,
  icon,
  onClose,
  children,
  footer,
  size,
  closeOnScrim = true,
}: {
  title: ReactNode;
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'wide' | 'medium';
  closeOnScrim?: boolean;
}) {
  useEscapeLayer(onClose);
  return createPortal(
    <div className="scrim" onMouseDown={(e) => closeOnScrim && e.target === e.currentTarget && onClose()}>
      <div className={cls('modal', size)} role="dialog">
        <div className="modal-head">
          {icon}
          <h2 className="grow">{title}</h2>
          <Button variant="ghost" iconOnly size="sm" icon={<X size={16} />} onClick={onClose} />
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Floating panel anchored to an element, closes on outside click / Escape. */
export function Popover({
  anchor,
  onClose,
  children,
  align = 'start',
  width,
  placement = 'bottom',
}: {
  anchor: HTMLElement | null;
  onClose: () => void;
  children: ReactNode;
  align?: 'start' | 'end';
  width?: number;
  placement?: 'bottom' | 'top';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties>({ visibility: 'hidden' });
  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const r = anchor.getBoundingClientRect();
    const pr = ref.current.getBoundingClientRect();
    let left = align === 'end' ? r.right - pr.width : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - pr.width - 8));
    let top = placement === 'top' ? r.top - pr.height - 6 : r.bottom + 6;
    if (top + pr.height > window.innerHeight - 8) top = Math.max(8, r.top - pr.height - 6);
    if (top < 8) top = 8;
    setPos({ left, top, width });
  }, [anchor, align, width, placement]);
  useEscapeLayer(onClose);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      // clicks inside a modal opened from this popover (or any other portal above it) do not count as outside
      if (ref.current && !ref.current.contains(t) && !anchor?.contains(t) && !(t instanceof Element && t.closest('.scrim'))) onClose();
    };
    window.addEventListener('mousedown', down);
    return () => window.removeEventListener('mousedown', down);
  }, [anchor, onClose]);
  return createPortal(
    <div ref={ref} className="popover" style={{ ...pos, width }}>
      {children}
    </div>,
    document.body,
  );
}

export interface MenuEntry {
  label?: ReactNode;
  icon?: ReactNode;
  hint?: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  sep?: boolean;
  section?: string;
}

export function MenuButton({ children, items, align = 'start', width, buttonProps }: { children: ReactNode; items: MenuEntry[]; align?: 'start' | 'end'; width?: number; buttonProps?: BtnProps }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={ref} type="button" className={cls('btn', buttonProps?.size === 'sm' && 'sm', buttonProps?.variant, buttonProps?.iconOnly && 'icon')} data-tip={buttonProps?.tip} onClick={() => setOpen((o) => !o)}>
        {children}
      </button>
      {open && (
        <Popover anchor={ref.current} onClose={() => setOpen(false)} align={align} width={width}>
          <MenuList items={items} onDone={() => setOpen(false)} />
        </Popover>
      )}
    </>
  );
}

export function MenuList({ items, onDone }: { items: MenuEntry[]; onDone: () => void }) {
  return (
    <>
      {items.map((it, i) =>
        it.sep ? (
          <div key={i} className="menu-sep" />
        ) : it.section ? (
          <div key={i} className="menu-label">
            {it.section}
          </div>
        ) : (
          <button
            key={i}
            className={cls('menu-item', it.danger && 'danger')}
            disabled={it.disabled}
            style={it.disabled ? { opacity: 0.45, cursor: 'default' } : undefined}
            onClick={() => {
              if (it.disabled) return;
              onDone();
              it.onClick?.();
            }}
          >
            {it.icon}
            <span className="ellipsis">{it.label}</span>
            {it.hint && <span className="hint">{it.hint}</span>}
          </button>
        ),
      )}
    </>
  );
}

export function useDebounced<T>(value: T, ms = 200): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
