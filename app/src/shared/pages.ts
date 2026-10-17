// The pages of the window, in sidebar order (Ctrl 1…9 follow it). Shared so the help content can point at them.
export type AppPage = 'overview' | 'send' | 'compare' | 'git' | 'sync' | 'automation' | 'targets' | 'backups' | 'history' | 'help' | 'settings';

export const APP_PAGES: AppPage[] = ['overview', 'send', 'compare', 'git', 'sync', 'automation', 'targets', 'backups', 'history', 'help', 'settings'];
