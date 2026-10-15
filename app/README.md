# SamSync

[Türkçe](README.tr.md)

A desktop app that sends files, folders and Git changes to many machines at **the same relative path**, compares and synchronizes targets, sends changes automatically, and rolls them back when needed. Runs on Windows, macOS and Linux (Electron + React + TypeScript).

It replaces the old PowerShell tool ([`../legacy`](../legacy/README.md)) and reads that tool's `config.json` as is.

The user interface is in Turkish. Below, UI labels are given in Turkish with the English meaning next to them, e.g. **Gönder** (Send).

## Installation

`npm run dist:win` produces two files in `release/<version>/`:

| File | When to use |
| --- | --- |
| `SamSync-Setup-<version>.exe` | Recommended. Installs per user (no admin rights needed), creates Start menu and desktop shortcuts, **updates itself**. |
| `SamSync-<version>-portable.exe` | No installation, a single file. Can run from a USB stick or a share; cannot update itself. |

macOS (`.dmg`) and Linux (`.AppImage`) packages have to be built on their own operating systems; GitHub Actions builds all three (see *Publishing a release* below).

## First start

Without a configuration, the welcome screen offers three ways in:

- **Mevcut config.json'ı kullan** (use an existing config.json) — the shared file on a network share, or the old tool's `legacy/config.json`. The app writes its changes to that file and keeps the old tool's fields (`version`, `menuTitle`, `notepadPlusPlusShortcuts`…), so the PowerShell tool keeps working with the same file.
- **Kopyasını içe aktar** (import a copy) — copies the machines into this computer's own configuration.
- **Sıfırdan başla** (start from scratch) — add the machines one by one on the **Hedefler** (Targets) page.

The app recognises the machine it runs on with the same rules as the old tool: the `SAMSYNC_NODE_ID` environment variable, the IP address, the computer name (`address` / `localNames`), and, when several nodes match, the one whose local root exists here. The machine can also be pinned by hand on the Targets page.

## Pages

### Gönder (Send)
Drag files/folders onto the window, pick them, or paste a path; then choose targets (groups, search, reachability dots, profiles, "failed in the last run"). **İncele ve gönder** (review and send) shows, file by file, what will happen on each target:

| Sign | Meaning |
| --- | --- |
| `+` | not on the target yet, new |
| `~` | will be updated |
| `!` | the file on the target is **newer** (written in *Üzerine yaz* / overwrite mode, skipped in *Yalnızca yeni* / update-only mode) |
| `−` | extra on the target (deleted only in *Ayna* / mirror mode) / deleted in Git |

Any row can be unticked, `⇄` opens the line diff between source and target, and **Seçimi tüm hedeflere uygula** (apply selection to all targets) copies the choices made for one target to the others. **İzle** (watch) puts the chosen sources under watch (see *Automation*).

Options: mode (overwrite / update only / mirror), comparison (date+size / content / size), **yedek al** (keep a backup: old versions are moved into the backup folder on the target under a `<timestamp>` folder), verification (content hash), excluded file/folder patterns, number of parallel targets, dry run, notification when done, post-copy command.

Writes are atomic: a file is first written under a temporary name, its size (and optionally its hash) is checked, then it is moved into place. An interrupted copy never leaves a broken file on the target.

### Git
The repository is found automatically from the local roots (or added by hand).

- **Yerel değişiklikler** (local changes) — staged, unstaged and untracked files.
- **Commit'ler** (commits) — click: one commit; Ctrl+click: add/remove; Shift+click: a range. Quick picks: *Son commit* (last commit), *Son 3* (last 3), *Push edilmemiş* (not pushed). Search by message or SHA, all branches.

The files of the selected commits are merged into one list; each file's diff is shown on the right. The content can come from **diskteki hâli** (the file as it is on disk) or **commit'teki hâli** (the file as it is in the commit). Deleted and moved files are removed from the targets too (can be turned off). Commit content is compared with the target through the git object hash, so identical files are not written again.

### Senkron (Sync)
For folder pairs (left: this machine or a target; right: a subfolder of any target, or a local folder):

- **İki yönlü** (two-way) — remembers the state after the last sync; a file deleted on one side is deleted on the other, a file changed on both sides is marked as a **conflict**.
- **Ayna** (mirror), **Güncelle** (update), **Özel** (custom: you pick the action for each situation).
- Filter: include/exclude patterns, size and date limits. Deleted/overwritten files are versioned or deleted permanently.
- **Zamanla** (schedule) — the job runs by itself at an interval or at set times (see *Automation*).

The comparison is shown in a grid; click a row's action to change it, double-click a row to open its line diff.

### Otomasyon (Automation)
- **Canlı izleme** (live watch) — watches files and folders; after a save it waits for a short quiet period (2 s by default) and sends only what changed to the chosen machines. Machines that are unreachable at that moment do not lose the changes: they are retried every minute. Temporary files (`~$…`, `.tmp`, `.swp`) and `.git` are ignored; deleting files on the targets when they are deleted locally is optional. Add a watch with the **İzle** button on the Send page or from this page.
- **Zamanlanmış senkron** (scheduled sync) — sync jobs are compared every N minutes or at set times (e.g. 09:00, 18:30) and synchronized with the suggested actions; conflicts are left alone. Because the configuration is shared by all machines, each job is marked to run on **one machine only**. A time missed while the app was closed runs when it starts again.
- **Hepsini duraklat** (pause all) — stops watching and scheduling together (also from the tray menu).

