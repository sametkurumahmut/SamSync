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

## License

Copyright (C) 2026 Samet Kurumahmut

SamSync is free software: you can redistribute it and/or modify it under the terms of the [GNU General Public License version 3](LICENSE) as published by the Free Software Foundation. It is distributed in the hope that it will be useful, but **without any warranty**; without even the implied warranty of merchantability or fitness for a particular purpose. See the [`LICENSE`](LICENSE) file for the full text.
