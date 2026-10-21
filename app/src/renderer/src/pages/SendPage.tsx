import { useEffect, useRef, useState } from 'react';
import { Lock, KeyRound, ScanSearch, FilePlus, FolderPlus, File, Folder, FolderInput, FolderOpen, X, Trash2, Copy, UploadCloud, ArrowRight, ShieldCheck, Bell, Terminal, FlaskConical, History as HistoryIcon, Filter, ChevronDown, ChevronRight, AlertTriangle, Send, Eye, EyeOff, Zap, Plus, Package, Pencil, CalendarClock, RotateCcw, Undo2, Layers } from 'lucide-react';
import { useApp } from '../store/app';
import { TargetPicker } from '../components/TargetPicker';
import { PackUnlockDialog, PackWriteDialog } from '../components/PackDialogs';
import { Button, Checkbox, Segmented, TagInput, ToggleRow, Field, Modal, type MenuEntry } from '../components/ui';
import { ContextMenu, showInFileManagerLabel, type ContextMenuState } from '../components/ContextMenu';
import { api } from '../lib/api';
import { bytes, cls, num, baseName } from '../lib/format';
import type { SendMode, CompareMethod, QuickSend, SyncSchedule, SourceInfo, SourcePlace } from '@shared/types';
import { t, tk } from '@shared/i18n';
import { tx } from '../lib/i18n';
import { pickOverrides } from '@shared/options';
import { pathWithin, samePath } from '@shared/sources';
import { coverageOf } from '@shared/coverage';
import { useStartWatchFromSend } from './AutomationPage';
import { WorkspaceTabs } from '../components/WorkspaceTabs';
import { ScheduleFields } from '../components/ScheduleFields';
import { describeSchedule } from './AutomationPage';

export const MODE_OPTIONS: { value: SendMode; label: string; tip: string }[] = [
  { value: 'overwrite', label: tk('Üzerine yaz'), tip: tk('Yeni ve değişen her dosyayı yazar.\nHedefteki daha yeni dosyalar da güncellenir (uyarıyla).') },
  { value: 'update', label: tk('Yalnızca yeni'), tip: tk('Hedefte daha yeni ya da aynı yaştaki dosyalara dokunmaz.') },
  { value: 'mirror', label: tk('Ayna'), tip: tk('Klasörleri birebir eşitler:\nhedefte olup kaynakta olmayan dosyaları siler.') },
];

export const COMPARE_OPTIONS: { value: CompareMethod; label: string; tip: string }[] = [
  { value: 'timeSize', label: tk('Tarih + boyut'), tip: tk('Hızlı: değiştirilme tarihi ve boyut') },
  { value: 'content', label: tk('İçerik'), tip: tk('Kesin: aynı boyuttaki dosyaları bayt bayt karşılaştırır (yavaş)') },
  { value: 'size', label: tk('Boyut'), tip: tk('Yalnızca boyuta bakar') },
];

/** The option lists above in the current language, for Segmented. */
export function modeOptions() {
  return MODE_OPTIONS.map((o) => ({ ...o, label: t(o.label), tip: t(o.tip) }));
}

export function compareOptions() {
  return COMPARE_OPTIONS.map((o) => ({ ...o, label: t(o.label), tip: t(o.tip) }));
}

/** How the Send page names a place a source outside every local root can take on the targets. */
function placeLabel(p: SourcePlace, isDir: boolean): string {
  const where = p.rel ? `${p.rel}${isDir ? '/' : ''}` : t('(içeriği doğrudan hedef köküne)');
  return p.full ? t('{path} (tam yol)', { path: where }) : where;
}

/** The value of the place list's "type a path" entry. */
const TYPED = '\u0000typed';

/** The place list of a source: its places (the default marked), a path typed earlier, and "type a path…". */
function placeOptions(i: SourceInfo): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (const p of i.places ?? []) out.push({ value: p.rel, label: p.rel === i.defaultRel ? t('{place} (varsayılan)', { place: placeLabel(p, i.isDir) }) : placeLabel(p, i.isDir) });
  if (!out.some((o) => o.value.toLowerCase() === i.rel.toLowerCase())) out.push({ value: i.rel, label: t('{path} (elle)', { path: i.rel ? `${i.rel}${i.isDir ? '/' : ''}` : t('(içeriği doğrudan hedef köküne)') }) });
  out.push({ value: TYPED, label: t('Başka bir yol yaz…') });
  return out;
}

