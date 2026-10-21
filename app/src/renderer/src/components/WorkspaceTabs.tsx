import { useState } from 'react';
import { Plus, SlidersHorizontal, X } from 'lucide-react';
import { useApp } from '../store/app';
import { cls } from '../lib/format';
import { t } from '@shared/i18n';

/** The Send page tabs: each keeps its own sources and targets; right-click launches open a new one. */
export function WorkspaceTabs() {
  const workspaces = useApp((s) => s.workspaces);
  const active = useApp((s) => s.activeWorkspace);
  const activeCount = useApp((s) => s.sendPaths.length);
  const activeOwn = useApp((s) => s.ownOptions);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const st = useApp.getState;
  const label = (name: string, i: number) => name || t('Liste {n}', { n: i + 1 });
  const commit = () => {
    if (editing) st().renameWorkspace(editing.id, editing.name);
    setEditing(null);
  };

  return (
    <div className="row" style={{ gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
      {workspaces.map((w, i) => {
        const on = w.id === active;
        const count = on ? activeCount : w.paths.length;
        return (
          <div
            key={w.id}
            className={cls('row', on && 'on')}
            title={t('Çift tıklayınca yeniden adlandırılır')}
            style={{
              gap: 6,
              padding: '5px 6px 5px 11px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: on ? 'var(--bg-active)' : 'transparent',
              color: on ? 'var(--text)' : 'var(--text-2)',
              cursor: 'pointer',
              fontSize: 12.5,
              fontWeight: on ? 600 : 500,
            }}
            onClick={() => void st().switchWorkspace(w.id)}
            onDoubleClick={() => setEditing({ id: w.id, name: label(w.name, i) })}
          >
            {editing?.id === w.id ? (
              <input
                className="input sm"
                autoFocus
                value={editing.name}
                style={{ width: 160 }}
                onChange={(e) => setEditing({ id: w.id, name: e.target.value })}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commit();
                  if (e.key === 'Escape') setEditing(null);
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="ellipsis" style={{ maxWidth: 220 }}>
                {label(w.name, i)}
              </span>
            )}
            {(on ? activeOwn : !!w.options) && (
              <span className="faint" title={t('Bu listenin kendi seçenekleri var')} style={{ display: 'grid', placeItems: 'center' }}>
                <SlidersHorizontal size={12} />
              </span>
            )}
            <span className="badge">{count}</span>
            {(workspaces.length > 1 || count > 0) && (
              <button
                type="button"
                aria-label={t('Sekmeyi kapat')}
                title={t('Sekmeyi kapat')}
                style={{ display: 'grid', placeItems: 'center', width: 18, height: 18, border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', borderRadius: 4 }}
                onClick={(e) => {
                  e.stopPropagation();
                  void st().closeWorkspace(w.id);
                }}
              >
                <X size={12} />
              </button>
            )}
          </div>
        );
      })}
      <button
        type="button"
        aria-label={t('Yeni sekme')}
        title={t('Yeni sekme')}
        style={{ display: 'grid', placeItems: 'center', width: 28, height: 28, border: '1px dashed var(--border-strong)', borderRadius: 8, background: 'transparent', color: 'inherit', cursor: 'pointer' }}
        onClick={() => void st().newWorkspace({ force: true })}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
