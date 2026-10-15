import { create } from 'zustand';
import type { GitChange, GitCommit, GitRepoInfo } from '@shared/types';
import { api } from '../lib/api';

export type GitMode = 'worktree' | 'commits';

interface GitState {
  repos: GitRepoInfo[];
  repo: string | null;
  info: GitRepoInfo | null;
  mode: GitMode;
  loadingRepos: boolean;

  // working tree
  wtChanges: GitChange[];
  wtLoading: boolean;
  wtSelected: Set<string>;

  // commits
  commits: GitCommit[];
  unpushed: Set<string>;
  hasMore: boolean;
  logLoading: boolean;
  search: string;
  allBranches: boolean;
  selectedShas: string[];
  commitChanges: GitChange[];
  ccLoading: boolean;
  ccSelected: Set<string>;
  contentFrom: 'worktree' | 'commit';

  focusPath: string | null;
  pendingAction: 'lastCommit' | 'worktree' | null;

  loadRepos(): Promise<void>;
  selectRepo(root: string): Promise<void>;
  setMode(m: GitMode): void;
  refresh(): Promise<void>;
  loadWorktree(): Promise<void>;
  loadLog(reset?: boolean): Promise<void>;
  setSearch(s: string): void;
  setAllBranches(v: boolean): void;
  selectCommits(shas: string[]): Promise<void>;
  setWtSelected(s: Set<string>): void;
  setCcSelected(s: Set<string>): void;
  setFocus(p: string | null): void;
  setContentFrom(v: 'worktree' | 'commit'): void;
}

const keyOf = (c: GitChange) => c.path;

export const useGit = create<GitState>((set, get) => ({
  repos: [],
  repo: localStorage.getItem('samsync.git.repo'),
  info: null,
  mode: (localStorage.getItem('samsync.git.mode') as GitMode) || 'worktree',
  loadingRepos: false,
  wtChanges: [],
  wtLoading: false,
  wtSelected: new Set(),
  commits: [],
  unpushed: new Set(),
  hasMore: false,
  logLoading: false,
  search: '',
  allBranches: false,
  selectedShas: [],
  commitChanges: [],
  ccLoading: false,
  ccSelected: new Set(),
  contentFrom: 'worktree',
  focusPath: null,
  pendingAction: null,

  async loadRepos() {
    set({ loadingRepos: true });
    try {
      const repos = await api.gitRepos();
      set({ repos });
      const cur = get().repo;
      if (!cur || !repos.some((r) => r.root.toLowerCase() === cur.toLowerCase())) {
        if (repos[0]) await get().selectRepo(repos[0].root);
      } else if (!get().info) await get().selectRepo(cur);
    } finally {
      set({ loadingRepos: false });
    }
  },

  async selectRepo(root) {
    localStorage.setItem('samsync.git.repo', root);
    set({ repo: root, info: null, wtChanges: [], commits: [], selectedShas: [], commitChanges: [], focusPath: null, wtSelected: new Set(), ccSelected: new Set() });
    await get().refresh();
  },

  setMode(m) {
    localStorage.setItem('samsync.git.mode', m);
    set({ mode: m, focusPath: null });
  },

  async refresh() {
    await Promise.all([get().loadWorktree(), get().loadLog(true)]);
    if (get().selectedShas.length) await get().selectCommits(get().selectedShas);
  },

  async loadWorktree() {
    const repo = get().repo;
    if (!repo) return;
    set({ wtLoading: true });
    try {
      const { info, changes } = await api.gitStatus(repo);
      const prev = get().wtChanges;
      const prevSel = get().wtSelected;
      // new files are selected by default; keep the user's choice for files already listed
      const known = new Set(prev.map(keyOf));
      const sel = new Set<string>();
      for (const c of changes) if (!known.has(keyOf(c)) || prevSel.has(keyOf(c))) sel.add(keyOf(c));
      set({ info, wtChanges: changes, wtSelected: sel });
    } finally {
      set({ wtLoading: false });
    }
  },

  async loadLog(reset = false) {
    const { repo, search, allBranches } = get();
    if (!repo) return;
    set({ logLoading: true });
    try {
      const skip = reset ? 0 : get().commits.length;
      const page = await api.gitLog(repo, { skip, limit: 60, search: search || undefined, all: allBranches });
      set((s) => ({ commits: reset ? page.commits : [...s.commits, ...page.commits], hasMore: page.hasMore, unpushed: new Set(page.unpushed) }));
    } finally {
      set({ logLoading: false });
    }
  },

  setSearch(s) {
    set({ search: s });
  },
  setAllBranches(v) {
    set({ allBranches: v });
    void get().loadLog(true);
  },

  async selectCommits(shas) {
    set({ selectedShas: shas, focusPath: null });
    const repo = get().repo;
    if (!repo || !shas.length) {
      set({ commitChanges: [], ccSelected: new Set() });
      return;
    }
    set({ ccLoading: true });
    try {
      const changes = await api.gitCommitChanges(repo, shas);
      if (get().selectedShas !== shas) return;
      set({ commitChanges: changes, ccSelected: new Set(changes.map(keyOf)) });
    } finally {
      set({ ccLoading: false });
    }
  },

  setWtSelected(s) {
    set({ wtSelected: s });
  },
  setCcSelected(s) {
    set({ ccSelected: s });
  },
  setFocus(p) {
    set({ focusPath: p });
  },
  setContentFrom(v) {
    set({ contentFrom: v });
  },
}));
