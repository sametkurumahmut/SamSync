# SamSync

[Türkçe](README.tr.md)

Tools that copy files to several machines at the same relative path.

![SamSync: the Send page](docs/screenshots/en-send.png)

![SamSync: comparing the sources with a target](docs/screenshots/en-compare.png)

| Folder | What |
| --- | --- |
| [`app/`](app/README.md) | **SamSync** — desktop app for Windows, macOS and Linux: send to many machines at once, send Git commits or local changes, folder compare and sync (two-way, mirror, update), automatic sending on change, scheduled sync, restore from backups, auto-update. |
| [`legacy/`](legacy/README.md) | Previous version (1.x) — a PowerShell tool driven from the Explorer and Notepad++ right-click menus. |

Both can use the same `config.json`: SamSync reads the old tool's file and keeps its fields when saving.
