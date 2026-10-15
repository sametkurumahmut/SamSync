import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  GitBranch,
  GitCommit,
  FolderGit2,
  RefreshCw,
  ChevronDown,
  Plus,
  ArrowUp,
  ArrowDown,
  Send,
  SlidersHorizontal,
  Server,
  FileDiff,
  Search,
  CheckCheck,
  AlertTriangle,
  Tag,
  CloudUpload,
  X,
  Trash2,
} from 'lucide-react';
import type { DiffResult, GitChange, GitCommit as Commit } from '@shared/types';
import { useApp } from '../store/app';
import { useGit } from '../store/git';
import { api } from '../lib/api';
import { Button, Checkbox, Empty, MenuButton, Popover, SearchInput, Segmented, useDebounced, type MenuEntry } from '../components/ui';
import { DiffView } from '../components/DiffView';
import { TargetPicker, TargetSummary } from '../components/TargetPicker';
import { OptionsCard } from './SendPage';
import { ago, baseName, cls, dateTime, num, splitPath } from '../lib/format';

const KIND_LABEL: Record<string, string> = { A: 'eklendi', M: 'değişti', D: 'silindi', R: 'taşındı', C: 'kopyalandı', T: 'tür değişti', U: 'çakışma', '?': 'izlenmiyor' };

export function GitPage() {
  const g = useGit();
  const gitAvailable = useApp((s) => s.boot!.gitAvailable);
  const toast = useApp((s) => s.toast);

  useEffect(() => {
    if (gitAvailable) void g.loadRepos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gitAvailable]);

  // actions coming from the command palette
  useEffect(() => {
    if (!g.pendingAction || !g.repo) return;
    if (g.pendingAction === 'worktree') {
      g.setMode('worktree');
      useGit.setState({ pendingAction: null });
    } else if (g.pendingAction === 'lastCommit' && g.commits.length) {
      g.setMode('commits');
      void g.selectCommits([g.commits[0].sha]);
      useGit.setState({ pendingAction: null });
    }
  }, [g.pendingAction, g.repo, g.commits, g]);

  if (!gitAvailable)
    return (
      <div className="page">
        <Empty icon={<GitBranch size={22} />} title="Git bulunamadı">
          Bu özellik için sistemde <span className="mono">git</span> komutunun kurulu olması gerekiyor.
        </Empty>
      </div>
    );

  const addRepo = async () => {
    const [p] = await api.pick({ folders: true, title: 'Git deposu seçin' });
    if (!p) return;
    const info = await api.gitAddRepo(p);
    if (!info) return toast('error', 'Git deposu değil', p);
    await g.loadRepos();
    await g.selectRepo(info.root);
  };

  const repoItems: MenuEntry[] = [
    ...g.repos.map((r) => ({
      label: (
        <span className="col" style={{ gap: 0 }}>
          <span>{r.name}</span>
          <span className="faint mono" style={{ fontSize: 11 }}>
            {r.root}
          </span>
        </span>
      ),
      icon: <FolderGit2 size={15} />,
      hint: r.dirty ? `${r.dirty}` : undefined,
      onClick: () => void g.selectRepo(r.root),
    })),
    { sep: true },
    { label: 'Depo ekle…', icon: <Plus size={15} />, onClick: () => void addRepo() },
    ...(g.repo ? [{ label: 'Listeden kaldır', icon: <Trash2 size={15} />, danger: true, onClick: () => void api.gitRemoveRepo(g.repo!).then(() => g.loadRepos()) }] : []),
  ];

  const info = g.info;
  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>Git</h1>
          <div className="sub">Son commit’leri, seçtiğiniz commit’leri ya da diskteki yerel değişiklikleri makinelere gönderin.</div>
        </div>
      </div>
      <div className="page-body fill">
        <div className="git-toolbar card">
          <MenuButton items={repoItems} width={380} buttonProps={{ size: 'sm' }}>
            <FolderGit2 size={15} />
            <b>{g.repo ? baseName(g.repo) : 'Depo seçin'}</b>
            <ChevronDown size={13} />
          </MenuButton>
          {info && (
            <span className="chip static" data-tip={info.upstream ? `Uzak: ${info.upstream}` : 'Uzak dal yok'} data-tip-pos="bottom">
              <GitBranch size={13} /> {info.branch || '—'}
              {!!info.ahead && (
                <span className="row" style={{ gap: 1, color: 'var(--accent)' }}>
                  <ArrowUp size={12} />
                  {info.ahead}
                </span>
              )}
              {!!info.behind && (
                <span className="row" style={{ gap: 1, color: 'var(--amber)' }}>
                  <ArrowDown size={12} />
                  {info.behind}
                </span>
              )}
            </span>
          )}
          <span className="faint mono ellipsis" style={{ fontSize: 11.5 }}>
            {g.repo}
          </span>
          <span className="spacer" />
          <Segmented
            value={g.mode}
            onChange={g.setMode}
            options={[
              { value: 'worktree', label: `Yerel değişiklikler${g.wtChanges.length ? ` (${g.wtChanges.length})` : ''}`, icon: <FileDiff size={14} /> },
              { value: 'commits', label: 'Commit’ler', icon: <GitCommit size={14} /> },
            ]}
          />
          <Button size="sm" iconOnly icon={<RefreshCw size={14} className={g.wtLoading || g.logLoading ? 'spin' : undefined} />} tip="Yenile" onClick={() => void g.refresh()} disabled={!g.repo} />
        </div>

        {!g.repo ? (
          <div className="card" style={{ flex: 1, display: 'grid', placeItems: 'center' }}>
            <Empty icon={<FolderGit2 size={22} />} title={g.loadingRepos ? 'Depolar aranıyor…' : 'Git deposu bulunamadı'} action={<Button icon={<Plus size={15} />} onClick={() => void addRepo()}>Depo ekle</Button>}>
              Yerel kökler içinde ya da üstünde bir git deposu bulunamadı. Bir depo klasörü seçin.
            </Empty>
          </div>
        ) : g.mode === 'worktree' ? (
          <WorktreeView />
        ) : (
          <CommitsView />
        )}
        {g.repo && <GitActionBar />}
      </div>
    </div>
  );
}