Automation runs while the app is running. Under Ayarlar (Settings) → *Arka plan ve başlangıç* (background and startup), **Kapatınca sistem tepsisinde çalışmaya devam et** (keep running in the tray when closed) and **Windows açılışında başlat** (start with Windows, hidden in the tray) keep it running all the time. Automatic runs are recorded in the history too.

### Hedefler (Targets), Yedekler (Backups), Geçmiş (History), Ayarlar (Settings)
- **Hedefler** — machine cards, reachability (refreshed every 45 s), adding and editing machines. Connection types: Windows share (SMB, `\\address\networkRoot`), folder / mounted drive, **SFTP** (key, agent, or a password kept in the operating system's encrypted store).
- **Yedekler** — finds an item's backups on the targets and writes a chosen version back (backing up the current state first).
- **Geçmiş** — the last 300 runs: result per target, errors, log, CSV report, *yeniden gönder* (send again) / *hatalılara yeniden gönder* (send again to the failed ones).
- **Ayarlar** — theme (Koyu / Açık / Sistemle eşle = dark / light / follow the system; dark by default), accent colour, density; copy defaults (retries, parallelism, **bandwidth limit per target** — the equivalent of the old tool's `/IPG` —, backup folder name); configuration file; right-click menu; background and startup; updates.

The backup folder is `_SamSyncYedek` under each target root by default; its name can be changed in Settings → Kopyalama (Copy).

On computers where the old tool's machine id was pinned with `setx`, set the same value as `SAMSYNC_NODE_ID` (`setx SAMSYNC_NODE_ID Unit1Trainer`) or pick the machine under Targets → *Bu makine* (this machine).

## Command line and Explorer

```bat
SamSync.exe "C:\Sim\ActiveRelease\Data\x.entity" "C:\Sim\ActiveRelease\Models"
SamSync.exe "C:\...\Data" --to group:Unit1,Arsiv
```

The paths are added to the Send list. `--to` (machine id, `group:<name>`, `profile:<name>`, `all`) selects the targets and opens the review right away; it replaces the old menu's "send to this group" entries and can be saved as a shortcut.

Settings → **Sağ tık menüsü** (right-click menu) adds “SamSync ile gönder” (send with SamSync) to Explorer, for up to 100 selected items. Explorer starts the app once per item; the single-instance lock gathers them all into one window.

Shortcuts: `Ctrl+K` command palette, `Ctrl+1…8` pages, `F12` developer tools.

## Auto-update

Settings → Güncellemeler (updates); the source is stored in the shared configuration:

| Source | Use |
| --- | --- |
| GitHub | Releases come from GitHub Releases (the workflow below, or `npm run release:github` with `GH_TOKEN`). |
| Web address | Any HTTP(S) folder that holds `latest.yml` and the installers. |
| Network folder | For machines without internet: `npm run release:folder -- "\\server\Dist\SamSync"`. Machines read `latest.yml`, verify the installer with SHA-512 and install it silently. |

Updates are checked at start and every 6 hours, downloaded in the background, and installed with “Yeniden başlat ve kur” (restart and install). The version number is the `version` field in `package.json`. On macOS, auto-update needs a signed package.

The GitHub repository is not written in the code: `scripts/dist.mjs` reads it from the git remote (or `GITHUB_REPOSITORY` in CI) at build time and electron-builder stores it in the package.

## Publishing a release

`.github/workflows/release.yml`: bump `version` in `app/package.json`, then create and push a `v<version>` tag:

```bash
git tag v2.1.0
git push origin v2.1.0
```

The workflow tests and packages the app on Windows, macOS and Linux and uploads everything to a **draft** GitHub Release (with the `latest*.yml` update feeds). Publishing the draft delivers the update to installed apps. `ci.yml` runs the type check and tests on all three systems for every pull request.

## Data

| Location | Contents |
| --- | --- |
| `config.json` (the chosen file) | machines, groups, profiles, sync jobs and their schedules, copy and update settings |
| `%APPDATA%\SamSync\settings.json` | specific to this computer: theme, last selections, configuration path, pinned machine, **watches**, tray/startup |
| `…\secrets.json` | SFTP passwords (encrypted with the operating system's secure store) |
| `…\history\` | run history; `…\reports\` CSV reports |
| `…\syncdb\` | last state of two-way syncs |
| `…\log\root.log` | log (rotated at 5 MB); can be redirected with `SAMSYNC_LOG` |

## Development

```bash
npm install
npm run dev          # Electron with hot reload
npm test             # core tests (real file system, git and file watching)
npm run typecheck
npm run demo -- .demo     # demo environment with fake target folders + config (.demo/ is not committed)
npm run web -- --user-data .demo/userdata   # core + UI in a browser (http://localhost:5198)
npm run dist:win     # installer + portable exe
```

Layers: `src/core` (engine independent of Electron: configuration, machine detection, transports, planner, executor, git, sync, automation, backups), `src/main` (window, IPC, tray, Explorer menu, updater), `src/preload`, `src/renderer` (React UI), `src/shared` (shared types and the API contract).
