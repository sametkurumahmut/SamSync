// The file dialog of a browser in server mode: the folders and files of the computer SamSync runs on, read
// through listDir. Files, folders or both, one or many, and a save variant with a file name, as the desktop
// dialogs offer them.
import { useEffect, useMemo, useState } from 'react';
import { ArrowUp, File, Folder, HardDrive, FolderCheck } from 'lucide-react';
import type { DirListing } from '@shared/types';
import { api } from '../lib/api';
import { usePicker } from '../lib/webpick';
import { readStored, writeStored } from '../lib/persist';
import { Button, Checkbox, Modal, SearchInput } from './ui';
import { bytes, cls, shortDateTime } from '../lib/format';
import { t } from '@shared/i18n';

const SHOW_MAX = 3000;

export function ServerPicker() {
  const req = usePicker((s) => s.req);
  if (!req) return null;
  return <PickerDialog key={JSON.stringify(req.opts) + req.save} />;
}

function PickerDialog() {
  const req = usePicker((s) => s.req)!;
  const { opts, save } = req;
  const folders = !!opts.folders;
  const files = !save && (opts.files ?? !folders);
  const [dir, setDir] = useState<string | null>(() => (opts.defaultPath ? null : readStored<string | null>('samsync.webpick.dir', null)));
  const [list, setList] = useState<DirListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [name, setName] = useState(() => (opts.defaultPath ? opts.defaultPath.split(/[\\/]/).pop() ?? '' : ''));
  const exts = useMemo(() => (opts.filters ?? []).flatMap((f) => f.extensions).filter((e) => e !== '*').map((e) => `.${e.toLowerCase()}`), [opts.filters]);

  const finish = (v: string[] | string | null) => {
    req.resolve(v);
    usePicker.setState({ req: null });
  };
  const close = () => finish(save ? null : []);

  useEffect(() => {
    let live = true;
    setLoading(true);
    void api
      .listDir(dir)
      .then((l) => {
        if (!live) return;
        setList(l);
        setSel(new Set());
        if (l.path) writeStored('samsync.webpick.dir', l.path);
      })
      .catch((e) => live && setList({ path: dir, parent: null, entries: [], error: (e as Error).message }))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [dir]);

  const shown = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return (list?.entries ?? []).filter((e) => (e.isDir || files || save) && (!ql || e.name.toLowerCase().includes(ql)) && (e.isDir || !exts.length || exts.some((x) => e.name.toLowerCase().endsWith(x))));
  }, [list, q, files, save, exts]);
  const selectable = (isDir: boolean) => (isDir ? folders : files);
  const toggle = (p: string, on: boolean) =>
    setSel((s) => {
      const n = opts.multi ? new Set(s) : new Set<string>();
      if (on) n.add(p);
      else n.delete(p);
      return n;
    });
  const sep = list?.path?.includes('\\') ? '\\' : '/';
  const savePath = list?.path && name.trim() ? `${list.path.replace(/[\\/]+$/, '')}${sep}${name.trim()}` : null;

  return (
    <Modal
      size="wide"
      title={opts.title ?? (save ? t('Kaydet') : folders ? t('Klasör seç') : t('Dosya seç'))}
      icon={<HardDrive size={16} />}
      onClose={close}
      footer={
        <>
          <span className="faint grow mono ellipsis" style={{ fontSize: 12 }} title={list?.path ?? ''}>
            {t('Sunucu: {path}', { path: list?.path ?? t('sürücüler') })}
          </span>
          <Button onClick={close}>{t('Vazgeç')}</Button>
          {save ? (
            <Button variant="primary" disabled={!savePath} onClick={() => finish(savePath)}>
              {t('Kaydet')}
            </Button>
          ) : (
            <>
              {folders && list?.path && !sel.size && (
                <Button icon={<FolderCheck size={14} />} onClick={() => finish([list.path!])}>
                  {t('Bu klasörü seç')}
                </Button>
              )}
              <Button variant="primary" disabled={!sel.size} onClick={() => finish([...sel])}>
                {sel.size > 1 ? t('{n} öğeyi seç', { n: sel.size }) : t('Seç')}
              </Button>
            </>
          )}
        </>
      }
    >
      <div className="row" style={{ gap: 8, marginBottom: 8 }}>
        <Button size="sm" icon={<ArrowUp size={13} />} disabled={!list?.path} onClick={() => setDir(list?.parent ?? null)} tip={t('Üst klasör')} iconOnly />
        <input
          className="input sm mono grow"
          aria-label={t('Yol')}
          defaultValue={list?.path ?? ''}
          key={list?.path ?? '-'}
          placeholder={t('sürücüler')}
          onKeyDown={(e) => e.key === 'Enter' && setDir((e.target as HTMLInputElement).value.trim() || null)}
        />
        <SearchInput value={q} onChange={setQ} placeholder={t('Süz')} style={{ width: 170 }} />
      </div>
      {list?.error && <div className="alert error" style={{ marginBottom: 8 }}>{list.error}</div>}
      <div className="picker-list" aria-busy={loading}>
        {shown.slice(0, SHOW_MAX).map((e) => {
          const can = selectable(e.isDir);
          const on = sel.has(e.path);
          return (
            <div
              key={e.path}
              className={cls('picker-row', on && 'on')}
              onClick={() => (e.isDir && !(folders && opts.multi && on) ? setDir(e.path) : can ? toggle(e.path, !on) : save && !e.isDir ? setName(e.name) : undefined)}
              onDoubleClick={() => !e.isDir && can && finish([e.path])}
            >
              {can && !save ? <Checkbox checked={on} onChange={(v) => toggle(e.path, v)} label={e.name} /> : <span style={{ width: 16 }} />}
              {list?.path === null ? <HardDrive size={14} className="faint" /> : e.isDir ? <Folder size={14} color="var(--accent)" /> : <File size={14} className="faint" />}
              <span className="grow ellipsis">{e.name}</span>
              {!e.isDir && <span className="faint tabular" style={{ fontSize: 12 }}>{bytes(e.size)}</span>}
              <span className="faint tabular" style={{ fontSize: 12, width: 120, textAlign: 'right' }}>{e.mtimeMs ? shortDateTime(e.mtimeMs) : ''}</span>
            </div>
          );
        })}
        {!loading && !shown.length && <div className="faint" style={{ padding: 16, textAlign: 'center' }}>{t('Boş')}</div>}
        {shown.length > SHOW_MAX && <div className="faint" style={{ padding: 10, textAlign: 'center' }}>{t('İlk {n} öğe gösteriliyor; süzerek daraltın.', { n: SHOW_MAX })}</div>}
      </div>
      {save && (
        <div className="row" style={{ gap: 8, marginTop: 10 }}>
          <span className="faint" style={{ fontSize: 12.5 }}>
            {t('Dosya adı')}
          </span>
          <input className="input mono grow" aria-label={t('Dosya adı')} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && savePath && finish(savePath)} />
        </div>
      )}
    </Modal>
  );
}
