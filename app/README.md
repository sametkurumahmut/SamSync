# SamSync

[Türkçe](README.tr.md)

A desktop app that sends files, folders and Git changes to many machines at **the same relative path**, compares and synchronizes targets, sends changes automatically, and rolls them back when needed. Runs on Windows, macOS and Linux (Electron + React + TypeScript).

It replaces the old PowerShell tool ([`../legacy`](../legacy/README.md)) and reads that tool's `config.json` as is.

The user interface is in Turkish and English. It follows the computer's display language (Turkish for a Turkish Windows, English for anything else) unless one is picked under Settings → **Language**. Below, UI labels are given in Turkish with the English label next to them, e.g. **Gönder** (Send).

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

The app recognises the machine it runs on with the same rules as the old tool: the `SAMSYNC_NODE_ID` environment variable, the IP address, the computer name (`address` / `localNames`, as the bare name or, on a domain, as `<name>.<USERDNSDOMAIN>`), and, when several nodes match, the one whose local root exists here. The machine can also be pinned by hand on the Targets page.

Node ids and group names may only contain letters, digits, dots, underscores and hyphens (`Unit1`, no spaces), because they are used as machine ids and `group:<name>` on command lines and in the menus. As with the old tool, a config that breaks this rule is not loaded.

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

**Per-target settings** (the old wizard's *Yedek al* / *Yalnızca yeni* / *Ayna* columns): the slider button at the end of a machine row gives that machine its own mode and backup. For example, the trainer can mirror with a backup while the IGs take newer files only.
- The row shows the exception as a badge, the bottom bar counts them (*N hedefte özel ayar*, own settings on N targets), and the review shows them on each target card.
- **Seç → Hedefe özel ayarları temizle** (clear per-target settings) brings every machine back to the general options.
- They are saved with the last send, so `--to last` and *Son ayarla gönder* use them. A profile keeps the exceptions of its own machines.

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
- **Yedekler** — finds an item's backups on the targets and writes a chosen version back (backing up the current state first). Older backup folders at a target root are searched too (see below); their versions show the folder name.
- **Geçmiş** — the last 300 runs: result per target, errors, log, CSV report, *yeniden gönder* (send again) / *hatalılara yeniden gönder* (send again to the failed ones).
- **Ayarlar** — language (Sistemle eşle / Türkçe / English, following the system by default), theme (Koyu / Açık / Sistemle eşle = dark / light / follow the system; dark by default), accent colour, density; copy defaults (retries, parallelism, **bandwidth limit per target** — the equivalent of the old tool's `/IPG` —, backup folder name); configuration file; right-click menus (Explorer, Notepad++); background and startup; updates.

The backup folder is `_SamSyncYedek` under each target root by default; its name can be changed in Settings → Kopyalama (Copy).

**Older backup folders** — the old tool kept its backups in a `_…Yedek` folder of its own at the target root. SamSync treats a folder as a backup folder when it sits at the root of a target (or of a local root), its name starts with `_`, and it holds nothing but `yyyyMMdd-HHmmss` folders. Such a folder:
- is neither deleted nor written into by a mirror send or a mirror sync of the whole root (the review says so), and is never sent along;
- shows up on the Backups page, and its versions can be restored;
- is never trimmed: only the configured folder keeps just the newest *Saklanacak yedek* (backups to keep).

The same applies to an earlier SamSync backup folder after its name was changed.

**Importing from the old wizard** — Settings → *Yapılandırma dosyası* (configuration file) → **Sihirbaz ayarlarını içe aktar** (import wizard settings) brings the old wizard's profiles and last selection over once.
- **The file:** `wizard-state.json` under `%LOCALAPPDATA%` is found by itself; *Dosya seç…* (choose file) picks it by hand. The entry saved for this config is used; if the folder has moved since, the entry that knows most of its machines is used.
- **Last selection:** the ticked machines become the last send's targets. The per-machine columns become the general options plus per-target exceptions, so every machine keeps exactly what it had. The wizard's excluded files and folders are added to the config's. Dry run and the robocopy-only settings (fast copy, inter-packet gap, retries) are not taken over.
- **Profiles:** they become SamSync profiles in the config. A profile whose name already exists is left as it is.
- **Unknown machines:** machines that are not in the config are skipped and listed.

On computers where the old tool's machine id was pinned with `setx`, set the same value as `SAMSYNC_NODE_ID` (`setx SAMSYNC_NODE_ID Unit1Trainer`) or pick the machine under Targets → *Bu makine* (this machine).

## Explorer and Notepad++ menus

The installed app puts the old tool's right-click menus back, and they are **on by default**. They can be switched off under Settings → **Sağ tık menüleri** (right-click menus). On every start, and whenever the machine list, the language or these switches change, the app rebuilds them. They always point at the program that is running, so they keep working after an update or a move. The uninstaller removes them.

**Explorer** (files and folders; on Windows 11 under “Show more options”) gets a **SamSync** submenu, built the same way as the old one:

| Entry | Click |
| --- | --- |
| Tümüne gönder (send to all) | sends at once to every enabled machine except this one |
| İncele ve gönder… (review and send) | opens SamSync with the items on the Send page |
| Son ayarla gönder (send with last settings) | sends at once with the targets and options of the last reviewed send |
| Yedekten geri al… (restore from backup) | opens Backups with the items and looks on every machine |
| <profile> (profil) | sends at once with the profile's targets and options |
| <group> | sends at once to the whole group, or opens a submenu with “<group> - Tümü” and its machines |
| <machine> | sends at once to that machine (machines outside groups) |

- **Separators** split the menu into all | review and last settings | restore | profiles | groups | single machines.
- **Fitting the menu:** Windows shows a static submenu comfortably up to 16 entries. This machine's own group is expanded first; the other groups are expanded only if they all fit, otherwise each is a single entry. `menuShowNodes` in config.json (`auto`, `always`, `never`; also on the settings page) changes that, as in the old tool.
- **One-click sends** do not touch the Send page list. A send that would delete on a target (mirror from a profile or the last settings) opens the review instead.
- **Large selections:** up to 100 selected items work. Explorer starts the app once per item, and the requests are merged into one send: 400 ms of quiet, 1.2 s once a second item has arrived, at most 30 s.

**Notepad++** (8.4.8 or later; standard installs and portable ones with `doLocalConf.xml`):
- **Tab menu:** right-clicking a tab shows a **SamSync** folder with the same entries, flat, with a separator per section and per group.
- **Run menu:** the same entries are Run commands.
- **Shortcuts:** they come from `notepadPlusPlusShortcuts` in config.json, for example `{ "wizard:last": "Ctrl+Alt+W" }`, which is also the default. `Ctrl+Alt+W` sends the saved file of the active tab with the last settings, without opening a window. The entry ids are the old ones (`all`, `wizard`, `wizard:last`, `restore`, `profile:<name>`, `group:<name>`, machine ids), and the shortcuts can also be edited in Settings.
- **What changes in the files:** SamSync edits `shortcuts.xml` and `tabContextMenu.xml` as text and only touches entries named `[SamSync] …`. It then signs `shortcuts.xml` in `config.xml` (`shortcutsXmlHMAC`, required since Notepad++ 8.9.6.2).
- **If Notepad++ is open:** Notepad++ writes these files back from memory when it exits, so changes made while it is open would be lost. SamSync writes them again once it has closed.
- **Commands too long:** a command longer than 260 characters (Notepad++'s limit) is left out with a warning.

On a machine that still has the old tool's menus, remove those with `legacy\Uninstall-ContextMenu.bat`; otherwise both menus are shown.

## Command line

```bat
SamSync.exe "C:\Sim\ActiveRelease\Data\x.entity" "C:\Sim\ActiveRelease\Models"
SamSync.exe --to group:Unit1,Arsiv "C:\...\Data"
SamSync.exe --to last --yes "C:\...\Data\x.entity"
```

| Argument | Meaning |
| --- | --- |
| paths | added to the Send list |
| `--to <ids>` | machine ids, `group:<name>`, `profile:<name>`, `all`, `last` (the last reviewed send's targets and options), comma separated; opens the review |
| `--yes` | with `--to`: sends at once without the review (what the menu entries use) |
| `--restore` | opens Backups with the items |
| `--hidden` | starts in the tray (used by start at login) |
| `--remove-integrations` | removes the Explorer menu and the Notepad++ entries, then quits (used by the uninstaller) |
| `--plan-only` | prints where each item would go on each target, without a window (the old `-PlanOnly`) |
| `--check-only` | prints whether each target holds the same items, without a window (the old `-CheckOnly`) |

Shortcuts: `Ctrl+K` command palette, `Ctrl+1…8` pages, `F12` developer tools.

### Plan and equality check without a window

```bat
start /wait SamSync.exe --check-only --to all "C:\Sim\ActiveRelease\Data"
echo %ERRORLEVEL%
SamSync.exe --plan-only --to profile:Unit1IG "C:\Sim\ActiveRelease\Data\x.entity" | more
```

Both modes use the same settings and config as the app, and they also run while a SamSync window is open. `--to` works as for a send: all targets when it is left out, and `last` and `profile:` bring their per-target settings. The table goes to standard output; the machine, warnings, errors and the summary go to standard error, so the table can be redirected on its own. Column names and state values are ASCII and the same as the old tool's:

- `--plan-only` — one row per item and target: `Source`, `LocalRoot`, `LocalMachine`, `Target`, `Destination`, `Options` (`Backup`, `OnlyNewer`, `Mirror`). Nothing is read on the targets.
- `--check-only` — one row per target: `Target`, `TargetId`, `State`, `Changes`, `Missing`, `DestNewer`, `Extras`. Nothing is written. `State` is one of:
  - `Ayni` — same;
  - `Farkli` — different;
  - `Yok` — none of the items is on the target;
  - `Erisilemedi` — unreachable;
  - `Hata` — reading the target failed.

  Extra files on a target do not make it different by themselves.

Exit code: `0` means the plan was computed or every target is the same. `1` means a difference, a missing item, an unreachable target, or an error (missing source, unknown target, this machine not recognised, unreadable config). The result is also written to `root.log`.

SamSync.exe is a Windows GUI program, so `cmd` does not wait for it by itself. Use `start /wait` to read `%ERRORLEVEL%`, or pipe the output (`| more`; `| Out-String` in PowerShell), which makes the shell wait and sets `$LASTEXITCODE`.

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
| `…\history\` | run history; `…\reports\` a CSV report for every run (`rapor-<time>-<id>.csv`, the last 300 are kept) |
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

Layers: `src/core` (engine independent of Electron: configuration, machine detection, transports, planner, executor, git, sync, automation, backups), `src/main` (window, IPC, tray, command line, Explorer and Notepad++ integration, updater), `src/preload`, `src/renderer` (React UI), `src/shared` (shared types, the API contract, the menu entries and `i18n`: the Turkish text is the key, `i18n/en/*.ts` hold the English; `tests/i18n.test.ts` fails when a text has no English or a Turkish text is left outside `t()`).