export function SendPage() {
  const paths = useApp((s) => s.sendPaths);
  const infos = useApp((s) => s.sendInfos);
  const add = useApp((s) => s.addSendPaths);
  const setRel = useApp((s) => s.setSendRel);
  const addRoot = useApp((s) => s.addLocalRoot);
  const sendSources = useApp((s) => s.sendSources);
  const remove = useApp((s) => s.removeSendPath);
  const removeMany = useApp((s) => s.removeSendPaths);
  const off = useApp((s) => s.sendOff);
  const setEnabled = useApp((s) => s.setSendEnabled);
  const platform = useApp((s) => s.boot!.platform);
  const clear = useApp((s) => s.clearSendPaths);
  const targets = useApp((s) => s.targets);
  const setTargets = useApp((s) => s.setTargets);
  const options = useApp((s) => s.options);
  const startPlan = useApp((s) => s.startPlan);
  const writePack = useApp((s) => s.writePack);
  const toast = useApp((s) => s.toast);
  const isElectron = useApp((s) => s.boot!.isElectron);
  // sources can stay in the list turned off: they are left out of the send, the counts and the checks below
  const isOff = (p: string) => off.some((o) => samePath(o, p));
  const onInfos = infos.filter((i) => !isOff(i.path));
  const onCount = paths.filter((p) => !isOff(p)).length;
  /** Added but not read yet (a big folder is counted first): shown as waiting rows. */
  const pending = paths.filter((p) => !infos.some((i) => samePath(i.path, p)));
  /** A pack from a disk among the sources: it may be applied to this very machine too. */
  const hasPack = onInfos.some((i) => i.pack || i.locked);
  // this machine can take the send itself when nothing comes from its own root: packs, or a release from another disk
  const ownRoot = useApp((s) => s.boot!.identity.node?.localRoots[0]);
  const sendsHere = onInfos.length > 0 && onInfos.every((i) => i.pack || i.locked || (i.outsideRoots && !!ownRoot && !pathWithin(ownRoot, i.path)));
  // picking rows: a click picks one, Ctrl adds or drops one, Shift takes a range; actions on a picked row cover all picked
  const [sel, setSel] = useState<string[]>([]);
  const anchor = useRef<number | null>(null);
  const picked = sel.filter((p) => infos.some((i) => i.path === p));
  const rowsFor = (p: string) => (picked.includes(p) ? picked : [p]);
  const pickRow = (e: React.MouseEvent, p: string, at: number) => {
    if ((e.target as Element).closest('button, select, input, a, .selectable')) return;
    if (e.shiftKey && anchor.current != null) {
      const [a, b] = [anchor.current, at].sort((x, y) => x - y);
      setSel(infos.slice(a, b + 1).map((i) => i.path));
      return;
    }
    anchor.current = at;
    if (e.ctrlKey || e.metaKey) setSel((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p]));
    else setSel((s) => (s.length === 1 && s[0] === p ? [] : [p]));
  };
  const listKeys = (e: React.KeyboardEvent) => {
    if ((e.target as Element).closest('select, input')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      setSel(infos.map((i) => i.path));
    } else if (e.key === 'Escape' && picked.length) {
      e.stopPropagation();
      setSel([]);
    } else if (e.key === 'Delete' && picked.length) {
      removeMany(picked);
      setSel([]);
    }
  };
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  /** The source whose target path is being typed by hand. */
  const [typing, setTyping] = useState<string | null>(null);
  const placeTo = (i: SourceInfo, rel: string) => {
    if (rel === TYPED) return setTyping(i.path);
    // back to where it goes by itself: the pick is dropped, so later changes to the roots apply again
    void setRel(i.path, rel === i.defaultRel ? null : rel);
  };
  const copyPaths = (list: string[]) => {
    void navigator.clipboard.writeText(list.join('\n'));
    toast('ok', list.length > 1 ? t('Yollar panoya kopyalandı') : t('Yol panoya kopyalandı'), list.length > 1 ? undefined : list[0]);
  };
  /** Right click on a source: open it in the file manager, copy the path, turn it on or off, take it out. */
  const sourceMenu = (e: React.MouseEvent, i: SourceInfo) => {
    e.preventDefault();
    const rows = rowsFor(i.path);
    const many = rows.length > 1;
    const allOn = rows.every((p) => !isOff(p));
    const items: MenuEntry[] = [
      {
        label: showInFileManagerLabel(platform),
        icon: <FolderOpen size={15} />,
        disabled: !isElectron || !i.exists,
        onClick: () => void (i.isDir ? api.openPath(i.path) : api.showInFolder(i.path)).catch((err) => toast('error', t('Klasör açılamadı'), (err as Error).message)),
      },
      { label: many ? t('{n} yolu kopyala', { n: rows.length }) : t('Yolu kopyala'), icon: <Copy size={15} />, onClick: () => copyPaths(rows) },
      { sep: true },
      allOn
        ? { label: many ? t('{n} kaynağı devre dışı bırak', { n: rows.length }) : t('Devre dışı bırak'), icon: <EyeOff size={15} />, onClick: () => setEnabled(rows, false) }
        : { label: many ? t('{n} kaynağı etkinleştir', { n: rows.length }) : t('Etkinleştir'), icon: <Eye size={15} />, onClick: () => setEnabled(rows, true) },
      {
        label: many ? t('{n} kaynağı listeden çıkar', { n: rows.length }) : t('Listeden çıkar'),
        icon: <X size={15} />,
        danger: true,
        onClick: () => {
          removeMany(rows);
          setSel([]);
        },
      },
    ];
    setMenu({ x: e.clientX, y: e.clientY, items });
  };
  const [packDialog, setPackDialog] = useState(false);
  const [unlock, setUnlock] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const startWatch = useStartWatchFromSend();

  const pickFiles = async () => {
    const p = await api.pick({ files: true, multi: true, title: t('Gönderilecek dosyalar') });
    if (p.length) await add(p);
  };
  const pickFolders = async () => {
    const p = await api.pick({ folders: true, multi: true, title: t('Gönderilecek klasörler') });
    if (p.length) await add(p);
  };
  /** Enter in a path box: every line (quotes stripped) is added. */
  const addTyped = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || !manual.trim()) return;
    void add(manual.split(/\r?\n/).map((x) => x.trim().replace(/^"|"$/g, '')).filter(Boolean));
    setManual('');
  };

  const totalSize = onInfos.reduce((s, i) => s + i.size, 0);
  const files = onInfos.reduce((s, i) => s + (!i.exists ? 0 : i.isDir ? i.fileCount ?? 0 : 1), 0);
  const dirs = onInfos.filter((i) => i.isDir).length;
  const missing = onInfos.filter((i) => !i.exists).length;
  const offCount = infos.length - onInfos.length;

  const review = () => {
    const on = paths.filter((p) => !isOff(p));
    return startPlan({ sources: sendSources(), origin: 'send', label: on.length === 1 ? baseName(on[0]) : t('{n} öğe', { n: on.length }) });
  };
  // Ctrl Enter from the app shell
  useEffect(() => {
    const h = () => {
      if (onCount && targets.length) void review();
    };
    window.addEventListener('samsync:review', h);
    return () => window.removeEventListener('samsync:review', h);
  });
  const modeLabel = MODE_OPTIONS.find((m) => m.value === options.mode)?.label;
  const ownSettings = pickOverrides(options.perTarget, targets);

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>{t('Gönder')}</h1>
          <div className="sub">{t('Dosya ve klasörleri seçili makinelere, yerel köke göre aynı göreli yolla gönderin.')}</div>
        </div>
        <Button icon={<FilePlus size={15} />} onClick={pickFiles} disabled={!isElectron}>
          {t('Dosya ekle')}
        </Button>
        <Button icon={<FolderPlus size={15} />} onClick={pickFolders} disabled={!isElectron}>
          {t('Klasör ekle')}
        </Button>
      </div>
      <div className="page-body fill" style={{ display: 'flex', flexDirection: 'column' }}>
        <WorkspaceTabs />
        <QuickSendsBar canSave={onCount > 0 && targets.length > 0} />
        <div className="send-grid" style={{ flex: 1, minHeight: 0 }}>
          <div className="col" style={{ gap: 14, minHeight: 0 }}>
            <div className="card sources-card">
              <div className="card-head">
                <div className="icon-tile">
                  <UploadCloud size={15} />
                </div>
                <h2>{t('Kaynaklar')}</h2>
                {picked.length > 0 ? (
                  <>
                    <span className="badge accent">{t('{n} seçili', { n: picked.length })}</span>
                    <span className="spacer" />
                    <Button size="sm" variant="ghost" icon={<Eye size={13} />} onClick={() => setEnabled(picked, true)}>
                      {t('Etkinleştir')}
                    </Button>
                    <Button size="sm" variant="ghost" icon={<EyeOff size={13} />} onClick={() => setEnabled(picked, false)}>
                      {t('Devre dışı bırak')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<X size={13} />}
                      onClick={() => {
                        removeMany(picked);
                        setSel([]);
                      }}
                    >
                      {t('Çıkar')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setSel([])}>
                      {t('Seçimi kaldır')}
                    </Button>
                  </>
                ) : (
                  <>
                {infos.length > 0 && (
                  <span className="hint">
                    {t('{n} öğe', { n: num(onInfos.length) })} • {t('{n} dosya', { n: files })}, {t('{n} klasör', { n: dirs })} • {bytes(totalSize)}
                    {offCount > 0 && ` • ${t('{n} devre dışı', { n: offCount })}`}
                  </span>
                )}
                <span className="spacer" />
                {infos.length > 0 && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Copy size={13} />}
                      onClick={() => {
                        void navigator.clipboard.writeText(paths.join('\n'));
                        toast('ok', t('Yollar panoya kopyalandı'));
                      }}
                    >
                      {t('Kopyala')}
                    </Button>
                    <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={clear}>
                      {t('Temizle')}
                    </Button>
                  </>
                )}
                  </>
                )}
              </div>
              {infos.length === 0 && paths.length === 0 ? (
                <div className="drop-zone send-drop">
                  <div className="empty-icon" style={{ width: 60, height: 60, borderRadius: 18 }}>
                    <UploadCloud size={26} />
                  </div>
                  <h3>{t('Dosya veya klasörleri buraya sürükleyin')}</h3>
                  <p className="muted">{t('Ya da seçin. Explorer’da sağ tık → “SamSync ile gönder” de buraya getirir.')}</p>
                  <div className="row" style={{ marginTop: 6 }}>
                    <Button icon={<FilePlus size={15} />} onClick={pickFiles} disabled={!isElectron}>
                      {t('Dosya seç')}
                    </Button>
                    <Button icon={<FolderPlus size={15} />} onClick={pickFolders} disabled={!isElectron}>
                      {t('Klasör seç')}
                    </Button>
                  </div>
                  <div className="row" style={{ marginTop: 10, width: 'min(520px, 100%)' }}>
                    <input
                      className="input sm mono"
                      placeholder={t('…ya da tam yolu yapıştırın ve Enter’a basın')}
                      value={manual}
                      onChange={(e) => setManual(e.target.value)}
                      aria-label={t('Eklenecek yol')}
                      onKeyDown={addTyped}
                    />
                  </div>
                </div>
              ) : (
                <div className="source-list" role="region" aria-label={t('Kaynak listesi')} tabIndex={0} onKeyDown={listKeys}>
                  {missing > 0 && (
                    <div className="alert error" style={{ margin: 10 }}>
                      <AlertTriangle size={15} /> {t('{n} öğe bulunamadı; gönderimde atlanacak.', { n: missing })}
                    </div>
                  )}
                  {infos.map((i, at) => (
                    <div
                      key={i.path}
                      className={cls('source-row', !i.exists && 'missing', isOff(i.path) && 'off', picked.includes(i.path) && 'picked')}
                      onClick={(e) => pickRow(e, i.path, at)}
                      onContextMenu={(e) => sourceMenu(e, i)}
                    >
                      <Checkbox checked={!isOff(i.path)} onChange={(v) => setEnabled(rowsFor(i.path), v)} label={t('{name} gönderilsin', { name: baseName(i.path) })} tip={isOff(i.path) ? t('Devre dışı: listede kalır, gönderilmez') : undefined} />
                      <div className={cls('icon-tile', (i.isDir || i.pack) && 'accent')}>{i.pack ? <Package size={15} /> : i.isDir ? <Folder size={15} /> : <File size={15} />}</div>
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div className="row" style={{ gap: 6 }}>
                          <span className="ellipsis" style={{ fontWeight: 580 }}>
                            {baseName(i.path)}
                          </span>
                          {!i.exists && <span className="badge red">{t('bulunamadı')}</span>}
                          {isOff(i.path) && <span className="badge">{t('devre dışı')}</span>}
                          {i.pack && (
                            <span className="badge accent" data-tip={t('{label} • {from} • {when}', { label: i.pack.label, from: i.pack.from, when: new Date(i.pack.createdAt).toLocaleString() })}>
                              {i.pack.encrypted && <Lock size={10} />} {t('paket')}
                            </span>
                          )}
                          {i.locked && (
                            <span className={cls('badge', i.locked === 'wrong' ? 'red' : 'amber')} data-tip={t('Parola korumalı paket: açmadan içeriği okunamaz ve gönderilemez')}>
                              <Lock size={10} /> {i.locked === 'wrong' ? t('parola yanlış') : t('parolalı')}
                            </span>
                          )}
                          {i.pack ? null : i.outsideRoots ? (
                            <span className="badge amber" data-tip={t('Hiçbir yerel kökün altında değil.\nHedeflerde nereye gideceğini alttaki listeden seçin.')}>
                              {t('kök dışı')}
                            </span>
                          ) : (
                            i.root && (
                              <span className="badge" data-tip={t('Yerel kök: {path}', { path: i.root })}>
                                {baseName(i.root)}
                              </span>
                            )
                          )}
                        </div>
                        {!i.pack && !i.locked && i.places?.length ? (
                          <div className="row faint mono" style={{ fontSize: 11.5, gap: 6, minWidth: 0 }}>
                            <ArrowRight size={11} style={{ flex: 'none' }} />
                            {typing === i.path ? (
                              <input
                                className="input sm mono"
                                style={{ height: 24, maxWidth: 360 }}
                                autoFocus
                                defaultValue={i.rel}
                                placeholder={t('hedef köküne göre yol, örn. Contents')}
                                aria-label={t('{name}: hedefteki yol', { name: baseName(i.path) })}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    const v = e.currentTarget.value.trim().replace(/^[\\/]+|[\\/]+$/g, '');
                                    setTyping(null);
                                    void setRel(i.path, v === i.defaultRel ? null : v);
                                  } else if (e.key === 'Escape') {
                                    e.stopPropagation();
                                    setTyping(null);
                                  }
                                }}
                                onBlur={() => setTyping(null)}
                              />
                            ) : (
                              <select
                                className="select sm mono place-select"
                                aria-label={t('{name}: hedeflerde nereye gitsin', { name: baseName(i.path) })}
                                title={i.base ? t('Hedef kökünün yerine geçen klasör: {path}', { path: i.base }) : i.full ? t('Sürücü harfiyle birlikte tam yol') : i.root ? t('Yerel kök: {path}', { path: i.root }) : undefined}
                                value={placeOptions(i).find((o) => o.value.toLowerCase() === i.rel.toLowerCase())?.value ?? i.rel}
                                onChange={(e) => placeTo(i, e.target.value)}
                              >
                                {placeOptions(i).map((o) => (
                                  <option key={o.value} value={o.value}>
                                    {o.label}
                                  </option>
                                ))}
                              </select>
                            )}
                            {i.outsideRoots && i.base && (
                              <Button size="sm" variant="ghost" icon={<FolderInput size={13} />} onClick={() => void addRoot(i.base!)} tip={t('{path} klasörünü bu makinenin yerel köklerine ekler:\niçindekiler bundan sonra her yerde bu yolla eşlenir', { path: i.base })}>
                                {t('Yerel kök yap')}
                              </Button>
                            )}
                          </div>
                        ) : (
                          <div className="row faint mono" style={{ fontSize: 11.5, gap: 6 }}>
                            <ArrowRight size={11} style={{ flex: 'none' }} />
                            <span className="ellipsis selectable" title={i.path}>
                              {i.rel || t('(kökün kendisi)')}
                              {i.isDir ? '/' : ''}
                            </span>
                          </div>
                        )}
                        {(() => {
                          // sources that overlap on the targets: what this folder leaves to others, or who it is merged with
                          const c = coverageOf(i, infos);
                          if (!c) return null;
                          return (
                            <div className="faint" style={{ fontSize: 11.5, marginTop: 2 }}>
                              {c.without.length > 0 && <span>{t('{parts} hariç: orayı başka bir kaynak alıyor', { parts: c.without.map((r) => `${r}/`).join(', ') })}</span>}
                              {c.without.length > 0 && c.mergedWith.length > 0 && ' • '}
                              {c.mergedWith.length > 0 && <span>{t('{names} ile aynı yere gidiyor; içerikleri birleştirilir, ikisinde de olan dosya listede önce gelenden alınır', { names: c.mergedWith.map(baseName).join(', ') })}</span>}
                            </div>
                          );
                        })()}
                      </div>
                      {i.locked && (
                        <Button size="sm" icon={<KeyRound size={13} />} onClick={() => setUnlock(i.path)}>
                          {t('Parola…')}
                        </Button>
                      )}
                      <span className="faint tabular nowrap" style={{ fontSize: 12 }}>
                        {i.isDir || i.pack ? `${t('{n} dosya', { n: num(i.fileCount ?? 0) + (i.fileCountCapped ? '+' : '') })} • ${bytes(i.size)}` : bytes(i.size)}
                      </span>
                      <Button size="sm" variant="ghost" iconOnly icon={<X size={14} />} onClick={() => remove(i.path)} tip={t('Listeden çıkar')} />
                    </div>
                  ))}
                  {pending.map((p) => (
                    <div key={p} className="source-row loading" aria-busy="true">
                      <div className="icon-tile">
                        <div className="spinner" />
                      </div>
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div className="ellipsis" style={{ fontWeight: 580 }} title={p}>
                          {baseName(p)}
                        </div>
                        <div style={{ fontSize: 11.5 }}>{t('Okunuyor: dosyalar sayılıyor…')}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {(infos.length > 0 || paths.length > 0) && (
                // more sources while the list is not empty: the same choices as the empty list's drop zone
                <div className="source-add">
                  <Button size="sm" variant="ghost" icon={<FilePlus size={13} />} onClick={pickFiles} disabled={!isElectron}>
                    {t('Dosya seç')}
                  </Button>
                  <Button size="sm" variant="ghost" icon={<FolderPlus size={13} />} onClick={pickFolders} disabled={!isElectron}>
                    {t('Klasör seç')}
                  </Button>
                  <input className="input sm mono" placeholder={t('…ya da tam yolu yapıştırın ve Enter’a basın')} aria-label={t('Eklenecek yol')} value={manual} onChange={(e) => setManual(e.target.value)} onKeyDown={addTyped} />
                </div>
              )}
            </div>
            <OptionsCard />
          </div>

          <div className="card targets-card">
            <div className="card-head">
              <div className="icon-tile">
                <Send size={15} />
              </div>
              <h2>{t('Hedefler')}</h2>
              <span className="spacer" />
            </div>
            <TargetPicker value={targets} onChange={setTargets} overrides includeLocal={sendsHere} />
          </div>
        </div>

        <div className="action-bar">
          <div className="grow row" style={{ gap: 10 }}>
            <span className="tabular">
              {tx(
                '{sources} kaynak {arrow} {targets} hedef',
                { sources: <b>{num(onCount)}</b>, arrow: <ArrowRight size={13} style={{ verticalAlign: -2 }} />, targets: <b>{targets.length}</b> },
                { s: onCount, n: targets.length },
              )}
            </span>
            <span className="badge outline">{modeLabel && t(modeLabel)}</span>
            {(options.backup || options.rollbackOnFailure) && <span className="badge blue">{t('yedekli')}</span>}
            {options.rollbackOnFailure && <span className="badge blue">{t('ya hep ya hiç')}</span>}
            {options.dryRun && <span className="badge amber">{t('deneme')}</span>}
            {Object.keys(ownSettings).length > 0 && (
              <span className="badge violet" data-tip={t('Bu hedeflerin kipi ya da yedeği genel ayardan farklı')}>
                {t('{n} hedefte özel ayar', { n: Object.keys(ownSettings).length })}
              </span>
            )}
          </div>
          <Button size="lg" icon={<Eye size={15} />} disabled={!onCount || !targets.length} onClick={() => void startWatch()} tip={t('Bu kaynakları izler; değiştikçe\nseçili hedeflere kendiliğinden gönderir')}>
            {t('İzle')}
          </Button>
          <Button size="lg" icon={<Package size={15} />} disabled={!onCount || hasPack || !isElectron} onClick={() => setPackDialog(true)} tip={t('Kaynakları makineler yerine tek bir pakete yazar (.samsync-pack):\ndiskle götürülen sürüm, hedefte SamSync ile uygulanır ve manifesti bırakır')}>
            {t('Paket yaz')}
          </Button>
          {packDialog && <PackWriteDialog onClose={() => setPackDialog(false)} onWrite={(pw, since) => void writePack(pw, since)} />}
          {unlock && <PackUnlockDialog path={unlock} onClose={() => setUnlock(null)} />}
          <Button size="lg" icon={<FlaskConical size={15} />} disabled={!onCount || !targets.length} onClick={() => startPlan({ sources: sendSources(), origin: 'send', options: { dryRun: true }, label: t('Deneme') })}>
            {t('Deneme')}
          </Button>
          <Button size="lg" variant="primary" icon={<Send size={15} />} disabled={!onCount || !targets.length} onClick={review}>
            {t('İncele ve gönder')}
          </Button>
        </div>
        {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
      </div>
    </div>
  );
}

/**
 * Saved sends: the current sources, targets and options under a name, run again with one click here, from
 * the tray, the command palette or `--quick <name>`.
 */
const NO_QUICK: QuickSend[] = [];

function QuickSendsBar({ canSave }: { canSave: boolean }) {
  // the selector must return the same value while nothing changed, or the store rerenders without end
  const quick = useApp((s) => s.boot?.settings.quickSends) ?? NO_QUICK;
  const run = useApp((s) => s.runQuickSend);
  const save = useApp((s) => s.saveQuickSend);
  const remove = useApp((s) => s.removeQuickSend);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [review, setReview] = useState(false);
  const [hotkey, setHotkey] = useState('');
  const [schedule, setSchedule] = useState<SyncSchedule | undefined>(undefined);
  /** The saved send being edited (name, key, review, schedule); its list stays as it is. */
  const [editId, setEditId] = useState<string | null>(null);
  const open = (q?: QuickSend) => {
    setEditId(q?.id ?? null);
    setName(q?.name ?? '');
    setReview(!!q?.review);
    setHotkey(q?.hotkey ?? '');
    setSchedule(q?.schedule);
    setNaming(true);
  };
  const close = () => {
    setNaming(false);
    setEditId(null);
    setName('');
    setHotkey('');
    setSchedule(undefined);
  };
  const submit = async () => {
    if (!name.trim()) return;
    await save(name.trim(), review, hotkey, schedule, editId ?? undefined);
    close();
  };
  if (!quick.length && !canSave) return null;
  return (
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
      <span className="faint row" style={{ fontSize: 12, gap: 4 }}>
        <Zap size={13} /> {t('Hızlı gönderimler')}
      </span>
      {quick.map((q) => (
        <span key={q.id} className="chip row" style={{ gap: 4 }} data-tip={t('{n} kaynak → {targets} hedef{review}', { n: q.paths.length, targets: q.targetIds.length, review: q.review ? ` • ${t('inceleyerek')}` : '' })}>
          <button className="chip-btn" onClick={() => run(q)}>
            <Send size={12} /> {q.name}
            {q.hotkey && <span className="kbd">{q.hotkey}</span>}
            {q.schedule?.enabled && <CalendarClock size={11} className="faint" data-tip={describeSchedule(q.schedule)} />}
          </button>
          <button className="chip-x" aria-label={t('Düzenle')} data-tip={t('Ad, kısayol, zamanlama')} onClick={() => open(q)}>
            <Pencil size={11} />
          </button>
          <button
            className="chip-x"
            aria-label={t('Kaldır')}
            onClick={async () => {
              if (!confirm(t('“{name}” hızlı gönderimi kaldırılsın mı?', { name: q.name }))) return;
              await remove(q.id);
            }}
          >
            <X size={11} />
          </button>
        </span>
      ))}
      {canSave && (
        <Button size="sm" variant="ghost" icon={<Plus size={13} />} onClick={() => open()}>
          {t('Bu listeyi kaydet')}
        </Button>
      )}
      {naming && (
        <Modal
          title={editId ? t('Hızlı gönderimi düzenle') : t('Hızlı gönderim kaydet')}
          icon={<Zap size={16} />}
          onClose={close}
          size="medium"
          footer={
            <>
              <span className="spacer" />
              <Button onClick={close}>{t('Vazgeç')}</Button>
              <Button variant="primary" disabled={!name.trim()} onClick={() => void submit()}>
                {t('Kaydet')}
              </Button>
            </>
          }
        >
          <Field label={t('Ad')} help={t('Tepside, komut paletinde ve komut satırında (--quick "ad") bu adla görünür')}>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Sürüm → Lab-A')} autoFocus onKeyDown={(e) => e.key === 'Enter' && void submit()} />
          </Field>
          <Field label={t('Kısayol tuşu (isteğe bağlı)')} help={t('Her yerden çalışır, uygulama tepsideyken de; örn. Ctrl+Alt+1. Başka bir program kullanıyorsa atanamaz.')}>
            <input className="input mono" value={hotkey} onChange={(e) => setHotkey(e.target.value)} placeholder="Ctrl+Alt+1" />
          </Field>
          <ToggleRow icon={<Eye size={16} className="faint" />} title={t('Önce incele')} desc={t('Kapalıyken plan hesaplanır hesaplanmaz gönderilir; hedefte silme olacaksa yine inceleme açılır')} on={review} onChange={setReview} />
          <div style={{ marginTop: 12 }}>
            <ScheduleFields value={schedule} onChange={setSchedule} offText={t('Yalnızca tıklayınca, kısayolla ya da --quick ile çalışır')} />
            {schedule?.enabled && (
              <div className="faint" style={{ fontSize: 11.5, marginTop: 6 }}>
                {t('Zamanı gelince bu makinede inceleme açılmadan gönderilir (uygulama açık ya da tepsideyken); değişiklik yoksa bir şey yapılmaz. Otomasyon sayfasında listelenir.')}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

export function OptionsCard({ git }: { git?: boolean }) {
  const options = useApp((s) => s.options);
  const set = useApp((s) => s.setOptions);
  const own = useApp((s) => s.ownOptions);
  const setOwn = useApp((s) => s.setOwnOptions);
  const reset = useApp((s) => s.resetOptions);
  const postCommand = useApp((s) => s.boot!.config.copy.postCommand);
  const preCommand = useApp((s) => s.boot!.config.copy.preCommand);
  const [filters, setFilters] = useState(false);
  return (
    <div className="card options-card">
      <div className="card-head" style={{ flexWrap: 'wrap', rowGap: 6 }}>
        <div className="icon-tile">
          <ShieldCheck size={15} />
        </div>
        <h2 className="grow">{t('Seçenekler')}</h2>
        {!git && (
          <div className="row" style={{ gap: 4 }}>
            <Segmented
              size="sm"
              value={own ? 'list' : 'general'}
              onChange={(v) => setOwn(v === 'list')}
              options={[
                { value: 'general', label: t('Genel'), tip: t('Bu liste genel seçenekleri kullanır; burada yapılan değişiklik bütün listelere geçer') },
                { value: 'list', label: t('Bu listeye özel'), tip: t('Bu liste kendi seçeneklerini tutar; genel seçenekler değişmez') },
              ]}
            />
            {own && <Button size="sm" variant="ghost" iconOnly icon={<Undo2 size={13} />} tip={t('Genel seçeneklere göre sıfırla')} onClick={() => reset('general')} />}
            <Button size="sm" variant="ghost" iconOnly icon={<RotateCcw size={13} />} tip={t('Varsayılanlara sıfırla (Ayarlar › Kopyalama’daki değerler)')} onClick={() => reset('defaults')} />
          </div>
        )}
      </div>
      <div className="card-body options-body">
        {!git && (
          <div className="hint" style={{ marginTop: -4, marginBottom: 4 }}>
            {own ? t('Bu listenin kendi seçenekleri: değişiklikler yalnızca bu listede kalır; liste kaydedilince onunla saklanır.') : t('Genel seçenekler: kendi seçenekleri olmayan bütün listeler bunları kullanır.')}
          </div>
        )}
        <div className="options-row">
          <Field label={t('Kip')}>
            <Segmented value={options.mode} onChange={(v) => set({ mode: v })} options={modeOptions()} />
          </Field>
          {!git && (
            <Field label={t('Karşılaştırma')}>
              <Segmented value={options.compare} onChange={(v) => set({ compare: v })} options={compareOptions()} />
            </Field>
          )}
          <Field label={t('Eşzamanlı hedef')}>
            <input className="input" type="number" min={1} max={32} aria-label={t('Eşzamanlı hedef')} value={options.parallelTargets} onChange={(e) => set({ parallelTargets: Math.max(1, Math.min(32, Number(e.target.value) || 1)) })} style={{ width: 80 }} />
          </Field>
          <Field label={t('Gönderimden sonra')}>
            <select className="select" aria-label={t('Gönderimden sonra')} value={options.powerAfter ?? ''} onChange={(e) => set({ powerAfter: (e.target.value || undefined) as typeof options.powerAfter })} style={{ width: 'auto' }}>
              <option value="">{t('Bir şey yapma')}</option>
              <option value="restart">{t('Makineleri yeniden başlat')}</option>
              <option value="shutdown">{t('Makineleri kapat')}</option>
            </select>
          </Field>
        </div>
        <div className="options-toggles">
          <ToggleRow icon={<HistoryIcon size={16} className="faint" />} title={t('Yedek al')} desc={t('Üzerine yazılan ve silinen dosyaların eski hâli hedefte saklanır')} on={options.backup} onChange={(v) => set({ backup: v })} />
          <ToggleRow icon={<Layers size={16} className="faint" />} title={t('Hazırla, sonra tek seferde değiştir')} desc={t('Dosyalar hedefte önce geçici adla yazılır, hepsi gelince bir anda yerlerine konur; program yarım sürüm görmez, bir dosya gelmezse hiçbirine dokunulmaz')} on={!!options.stageSwitch} onChange={(v) => set({ stageSwitch: v || undefined })} />
          <ToggleRow icon={<Undo2 size={16} className="faint" />} title={t('Hata olursa makineyi geri al')} desc={t('Bir makinede gönderim yarıda kalırsa o makine gönderim öncesi hâline döner; yedek bunun için açılır')} on={!!options.rollbackOnFailure} onChange={(v) => set({ rollbackOnFailure: v || undefined })} />
          <ToggleRow icon={<ShieldCheck size={16} className="faint" />} title={t('Doğrula')} desc={t('Yazdıktan sonra içerik özetini karşılaştırır')} on={options.verify} onChange={(v) => set({ verify: v })} />
          <ToggleRow icon={<ScanSearch size={16} className="faint" />} title={t('Hedefi baştan tara')} desc={t('SamSync’in hedefte bıraktığı manifeste güvenmez, klasörleri ağ üzerinden gezer (yavaş ama kesin)')} on={!!options.fullScan} onChange={(v) => set({ fullScan: v || undefined })} />
          {git && <ToggleRow icon={<Trash2 size={16} className="faint" />} title={t('Silinenleri hedefte de sil')} desc={t('Git’te silinen ya da taşınan dosyalar hedeften kaldırılır')} on={options.propagateDeletes} onChange={(v) => set({ propagateDeletes: v })} />}
          <ToggleRow icon={<Bell size={16} className="faint" />} title={t('Bitince bildir')} desc={t('Masaüstü bildirimi gösterir')} on={options.notify} onChange={(v) => set({ notify: v })} />
          {preCommand && <ToggleRow icon={<Terminal size={16} className="faint" />} title={t('Öncesi komut')} desc={<span className="mono">{preCommand}</span>} on={options.runPreCommand !== false} onChange={(v) => set({ runPreCommand: v })} />}
          {postCommand && <ToggleRow icon={<Terminal size={16} className="faint" />} title={t('Sonrası komut')} desc={<span className="mono">{postCommand}</span>} on={options.runPostCommand} onChange={(v) => set({ runPostCommand: v })} />}
        </div>
        <button className="link-btn row" style={{ gap: 4, marginTop: 4 }} onClick={() => setFilters((f) => !f)}>
          {filters ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <Filter size={13} /> {t('Filtreler')}
          {(options.excludeFiles.length > 0 || options.excludeDirs.length > 0) && (
            <span className="badge" style={{ marginLeft: 4 }}>
              {options.excludeFiles.length + options.excludeDirs.length}
            </span>
          )}
        </button>
        {filters && (
          <div className="options-row" style={{ marginTop: 10 }}>
            <Field label={t('Hariç dosyalar')} help={t('*.pdb, *.tmp, desktop.ini — ada göre her klasörde')}>
              <TagInput value={options.excludeFiles} onChange={(v) => set({ excludeFiles: v })} placeholder="*.pdb" />
            </Field>
            <Field label={t('Hariç klasörler')} help={t('.git, Logs, bin/Debug — ada ya da göreli yola göre')}>
              <TagInput value={options.excludeDirs} onChange={(v) => set({ excludeDirs: v })} placeholder="Logs" />
            </Field>
          </div>
        )}
      </div>
    </div>
  );
}
