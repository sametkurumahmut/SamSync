import { cloneElement, createContext, isValidElement, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type ButtonHTMLAttributes, type CSSProperties, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { Check, Minus, X, Search } from 'lucide-react';
import { cls, splitPath } from '../lib/format';
import { Illustration, type IlluName } from './illustrations';
import { t } from '@shared/i18n';

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
      // an icon-only button has no text: the tooltip is its name for screen readers
      aria-label={iconOnly && tip ? tip : undefined}
      aria-pressed={active}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <span className="spinner" style={{ width: 13, height: 13 }} /> : icon}
      {!iconOnly && children}
    </button>
  );
}

export function Checkbox({ checked, mixed, onChange, disabled, tip, label }: { checked: boolean; mixed?: boolean; onChange?: (v: boolean) => void; disabled?: boolean; tip?: string; label?: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={mixed ? 'mixed' : checked}
      aria-label={label ?? tip}
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

export function Switch({ on, onChange, disabled, label }: { on: boolean; onChange?: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
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
    <div className="toggle-row" aria-disabled={disabled || undefined} onClick={() => !disabled && onChange(!on)} style={disabled ? { opacity: 0.5, cursor: 'default' } : undefined}>
      {icon}
      <div className="grow">
        <div className="t-title">{title}</div>
        {desc && <div className="t-desc">{desc}</div>}
      </div>
      <Switch on={on} onChange={onChange} disabled={disabled} label={typeof title === 'string' ? title : undefined} />
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
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value} className={cls(o.value === value && 'on')} onClick={() => onChange(o.value)} data-tip={o.tip} data-tip-pos="bottom" aria-label={typeof o.label === 'string' ? undefined : o.tip}>
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
      <input className="input sm" value={value} placeholder={placeholder} aria-label={placeholder} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
      {value && (
        <button className="btn ghost icon sm clear" onClick={() => onChange('')} style={{ width: 22, height: 22 }}>
          <X size={13} />
        </button>
      )}
    </div>
  );
}

/** The label of the Field around a control that is not a plain input (a tag input), for its accessible name. */
const FieldLabel = createContext<string | undefined>(undefined);

export function TagInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const fieldLabel = useContext(FieldLabel);
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
      {value.map((tag) => (
        <span className="tag mono" key={tag}>
          {tag}
          <button aria-label={t('{item} kaldır', { item: tag })} onClick={() => onChange(value.filter((x) => x !== tag))}>
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        ref={ref}
        value={text}
        placeholder={value.length ? '' : placeholder}
        aria-label={fieldLabel ?? placeholder}
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

/** A labelled form field. A plain input, select or textarea as the only child is tied to the label (for screen readers). */
export function Field({ label, help, error, children, style }: { label?: ReactNode; help?: ReactNode; error?: ReactNode; children: ReactNode; style?: CSSProperties }) {
  const auto = useId();
  const native = isValidElement(children) && typeof children.type === 'string' && ['input', 'select', 'textarea'].includes(children.type);
  const el = children as ReactElement<{ id?: string; 'aria-invalid'?: boolean }>;
  const id = native ? (el.props.id ?? auto) : undefined;
  return (
    <div className="field" style={style}>
      {label && <label htmlFor={id}>{label}</label>}
      <FieldLabel.Provider value={typeof label === 'string' ? label : undefined}>{native ? cloneElement(el, { id, 'aria-invalid': error ? true : undefined }) : children}</FieldLabel.Provider>
      {error ? <div className="error">{error}</div> : help ? <div className="help">{help}</div> : null}
    </div>
  );
}

/** An empty state: an icon tile, or with `art` one of the line illustrations; `hint` is a one-line example under the text. */
export function Empty({ icon, art, title, children, hint, action }: { icon?: ReactNode; art?: IlluName; title: ReactNode; children?: ReactNode; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className={cls('empty', art && 'with-art')} role="status">
      {art ? <Illustration name={art} /> : <div className="empty-icon">{icon}</div>}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {hint && <p className="empty-hint">{hint}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

/** A grey block the size of the thing that is loading. */
export function Skeleton({ w, h = 12, r, round, className, style }: { w?: number | string; h?: number | string; r?: number; round?: boolean; className?: string; style?: CSSProperties }) {
  return <span className={cls('skeleton', round && 'round', className)} aria-hidden style={{ width: w ?? '100%', height: h, borderRadius: r, ...style }} />;
}

/** What a page looks like before its data is there: title, subtitle and a few cards with lines. */
export function PageSkeleton({ cards = 3, rows = 0 }: { cards?: number; rows?: number }) {
  return (
    <div className="skeleton-page" aria-busy="true" aria-live="polite">
      <div className="skeleton-head">
        <Skeleton w={180} h={22} />
        <Skeleton w={360} h={12} />
      </div>
      {cards > 0 && (
        <div className="skeleton-cards">
          {Array.from({ length: cards }, (_, i) => (
            <div key={i} className="skeleton-card">
              <Skeleton w={28} h={28} r={8} />
              <Skeleton w="70%" h={14} />
              <Skeleton w="45%" />
            </div>
          ))}
        </div>
      )}
      {rows > 0 && <ListSkeleton rows={rows} />}
    </div>
  );
}

/** Rows of a list that is loading: a dot, a title line and a shorter detail line. */
export function ListSkeleton({ rows = 5, dense }: { rows?: number; dense?: boolean }) {
  const widths = [72, 55, 64, 48, 60, 52, 68];
  return (
    <div className="skeleton-rows" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-row">
          <Skeleton w={dense ? 10 : 16} h={dense ? 10 : 16} round />
          <div className="grow col" style={{ gap: 6 }}>
            <Skeleton w={`${widths[i % widths.length]}%`} h={dense ? 10 : 12} />
            {!dense && <Skeleton w={`${widths[(i + 3) % widths.length] - 20}%`} h={9} />}
          </div>
        </div>
      ))}
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
      <div className={cls('modal', size)} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
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
      <button
        ref={ref}
        type="button"
        className={cls('btn', buttonProps?.size === 'sm' && 'sm', buttonProps?.variant, buttonProps?.iconOnly && 'icon')}
        data-tip={buttonProps?.tip}
        aria-label={buttonProps?.iconOnly ? buttonProps.tip : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
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