function ChangeList({
  changes,
  selected,
  onSelected,
  loading,
  emptyText,
}: {
  changes: GitChange[];
  selected: Set<string>;
  onSelected: (s: Set<string>) => void;
  loading: boolean;
  emptyText: string;
}) {
  const focus = useGit((s) => s.focusPath);
  const setFocus = useGit((s) => s.setFocus);
  const [q, setQ] = useState('');
  const parent = useRef<HTMLDivElement>(null);
  const ql = q.trim().toLowerCase();
  const rows = useMemo(() => (ql ? changes.filter((c) => c.path.toLowerCase().includes(ql)) : changes), [changes, ql]);
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => parent.current, estimateSize: () => 34, overscan: 16 });
  const selCount = rows.filter((c) => selected.has(c.path)).length;
  const setAll = (on: boolean) => {
    const n = new Set(selected);
    for (const c of rows) on ? n.add(c.path) : n.delete(c.path);
    onSelected(n);
  };

  useEffect(() => {
    if (!focus && rows.length) setFocus(rows[0].path);
  }, [rows, focus, setFocus]);

  return (
    <div className="card git-pane">
      <div className="pane-head">
        <Checkbox checked={rows.length > 0 && selCount === rows.length} mixed={selCount > 0 && selCount < rows.length} onChange={setAll} disabled={!rows.length} />
        <span className="tabular">
          <b>{selected.size}</b> / {changes.length} dosya
        </span>
        <span className="spacer" />
        <SearchInput value={q} onChange={setQ} placeholder="Süz" style={{ width: 150 }} />
      </div>
      {loading && !changes.length ? (
        <div className="empty">
          <div className="spinner" />
        </div>
      ) : !rows.length ? (
        <Empty icon={<CheckCheck size={20} />} title={changes.length ? 'Eşleşen dosya yok' : 'Değişiklik yok'}>
          {changes.length ? undefined : emptyText}
        </Empty>
      ) : (
        <div ref={parent} className="pane-scroll">
          <div style={{ height: v.getTotalSize(), position: 'relative' }}>
            {v.getVirtualItems().map((vi) => {
              const c = rows[vi.index];
              const { dir, name } = splitPath(c.path);
              const on = selected.has(c.path);
              return (
                <div
                  key={c.path}
                  className={cls('list-row', focus === c.path && 'focus')}
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${vi.start}px)`, height: vi.size, cursor: 'pointer' }}
                  onClick={() => setFocus(c.path)}
                >
                  <Checkbox
                    checked={on}
                    onChange={(val) => {
                      const n = new Set(selected);
                      val ? n.add(c.path) : n.delete(c.path);
                      onSelected(n);
                    }}
                  />
                  <span className={cls('sign', c.kind === '?' ? 'A' : c.kind)} data-tip={KIND_LABEL[c.kind]}>
                    {c.kind === '?' ? 'U' : c.kind}
                  </span>
                  <span className="path grow" title={c.oldPath ? `${c.oldPath} → ${c.path}` : c.path}>
                    {dir && <span className="dir">{'\u200e' + dir + '\u200e'}</span>}
                    <span className="name">{name}</span>
                  </span>
                  {c.binary ? (
                    <span className="faint" style={{ fontSize: 11 }}>
                      ikili
                    </span>
                  ) : (
                    (c.additions != null || c.deletions != null) && (
                      <span className="tabular nowrap" style={{ fontSize: 11.5, fontWeight: 600 }}>
                        {!!c.additions && <span style={{ color: 'var(--green)' }}>+{c.additions} </span>}
                        {!!c.deletions && <span style={{ color: 'var(--red)' }}>−{c.deletions}</span>}
                      </span>
                    )
                  )}
                  {c.staged && !c.unstaged && <span className="badge green" data-tip="Hazırlanmış (staged)">S</span>}
                  {c.untracked && <span className="badge" data-tip="Git tarafından izlenmiyor">yeni</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function useFocusedDiff(mode: 'worktree' | 'commits', changes: GitChange[]) {
  const repo = useGit((s) => s.repo);
  const focus = useGit((s) => s.focusPath);
  const shas = useGit((s) => s.selectedShas);
  const [state, setState] = useState<{ diff: DiffResult | null; loading: boolean; error?: string }>({ diff: null, loading: false });
  const change = changes.find((c) => c.path === focus);
  useEffect(() => {
    if (!repo || !change) {
      setState({ diff: null, loading: false });
      return;
    }
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    api
      .gitDiff({ repo, path: change.path, oldPath: change.oldPath, mode, shas })
      .then((diff) => alive && setState({ diff, loading: false }))
      .catch((e) => alive && setState({ diff: null, loading: false, error: (e as Error).message }));
    return () => {
      alive = false;
    };
  }, [repo, change, mode, shas]);
  return { ...state, change };
}

function DiffPane({ mode, changes }: { mode: 'worktree' | 'commits'; changes: GitChange[] }) {
  const { diff, loading, error, change } = useFocusedDiff(mode, changes);
  return (
    <div className="card git-pane diff-pane">
      <DiffView
        diff={diff}
        loading={loading}
        error={error}
        title={
          change ? (
            <span className="row" style={{ gap: 8 }}>
              <span className={cls('sign', change.kind === '?' ? 'A' : change.kind)}>{change.kind === '?' ? 'U' : change.kind}</span>
              <span className="mono ellipsis selectable" style={{ fontSize: 12 }}>
                {change.oldPath ? `${change.oldPath} → ` : ''}
                {change.path}
              </span>
            </span>
          ) : (
            <span className="faint">Fark</span>
          )
        }
      />
    </div>
  );
}

function WorktreeView() {
  const g = useGit();
  return (
    <div className="git-grid two">
      <ChangeList changes={g.wtChanges} selected={g.wtSelected} onSelected={g.setWtSelected} loading={g.wtLoading} emptyText="Çalışma kopyası temiz: commit edilmemiş değişiklik yok." />
      <DiffPane mode="worktree" changes={g.wtChanges} />
    </div>
  );
}

function CommitsView() {
  const g = useGit();
  return (
    <div className="git-grid three">
      <CommitList />
      <ChangeList
        changes={g.commitChanges}
        selected={g.ccSelected}
        onSelected={g.setCcSelected}
        loading={g.ccLoading}
        emptyText={g.selectedShas.length ? 'Seçili commit’ler dosya değiştirmiyor.' : 'Soldan bir ya da birkaç commit seçin.'}
      />
      <DiffPane mode="commits" changes={g.commitChanges} />
    </div>
  );
}

function CommitList() {
  const g = useGit();
  const parent = useRef<HTMLDivElement>(null);
  const anchor = useRef<number | null>(null);
  const [search, setSearch] = useState(g.search);
  const debounced = useDebounced(search, 350);
  useEffect(() => {
    if (debounced !== g.search) {
      g.setSearch(debounced);
      void g.loadLog(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const sel = new Set(g.selectedShas);
  const count = g.commits.length + (g.hasMore ? 1 : 0);
  const v = useVirtualizer({ count, getScrollElement: () => parent.current, estimateSize: () => 58, overscan: 10 });

  const items = v.getVirtualItems();
  const last = items[items.length - 1];
  useEffect(() => {
    if (last && last.index >= g.commits.length - 1 && g.hasMore && !g.logLoading) void g.loadLog(false);
  }, [last, g]);

  const click = (i: number, c: Commit, e: React.MouseEvent) => {
    let next: string[];
    if (e.shiftKey && anchor.current != null) {
      const [a, b] = [Math.min(anchor.current, i), Math.max(anchor.current, i)];
      next = g.commits.slice(a, b + 1).map((x) => x.sha);
    } else if (e.ctrlKey || e.metaKey) {
      next = sel.has(c.sha) ? g.selectedShas.filter((s) => s !== c.sha) : [...g.selectedShas, c.sha];
      anchor.current = i;
    } else {
      next = [c.sha];
      anchor.current = i;
    }
    void g.selectCommits(next);
  };
  const toggle = (i: number, c: Commit) => {
    anchor.current = i;
    void g.selectCommits(sel.has(c.sha) ? g.selectedShas.filter((s) => s !== c.sha) : [...g.selectedShas, c.sha]);
  };
  const unpushed = g.commits.filter((c) => g.unpushed.has(c.sha)).map((c) => c.sha);

  return (
    <div className="card git-pane">
      <div className="pane-head" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8, height: 'auto', paddingTop: 10, paddingBottom: 10 }}>
        <div className="input-wrap">
          <Search size={14} />
          <input className="input sm" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Mesaj ya da SHA ara" spellCheck={false} />
        </div>
        <div className="row" style={{ gap: 5, flexWrap: 'wrap' }}>
          <button className="chip" onClick={() => g.commits[0] && void g.selectCommits([g.commits[0].sha])}>
            Son commit
          </button>
          <button className="chip" onClick={() => void g.selectCommits(g.commits.slice(0, 3).map((c) => c.sha))}>
            Son 3
          </button>
          {unpushed.length > 0 && (
            <button className="chip" onClick={() => void g.selectCommits(unpushed)} data-tip="Henüz uzak dala gönderilmemiş commit’ler">
              <CloudUpload size={12} /> Push edilmemiş {unpushed.length}
            </button>
          )}
          {g.selectedShas.length > 0 && (
            <button className="chip" onClick={() => void g.selectCommits([])}>
              <X size={12} /> {g.selectedShas.length} seçili
            </button>
          )}
          <span className="spacer" />
          <label className="check-label faint" style={{ fontSize: 12 }}>
            <Checkbox checked={g.allBranches} onChange={g.setAllBranches} /> Tüm dallar
          </label>
        </div>
      </div>
      <div ref={parent} className="pane-scroll">
        <div style={{ height: v.getTotalSize(), position: 'relative' }}>
          {items.map((vi) => {
            if (vi.index >= g.commits.length)
              return (
                <div key="more" className="row faint" style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${vi.start}px)`, height: vi.size, justifyContent: 'center' }}>
                  <div className="spinner" /> Yükleniyor…
                </div>
              );
            const c = g.commits[vi.index];
            const on = sel.has(c.sha);
            return (
              <div
                key={c.sha}
                className={cls('commit-row', on && 'selected')}
                style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${vi.start}px)`, height: vi.size }}
                onClick={(e) => click(vi.index, c, e)}
                title={`${c.subject}${c.body ? '\n\n' + c.body : ''}\n\n${c.author} <${c.email}>\n${dateTime(c.date)}`}
              >
                <Checkbox checked={on} onChange={() => toggle(vi.index, c)} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="ellipsis" style={{ fontWeight: 560 }}>
                    {c.subject}
                  </div>
                  <div className="row faint" style={{ fontSize: 11.5, gap: 6 }}>
                    <span className="mono" style={{ color: 'var(--text-2)' }}>
                      {c.short}
                    </span>
                    <span className="ellipsis">{c.author}</span>
                    <span className="nowrap">• {ago(c.date)}</span>
                    {g.unpushed.has(c.sha) && (
                      <span className="badge blue" style={{ height: 16, fontSize: 10.5 }} data-tip="Push edilmemiş">
                        <ArrowUp size={10} />
                      </span>
                    )}
                    {c.refs
                      .slice(0, 2)
                      .map((r) => (
                        <span key={r} className={cls('badge', r.startsWith('tag:') ? 'violet' : r.startsWith('HEAD') ? 'green' : '')} style={{ height: 16, fontSize: 10.5, maxWidth: 120 }}>
                          {r.startsWith('tag:') && <Tag size={9} />}
                          <span className="ellipsis">{r.replace('HEAD -> ', '').replace('tag: ', '')}</span>
                        </span>
                      ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {!g.commits.length && !g.logLoading && <Empty icon={<GitCommit size={20} />} title="Commit bulunamadı" />}
      </div>
    </div>
  );
}

function GitActionBar() {
  const g = useGit();
  const targets = useApp((s) => s.targets);
  const setTargets = useApp((s) => s.setTargets);
  const startPlan = useApp((s) => s.startPlan);
  const options = useApp((s) => s.options);
  const toast = useApp((s) => s.toast);
  const [tpOpen, setTpOpen] = useState(false);
  const [optOpen, setOptOpen] = useState(false);
  const tpRef = useRef<HTMLButtonElement>(null);
  const optRef = useRef<HTMLButtonElement>(null);
  const [outside, setOutside] = useState(0);
  const [busy, setBusy] = useState(false);

  const isWt = g.mode === 'worktree';
  const changes = isWt ? g.wtChanges.filter((c) => g.wtSelected.has(c.path)) : g.commitChanges.filter((c) => g.ccSelected.has(c.path));
  const deletions = changes.filter((c) => c.kind === 'D').length + changes.filter((c) => c.oldPath && c.oldPath !== c.path).length;
  const debouncedKey = useDebounced(changes.map((c) => c.path).join('\n'), 400);

  useEffect(() => {
    if (!g.repo || !debouncedKey) {
      setOutside(0);
      return;
    }
    const sep = g.repo.includes('\\') ? '\\' : '/';
    const paths = debouncedKey
      .split('\n')
      .slice(0, 400)
      .map((p) => g.repo + sep + p.split('/').join(sep));
    api
      .describeSources(paths, false)
      .then((infos) => setOutside(infos.filter((i) => i.outsideRoots).length))
      .catch(() => setOutside(0));
  }, [debouncedKey, g.repo]);

  const newest = () => {
    const idx = g.selectedShas.map((s) => g.commits.findIndex((c) => c.sha === s)).filter((i) => i >= 0);
    return idx.length ? g.commits[Math.min(...idx)] : undefined;
  };

  const send = async () => {
    if (!g.repo || !changes.length) return;
    setBusy(true);
    try {
      const head = newest();
      const sources = await api.gitSources({ repo: g.repo, changes, contentFrom: isWt ? 'worktree' : g.contentFrom, rev: head?.sha });
      const repoName = baseName(g.repo);
      const label = isWt ? `${repoName}: yerel değişiklikler` : g.selectedShas.length === 1 ? `${repoName}: ${head?.short} ${head?.subject ?? ''}`.slice(0, 80) : `${repoName}: ${g.selectedShas.length} commit`;
      await startPlan({ sources, origin: 'git', label });
    } catch (e) {
      toast('error', 'Hazırlanamadı', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="action-bar">
      <div className="row grow" style={{ gap: 10 }}>
        <span className="tabular nowrap">
          <b>{num(changes.length)}</b> dosya
          {deletions > 0 && options.propagateDeletes && <span className="faint"> ({deletions} silme)</span>}
        </span>
        {!isWt && (
          <Segmented
            size="sm"
            value={g.contentFrom}
            onChange={g.setContentFrom}
            options={[
              { value: 'worktree', label: 'Diskteki hâli', tip: 'Dosyaları şu an diskte oldukları gibi gönderir' },
              { value: 'commit', label: 'Commit’teki hâli', tip: 'Dosyaları seçilen en yeni commit’teki içerikleriyle gönderir\n(sonradan yapılan yerel değişiklikler gitmez)' },
            ]}
          />
        )}
        {outside > 0 && (
          <span className="badge amber" data-tip={'Bu dosyalar hiçbir yerel kökün altında değil;\nhedefte sürücü harfiyle tam yolu korunarak yazılır.'}>
            <AlertTriangle size={11} /> {outside} kök dışı
          </span>
        )}
      </div>
      <button ref={tpRef} className="btn lg target-btn" onClick={() => setTpOpen((o) => !o)}>
        <Server size={15} />
        <TargetSummary value={targets} />
        <ChevronDown size={14} />
      </button>
      <button ref={optRef} className="btn lg icon" data-tip="Seçenekler" onClick={() => setOptOpen((o) => !o)}>
        <SlidersHorizontal size={15} />
      </button>
      <Button size="lg" variant="primary" icon={<Send size={15} />} disabled={!changes.length || !targets.length} loading={busy} onClick={() => void send()}>
        İncele ve gönder
      </Button>
      {tpOpen && (
        <Popover anchor={tpRef.current} onClose={() => setTpOpen(false)} align="end" width={400} placement="top">
          <TargetPicker value={targets} onChange={setTargets} maxHeight={420} />
        </Popover>
      )}
      {optOpen && (
        <Popover anchor={optRef.current ?? tpRef.current} onClose={() => setOptOpen(false)} align="end" width={560} placement="top">
          <OptionsCard git />
        </Popover>
      )}
    </div>
  );
}
