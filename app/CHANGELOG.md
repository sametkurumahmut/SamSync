# Release history

[Türkçe](CHANGELOG.tr.md)

## 2.4.13 — 2026-10-27

- **Phone and tablet:** the web interface fits on a phone and on a tablet held upright (820 pixels and below). The sidebar stays as an icon strip, the top bar gets simpler, pages go to one column and scroll as a whole with their header. The bottom bar of the Send page sticks to the bottom of the screen and is small; nothing overflows sideways on Git, Compare, Sync, Targets and History.
- **Temporary files:** the SamSync temporary files (`*.samsync-tmp`) that a dropped connection leaves on a target are deleted at the end of the next send that scans that folder: the ones older than a day, and the partial pieces of large files after 14 days. These files no longer show up as extra files in a comparison or in the review. Mirror mode also no longer takes the part of a large file that will resume where it stopped for an extra file and deletes it.
- **Fix:** in Settings a long folder path breaks in the description line and does not widen the card.

## 2.4.12 — 2026-10-27

- **Appearance fixes:**
  - On the Send page the options slid behind the bar at the bottom; the columns now scroll on their own and the bar always stays on top.
  - On Overview the chart of the *Today* card no longer runs over the bottom row.
  - The command search box in the top bar stays in the middle on every page in a wide window.
  - On Sync the folder pair row fills the card, long paths are shortened with "…", and the arrow of the machine picker is no longer cut off.
  - On Targets the search box and the *Status* button are the same size as the other buttons of the toolbar. The rows on the cards line up side by side: the card of a machine with no send yet says *No sends yet*, and the connection row does not move up.
  - On Git the horizontal scrollbar of the diff view no longer covers the last line.
  - *Parallel targets* on Send and *Versions to keep* on Sync line up with their rows.
  - On Compare the button is the same size as the pickers; the hint of the empty Sources card no longer sticks to the edge.
  - In Settings › About the data folder is written with backslashes on Windows; *Developer tools* is now a button.
  - In Help the search icon is inside the box. Disabled buttons are easier to read.
- **Fix:** on a release point, "Go back to this point…" also undid a later send on machines that were not in the point, if that send had gone to them too; now it undoes only on the point's machines.
- **Fix:** the manifest on the target looked at the case of the folder name: when a folder written as `Bin` was sent as `bin`, the manifest was not used and the two stayed as separate entries. Now they count as the same folder.

## 2.4.11 — 2026-10-26

- **Confirm dialogs:** the warning about deleting in mirror mode and all the other "are you sure?" questions now appear in SamSync's own window instead of the browser's built-in box. For things like delete, overwrite or close, the confirm button is red and the focus is on *Cancel*; pressing Enter by mistake deletes nothing.

## 2.4.10 — 2026-10-23

- **Machine's group:** in the run window and in the run detail in History, a small label with the name of the machine's group (if it has one) is shown in front of each machine's name.

## 2.4.9 — 2026-10-23

- **Error hints:** in the run window and in History, under a machine that failed, the likely cause of the error and what to do are shown (no write permission, disk full, file in use, network dropped, path too long, machine unreachable…); at the top of the History › Errors tab, the causes with their counts.
- **HTML report:** in History, a run is saved as a single page with its machines, errors and likely causes (to share or print).
- **Log search:** search in the log and in the errors, in the run window and in History.
- **Run note:** a note can be added to a run in History; it shows under the title and in the list, and search finds it.
- **Filter preview:** Send › Filters › **What do they leave out?** walks the sources with the current filters and shows every file and folder that is left out, with the pattern that excludes it.
- **Status filter on Targets:** the Targets page can show only the machines that are unreachable, busy, whose last send failed, turned off, or not running SamSync.
- **Source still being written:** the review warns when one of the files to send changed in the last 10 seconds.
- **Notify when a send starts too:** Settings › Notifications › *Notify when a send starts too* (default off): what is sent, to which machines and by whom also goes to the channel when a send starts.
- **Bandwidth limit hours:** Settings › Copy › *Bandwidth limit hours* (for example 08:00-18:00; empty = always): the limit applies only to sends that start in these hours.
- **Cancels stay off the channel:** a cancelled send is not reported to Telegram or the webhook; the run window and History still show it.
- **Security (web interface):** signing in as viewer can no longer read file contents, cancel other people's jobs or see the keys of the notification channel. Options can no longer be passed to git through Git revision names. Password attempts that arrive at the same time are counted too and do not slow the app down. The main password cannot be the same as the viewer password.
- **Fix (data loss):** mirror mode and sync, when deleting an extra folder, also deleted the files the filter leaves out. Now the contents of the folder go one by one, and the folder is removed only when it is empty.
- **Fix (data loss):** two-way sync deleted everything on the left side when the right side was not found (an ejected disk); now that pair does not run. Under a folder that cannot be read, neither sync nor send does anything.
- **Fix (data loss):** on a machine that takes no backup, **Restore** deleted the files the send had updated; now only the files the send added are removed. When several sends are restored, old backups are not pruned; if a folder took the place of a file, the file comes back.
- **Fix:** a manifest on the target that was written with another filter is not trusted; a manifest that gets stale after a restore, a sync or an interrupted send is deleted.
- **Fix:** an interrupted large file is not resumed on top of the old part if the source changed in the meantime.
- **Fix (automation):** with *Run missed schedules at start* off, timed schedules did not run at all; with it on, a time missed while the app was closed was not caught up either. A broken folder watch is set up again every half minute; a file that keeps changing no longer postpones a send forever; a cancelled *Send later* does not run; the same scheduled job does not run twice; a shorter git history does not resend old commits.
- **Fix:** when the machines behind a relay ended with errors, both the sender and the relay retried. The app could crash when a source file disappeared while a pack was being uploaded. A long pause made the relay job time out.
- **Fix:** CSV import treated the columns that are not in the file as empty; letters were garbled in files that Excel saved in Turkish. A removed tag, MAC or relay mark no longer comes back from the configuration file.
- **Fix:** in a short window (in the web interface too), the empty Sources card on the Send page cut off the **Select file** and **Select folder** buttons and the path box. The card now squeezes to the height it has: first the big icon goes, then the description line, and the buttons always stay visible.

## 2.4.8 — 2026-10-22

- **Targets in the notification:** in the message that goes to the team channel (Telegram, webhook) when a send ends, it says where the machines went. If it went to the whole group, the group name and the count (`Lab-A (4)`); if it went to part of it, the group name and those machines (`Lab-B: PC-1, PC-2`); machines with no group one by one. The webhook's JSON also has the group of each machine.

## 2.4.7 — 2026-10-22

- **Machines with no busy information:** on a machine where SamSync does not run, nothing reports whether it is busy; its dot stays green, but hovering over the dot on the card, in the target picker and in the network view says *No busy information: SamSync is not running on this machine*. It adds no load to the network.
- **Fix:** on a send to a machine that runs SamSync (a relay or an agent), **Pause** and **Cancel** did nothing while the pack was being written; on a slow link most of the time goes into this step, so the buttons looked broken. Now cancel stops the upload at once (no half pack is left on the target), and pause holds the upload. Once the job has passed to the machine, both go on to SamSync there: for a relay group it stops the distribution and reports what it had done by then (that machine needs this version too). After you press cancel, the button stays as *Cancelling…* and a line goes into the log.

## 2.4.6 — 2026-10-22

- **Retry failed machines:** Settings › Copy › *Retry failed machines (min)* (default 0 = off) and *Most retries* (default 3). Machines where a send failed or ended in part get it again by themselves after that many minutes; each try waits on the Automation page under the name "(retry 1/3)" and can be cancelled.
- **Last seen:** the card of an unreachable machine and the target picker show when it last answered (*last seen 3 hours ago*); the information is kept across restarts.
- **Bulk actions:** on the Targets page, **Select** ticks cards or a whole group. The bar at the bottom then wakes, restarts or shuts down the selected machines together (the ones that allow it), updates their agents, turns them on or off, adds or removes a tag, or moves them to another group.
- **Machine list as CSV:** Targets › Configuration has **Export as CSV…** and **Import from CSV…**. The import shows the new and changed machines before saving; machines that are not in the file stay as they are.
- **Weekly summary:** Settings › Notifications › *Weekly summary* (default off). Every Monday at 09:00 (at the first start after it, if the computer is off) the team channel gets the last seven days' sends, the amount of data, the machines that failed most, the ones that are unreachable now and the machines with drift; **Send the summary now** sends it at once.
- **Free space limit:** Settings › Copy › *Free space limit (GB)* (default 2, 0 = off). A target below it shows red; the review warns when less than that would be left after the send.
- **Fix:** in the "New in this version" window and in Help, *italic* text showed with its asterisks.

## 2.4.5 — 2026-10-22

- **Busy machines:** once a minute, a machine that runs SamSync looks for programs running from inside the target folder (and the ones in the list in Settings › Agent). If there are any, the machine's dot turns amber with a **busy** badge next to it: on the card, in the target picker, in the network view and in the review. Hovering lists the programs, and a click lists the files they hold open in the target folder. A machine can hold the send until the program closes with *Hold sends while busy* (default off).
- **Send later:** in the review, **Send later…** sets the send for a date and time; if you want, machines that are off are woken five minutes before. At that time the sources are compared again. The waiting sends are on the Automation page and can be cancelled.
- **Send order:** Settings › Copy › *Sends to the same machines go one after the other* (default off): a send to machines that another send is writing to waits for that one to finish.
- **Tags:** machines can get several tags, apart from groups; the *Select* menu of the target picker picks by tag, and `tag:<name>` does the same in profiles and on the command line.
- **Remote restart and shut down:** from the menu on the card of a machine that allows it (Settings › Agent, default off) or with the *After the send* option; the machine shows a one-minute warning, and it can be cancelled.
- **Distribute from here:** from the card of a machine that runs SamSync, the folders on that machine are sent to the other machines over its network; nothing passes through this computer's link.
- **Machine history:** the history button on the card lists every run that reached that machine, day by day, with the result, release point and check; a row opens in History.

## 2.4.4 — 2026-10-21

- **Staged send:** in the review, **Staged send** sends to the selected machines first; if they finish without problems (and their health check, if any, says yes), the others follow by themselves or once you confirm with **Send to the others** in the run window. If one of the first machines failed, the send stops; **Send to the others anyway** or **Cancel**. Each stage is a separate run in History.
- **Health check:** how the agent's "Command after applying" and this computer's "Post-copy command" ended (exit code and last lines) shows as a **check** badge on the machine's row in the run window and in History. If you want, a failing command counts the machine as failed: one switch each in Settings › Agent and Settings › Copy (default off).
- **Relay takeover:** Settings › Copy › *When a relay is off, another machine of the group becomes the relay* (default off). On a send to a group whose relay does not run SamSync, the first machine in the group that runs SamSync becomes the relay for that send; the files still cross the slow link once.
- **Stage, then switch at once:** a send option. The files are first written on the target under a temporary name; when all of them have arrived and none is in use, they are put in place at once, so a program never sees a half version. If a file does not arrive, the live folder is not touched at all.
- **Live drift:** Settings › Agent › *Watch the sent folders (live drift)* (default off). A manual change in the sent folders shows on the machine card as **drift n** within a few seconds; SamSync's own sends do not count.
- **Release diff:** **Show diff…** on a release point in History: the files added, changed and deleted on the machines from that point up to another release point or the latest send; it can be saved as a CSV or HTML report.
- **Files with machine variables:** Settings › Copy › *Files with machine variables* (for example `*.ini`, default empty = off). In the UTF-8 text files that match, `{{machine.id}}`, `{{machine.name}}`, `{{machine.title}}`, `{{machine.address}}` and `{{machine.group}}` are filled in for each machine; one file serves all the machines.
- **Fix:** files in the machine folder were not reaching machines that get their sends through a relay; the relay now keeps these files, the common files it holds in its own version and the raw form of the variable files on the side, and sends each machine its own.
- **Fix:** a send from a `.samsync-pack` file to a machine that runs SamSync failed because the files in the pack could not be put into the agent's pack.

## 2.4.3 — 2026-10-21

- **Agent status on the card:** the heartbeat now also carries the SamSync version, the folder the share points to, the last job and the last error. The machine card shows **agent 2.4.2** (amber with *old* when it is older than this copy), **agent stopped** when SamSync there stopped answering without saying so, and a warning sign for the last error. On the machine itself, the "This machine" card and Settings › Agent warn when the first local root does not exist or when the share points to another folder (on a relay, or where senders already write); **Fix** makes the share's folder the first local root.
- **Updating agents over the network:** on the Targets page, **Update agents (n)** and an arrow on the card: the Windows setup of this version is left on the machine's share, SamSync there checks the file with SHA-512, installs it silently once no job is running and opens again. The setup comes from the copy this computer keeps, from the update folder or from the release page (downloaded once); if none of them is there, a file can be picked. A relay passes it on to the machines of its group over their own network. On the receiving machine, Settings › Agent › *Accept updates over the network* is needed (default off).
- **Programs holding files:** when a send ends with files in use, the run window shows, for each machine, which programs hold the files, with process ids and files (directly on this machine, through SamSync there on the others). **Close and retry** closes them and writes the files again; on another machine, Settings › Agent › *Let senders close the program holding a file* is needed there (default off). System programs and Explorer are not closed.
- **Files for one machine:** Settings › Copy › *Machine folder* (for example `_machines`, default empty = off). In this folder at the top of a sent folder, subfolders named by machine id, name, address or group name go only to those machines, on top of the common files; the folder itself is not sent. The review marks these files *for this machine only*, mirror mode does not delete them, and a pack carries the folder as it is.
- **Drift check:** **Check drift** in the Machine inventory: on each machine, the files changed, added and deleted since the last send, against the machine's manifest. A machine that runs SamSync looks at its own disk. It can also run by itself every hour, every 6 hours or once a day (default off); it reports what it finds on the desktop and to the team channel.
- **Wake-on-LAN:** **Wake** on the card of a machine that is off, **Wake the ones that are off** on a group. The MAC address is learned by itself while the machine is on (from SamSync's heartbeat or from the ARP table) or is typed into the machine editor.
- **Undo a machine on failure:** in the send options (default off). If a send breaks off on a machine, that machine goes back from its backup to its state before the send; the backup is turned on for this by itself, and the undo is a separate run in History.
- **Fix:** on machines that apply the pack themselves, **Restore** in History deleted the files the send had changed instead of bringing them back from the backup; the agent now reports which files it backed up, and restoring works correctly.

## 2.4.2 — 2026-10-21

- **Options for one list:** on the options card of the Send page: **General / This list only**. With This list only, the options stay in that tab (a small icon on the tab) and are saved with the list when it is saved as a quick send; the general options do not change. **Reset to the general options** and **Reset to the defaults** buttons. A quick send or a profile opened from the command line no longer changes the general options; it opens in its own tab with its own options.
- **Paths and hints:** on a machine card, hovering over the name shows the name, address, id and group (a cut-off id too); clicking the path opens it in Explorer, and a right click offers "Show in Explorer" and "Copy path". The paths on the Automation cards work the same way; hovering over a target row lists all the machines one under another.
- **Notifications once:** what a relay or an agent does for a send (applying the pack, passing it on to the group) is no longer reported to the team channel on its own; when the whole send has finished, the sending side reports once, with every machine. A delivery that the relay makes later from its queue is still reported by the relay.
- **Sender:** the Telegram and webhook message shows the sender's account the way `whoami` writes it (`DOMAIN\user`, with the machine name if it is not a local account); the webhook's JSON has a `user` field.

## 2.4.1 — 2026-10-21

- **The Compare page uses the hashes on the target too:** in a comparison by content, the Compare page, `--check-only`, machine-to-machine comparison and sync jobs also ask the machine that runs SamSync for the hashes of the files; the files are not read over the network. In a machine-to-machine comparison where SamSync runs on one side only, only the other side is read. How many files were hashed there shows on the tab and next to the counters.

## 2.4.0 — 2026-10-21

- **Agent on every machine:** every machine that runs SamSync takes what is sent to it as one compressed pack and applies it itself; before, only relays did. Settings › Agent (on by default): a command before applying (to stop the program that holds the files; if it fails, nothing is touched), a command after applying, a notification when a pack is applied. The machine card and the review show an **agent** badge. The folder (`_SamSyncRelay`) sits in the first local root, is hidden on Windows, is never part of a send, and is deleted when the agent is turned off.
- **Content comparison on the target:** in a comparison by content, the files of a machine that has an agent are not read back over the network; that machine computes the SHA-256 hashes of the files on its own disk and writes them, and here they are compared with the hashes of your own copies. The review shows an "N hashed there" badge. A machine that does not answer is read over the network as before.
- **Block delta:** for files of 8 MB and more that are already on the agent's disk, only the changed 1 MB blocks go; the machine builds the file and does not put it in place before it has checked the hash of the whole file.
- **Send to an unreachable machine once it is back:** Settings › General (off by default). A send to a machine that is off waits on this computer; once the machine is back, the sources go as they are then; if it does not come back within 7 days, the send is dropped. Waiting sends are on the Targets page.
- **HTTPS for the web interface:** Settings › Web interface (off by default). The computer makes its own certificate; its fingerprint is shown for checking, and the session cookie travels only over the encrypted connection.
- **Pack from the command line:** `--pack <folder>` writes a pack without opening a window; `--since <pack|machine>` makes an incremental pack.
- **Files in use:** Settings › General › *Try the files in use once more at the end of a run* (off by default). In the panel of a run that ended with such errors, **Retry the files in use**: only those files, without a review, to the same machines.
- **Machine card:** when the last send was a release point, its name shows in the last-send line.
- **Settings layout:** the cards are arranged in columns that end at about the same height, short cards on top; the gaps that row-by-row alignment left and the overlong page are gone.
- **History, narrow window:** the run's buttons wrap under its title, the list stays above the run, and the page scrolls.
- **Fix:** two writes to the same settings file at the same time (for example a send's remembered targets and a settings change) could make the second one fail with a "file not found" error; the writes now go one after the other.

## 2.3.0 — 2026-10-20

- **Fast comparison:** folders on a network share are now listed with the operating system's folder query; all the files of a folder come at once with size and date, and four folders are asked at the same time. Before, a separate query went out for every file, and a comparison of tens of thousands of files took minutes over Wi-Fi. Excluded folders are still skipped; local folders stay with a plain walk.
- **Pre-copy command:** Settings › Copy. Runs on this computer before the first file goes to each target, takes the same placeholders as the post-copy command; if it ends with a non-zero code, nothing is written to that machine. On the Send page it is turned on or off per send. For stopping a program on the target and restarting it (with the post-copy command).
- **In-use warning:** the review tries beforehand whether the files that will change are held open on the target (the 150 largest files) and warns by name in the machine header; it adds a note on the row too.
- **Scope note:** when sources are nested on the target or go to the same place, the line under the row says what will happen: "without Contents/: another source takes that part", "goes to the same place as X; their contents are merged".
- **Incremental pack:** in the Write pack window, "Since an earlier pack" or "Since what a machine holds". Files that are already there as they are enter the pack as a list only; the review on the receiving machine says which ones are missing or different.
- **Release point:** name a send in History; "Go back to this point…" undoes, from their backups, the sends that went to those machines afterwards, newest first, and skips and names the ones without a backup.
- **File trace:** in History, find by file name which send took the file to which machine, newest first; a click opens the run.
- **Free space:** the free space on the disk of a reachable machine shows on the Targets page and in the target list (red below 2 GB).
- **Viewer password:** a second password in Settings › Web interface; a browser that signs in with it sees everything and can change nothing; the title bar says "read-only". It must differ from the main password.

## 2.2.6 — 2026-10-20

- **Update window:** the downloaded version is now shown in the app's own window instead of the system's plain dialog: a version badge, the release date, the current version, the release notes, and a warning if a send is running (installing restarts the app; the install button is disabled while a send runs). **Later** and **Install now and restart**. The button in the title bar and Settings › Update open the same window.
- **Development:** if the window image taken with `SAMSYNC_SCREENSHOT` cannot be captured on the first try (the compositor has not produced a frame yet on a virtual display), it is tried a few more times, and if it still cannot be taken the app closes anyway; the smoke test reports the missing image instead of waiting.

## 2.2.5 — 2026-10-20

- **File in use, same content:** when a file that a program holds open on the target cannot be replaced, SamSync now compares its content with the source; if it is the same, it only aligns the date and counts the item as done, not as an error. Files copied with a tool that does not keep dates used to fail with a "file in use" error on every send; once the date is aligned, the file is not picked again.
- **Try again:** in the panel of a run that was cancelled or ended with errors, **Try again**: after a cancel the same sources are planned again for all machines (those that already got them are skipped), after an error only for the failed machines; the review opens first.
- **Taskbar progress:** the taskbar button moves while the review is prepared and while it compares too; while the folders on the target are listed, it runs as an indeterminate bar.
- **Sound when done:** a short sound when a send ends: two rising notes if it went through, a low warning if something failed. Settings › General: every time (default), only when something failed, or off; buttons to listen to both sounds. Dry runs and cancels are silent.
- **Notifications:** when a desktop notification cannot be shown (Windows holds it back because of a full-screen program or focus assist), the reason is written to the log.

## 2.2.4 — 2026-10-20

- **Fix:** in the target picker on the Git page, the commands of the **Select** menu (select everything shown, clear the selection, select the reachable ones, profiles…) did not work: clicking the menu counted as a click outside the picker's popup and closed it. The same was true of the right-click menu there. A menu opened from inside a popup no longer counts as outside; a click outside still closes the popup.

## 2.2.3 — 2026-10-19

- **Where each source goes on the targets:** the list of places is now on every source, not only on the ones outside the roots: the path by the local root (default), the places where a folder above counts as the target root, the full path, and a path typed by hand relative to the target root (**Type another path…**, for example `Contents`).
- **Overlapping sources:** the contents of two folders that go to the same place are merged (before, the second was silently skipped); a file that both hold comes from the one listed first, and the review says so. A source that comes from elsewhere and falls inside another source's place takes that part of the targets over: with `Release` going to the root and `Contents` on another disk also going to `Contents`, `Release` does not touch the `Contents` on the target at all, and in mirror mode does not delete there either.
- **Source list:** multi-select with a click, Ctrl and Shift (Ctrl+A for all); enable, disable or remove the selected ones. A disabled source stays in the list but is not sent, compared, written to a pack or watched. Right click: **Show in Explorer**, **Copy path**, enable/disable, **Remove from list**. When the list is full, **Select file**, **Select folder** and a box for pasting a path stay at the bottom. While a big folder is being counted, its row says "Reading"; a newly added source is read without counting the earlier ones again.
- **Right click in the target list:** **Show in Explorer** opens the folder where the send lands on that machine (the share, or this machine's own root); **Copy path** and **Select only this one**.
- **Fix:** the machine rows in the review window did not reach the window; now the listing, the comparison and the content read show, and while the folders on the target are listed the bar runs as an indeterminate bar.

## 2.2.2 — 2026-10-19

- **Review progress:** while the review is prepared, the window shows one row per machine: waiting, checking access, listing the folders on the target, "8,400 of 20,013 files compared • 1.2 GB of content read" or done. The bar on top moves by the files compared instead of the number of machines; before, it stayed empty until every machine was done.
- **Sending to this machine:** when all the sources lie outside this machine's local roots (a release on another disk, say), the sending machine also appears in the target list; before, it did so only for pack files. The files are written straight to the first local root, on its own disk, instead of over the share. The target list shows the local root instead of the share path for this machine, and the review shows the **this machine** badge. When sending from its own root or from a folder that contains that root, this machine is still not in the list.
- **Full path hint:** the target path that is cut off in the target list, the review and the run panel shows in full as a hint on hover.

## 2.2.1 — 2026-10-19

- **Sources outside the roots:** a folder that is not below any local root no longer goes to the target with its full path with the drive letter (`C/…/Release/…`); its own folder stands in for the target root, so what is inside is written straight to the target root. A file goes to the target root by its name. On the Send page another place can be picked from the list under the source: any folder above it can be the target root, or the old full path can be kept. **Make local root** adds the selected folder to this machine's local roots. The choice is kept by the tab, the quick send, the watch and **Resend** in the history; the Compare page and writing a pack use the same place. Settings › Copy › **Send sources outside the roots with their full path** makes the old behaviour the default.
- **Fix:** after an update, the taskbar could show the Electron icon instead of SamSync. Development and test runs used the same Windows app id as the installed app; when Electron created a Start menu shortcut with that id for notifications, Windows tied the installed app to that shortcut. Development runs now use an id of their own.
- **Fix:** the sign-out button in the web interface said "Quit" in the English interface; it now reads **Sign out** (**Oturumu kapat** in Turkish).
- **Docs:** the English README and the project site now describe the interface by its English labels.
- **Licence:** SamSync is now distributed under the **GNU General Public License, version 3 (GPL-3.0)** (copyright © 2026 Samet Kurumahmut). The licence text is at the root of the repository and in every package (`LICENSE`) and is shown on the first page of the Windows installer; Settings › About, the FAQ, the READMEs, the project site and the winget manifest state the licence.
- **Accessibility:** the lists on the History page can be scrolled with the keyboard in a small window; disabled settings rows are announced to screen readers as disabled. The end-to-end test runs the accessibility scan at the app's smallest window size too.

## 2.2.0 — 2026-10-18

- **Web interface (server mode):** when Settings › **Web interface** is turned on, the SamSync window on an always-on computer is served to browsers on the network; nothing needs to be installed on the other machines. Sign-in is by password (only a scrypt hash is stored on this computer), the session is kept by an HttpOnly/SameSite cookie; after five wrong attempts that address waits a minute; API calls need a special header. In the browser, files are picked in a dialog that browses the server's disks; things that touch this computer's desktop (windows, opening a file, installing an update, the server's own settings) cannot be done from a browser. Reachable from the network or this computer only, the port, the number of connected browsers, the list of addresses. The connection is HTTP: use a trusted network, or a reverse proxy that adds TLS.
- **Setup wizard and network scan:** on first start, three steps: this machine (name, address, the folder it sends from, share root), the machines found on the network (the subnets of this computer are tried on file sharing, port 445, and SSH, port 22; the name, on Windows the share list, and the ones already configured are marked), then review and save. **Scan the network** on the Targets page: a machine that is found opens the editor already filled in, with one click.
- **Notification centre:** the bell in the title bar; finished sends (failed ones stay unread), machines that went away or came back, a new version, a watch that stopped, a scheduled job that ended with errors. Grouped by day; a click opens the page concerned (in History, that run); the last 100 events are kept.
- **Pause a run:** in the run panel **Pause / Resume** (waits between files; a copy in flight stops mid-file too) and **drop** on each target's row: the remaining operations of that machine are skipped, the others go on.
- **Conflict resolver:** in a two-way sync, a **Resolve n conflicts…** window: for each conflict the size and date of both sides, the reason and the difference; left, right, **Keep both** or skip; in bulk "Newer wins", "Left wins", "Right wins", "Keep both". Keep both writes each side the other's version as `name (left).ext` / `name (right).ext`, and nothing is deleted; the job does not touch that file until one of the two sides changes.
- **Relay delivery queue:** the relay keeps the job of a machine that is off at send time under `_SamSyncRelay/pending` and delivers it once the machine is back (Settings › Copy: the retry interval and the most days a job is kept). The run panel and the history show a "queued" badge; the relay's card shows the machines in the queue, the number of jobs and the last attempt.
- **Password-protected pack and double click:** **Write pack** can write an AES-256 encrypted pack with an optional password (the content and the index cannot be read; the key is derived with scrypt). On the applying machine the Send list shows a "password-protected" badge and a **Password…** button; a password entered once is remembered until the app closes. `.samsync-pack` files are associated with SamSync by the installer: a double click brings the pack to the Send page.
- **Trust the manifest:** Settings › Copy › **Trust the manifest (days)**; 0 means a full scan on every send. The Send page has an option **Scan targets in full**, and the review has **Full scan** next to a target that came from the manifest.
- **Appearance:** machine names look the same everywhere: the short name on top, the address below in small letters (in the network view the cards grow wide enough to fill the box); the target cards show a latency chart of the last 48 checks (a red line when there was no answer); History has day separators and a Today / 7 days / 30 days filter; empty pages show drawings and examples; skeleton placeholders while a page loads; a **Bot** label in the title bar, and **Restart and update** once an update has been downloaded.
- **Accessibility:** a focus ring everywhere when navigating with the keyboard; animations that follow the "reduce motion" setting; unnamed buttons, checkboxes, switches, select boxes and colour swatches now tell screen readers their names; field labels are tied to their boxes; faded text has a 4.5:1 contrast in both themes. The axe-core scan in the end-to-end test finds no critical or serious violations on the five main pages.
- **Languages:** German and Spanish added (Settings › Appearance › Language; "Match system" follows the computer's language). The help content is shown in English in these languages.
- **Fix:** on the Targets page the suggested share root of a new target read `ShareRelease` instead of `Share\Release`.
- **Development and distribution:** ESLint (error and accessibility rules) and an end-to-end test with Playwright (`npm run e2e`: send, compare, restore, axe-core) in CI; releases get a `SHA256SUMS.txt`; `npm run winget` produces the winget manifest of a published installer; `npm run site` builds the project site from the READMEs, the FAQ and the screenshots (a GitHub Pages workflow, turned on with a repository variable).

## 2.1.1 — 2026-10-17

- **Fix:** the data folder (`SAMSYNC_USER_DATA`, `SamSync-data` next to the portable version) is chosen before the single-instance lock; before, a portable copy or a screenshot/smoke test run started while the installed app was open took itself for a second instance and closed without opening a window.
- **Generic names:** the FAQ, the help bot, placeholders, docs and the demo no longer carry any name specific to an organisation; examples are written with generic names such as `Lab-A`, `PC-1`, `NAS`, `ShareRelease`; the screenshots are renewed.
- **Fix:** the help bot and run panel drawers start below the title bar; on Windows the window's minimize/maximize/close buttons covered the drawers' own buttons.

## 2.1.0 — 2026-10-17

- **Help bot and FAQ:** the bot button in the title bar or **F1** opens a chat drawer; it answers questions such as "how do I send", "what is a relay", "I will carry the release on a USB stick", shows the FAQ entry or README section the answer came from and opens the page concerned. It works offline: a search with Turkish/English word-stem matching and a synonym dictionary over a bilingual FAQ of 40 entries and the README that comes with the app. If a Claude API key is entered in Settings › **Help bot** (stored encrypted on this machine), free-form questions go to Claude together with the documents; with no key, or on an error, the offline answer is shown. New **Help** page: a search box, the FAQ by topic, the matching sections of the README. *Ask the help bot…* in the command palette.
- **Overview page (Ctrl 1):** the app now opens on this page. Tiles on top: machines (reachable/total, the names of the unreachable ones), data moved today with a small 14-day chart, the failed sends of the last 7 days, automation (the number of watches and scheduled jobs, and whether it is paused), inventory (behind/missing), and the relay and an update when there is one. Below: the recent sends, quick sends, watches and scheduled jobs.
- **Network view:** in the overview, this computer is on the left and the groups are boxes on the right; the line to each group is coloured by reachability (all green, some yellow, none red dashed), the relay is marked and has dashed lines to the machines it distributes to. A click on a machine makes it a send target or removes it; dragging a machine into another group's box changes its group (it asks first and writes the change to the configuration).
- **Pack file (.samsync-pack):** on the Send page, **Write pack** writes the sources into one compressed file instead of to machines (the send's exclusions and `.samsyncignore` apply; it is the relay's pack format plus an index). For a release carried on a disk: once the file is added to SamSync's Send list on the target machine, it becomes a source like a folder: the plan compares its contents with the target, writes only what differs, deletes mirror extras, and a manifest stays when it is done; the next send over the network starts fast again. When all the sources are packs, **this machine** can also be picked as a target (it writes straight to its own disk and does not count as a relay). A "pack" badge on the source row: label, file count, size, from whom, when.
- **Machine inventory:** a table on the Targets page: rows are the sent folders, columns are machines, and a cell shows the label, time and size of the version on that machine (from the manifest). The newest state of a folder is the reference: older ones are "behind" (yellow, clock icon), ones that were never sent are "missing", and an unreachable machine has a red header. It refreshes itself after every run; there is a **Refresh** button. The Inventory tile in the overview is fed from here too.
- **Resuming a big file that broke off:** files of 8 MB and more are written to a fixed-name temporary file on the target; a file left half-done by a cancel, a dropped link or a closed app continues from the byte where it stopped on the next send (first the last 256 KB of the part on the target are compared with the source; if it does not match, it starts again). The log says "continuing from where it stopped (412 MB / 1.2 GB)". **Cancel no longer waits for the file to finish:** the stream is cut at once and the part stays. Parts older than 14 days are deleted.
- **Run panel:** a speed chart of the last 60 seconds (now, peak, average; "waiting" if it was zero for 5 s), "Lab-A 3/5" chips for groups. The icon on the Windows taskbar fills with the send's progress; a send that finishes while the window is not in focus makes the icon blink.
- **History:** a statistics strip on top: the sends of the last 30 days, the data moved and the average pace, the number and percentage of failures, a bar chart day by day (a failed day is red; a click on a bar filters the list to that day), the machines that received the most data. **Restore** button: for a send made with backups, it brings the files that send changed and deleted back from its backups and deletes the files it added (the current versions are backed up too); it does not show for a send without backups.
- **Compare: machine ↔ machine.** Instead of a source, two machines (A, B) and a folder are picked: the files only one of them has, the files that differ, which one is newer; a click on a file shows the line diff of its two versions. It catches drift between machines that should be identical (A ↔ B); nothing is written.
- **Scheduled quick send:** a saved send goes by itself at set times or every n minutes (on this machine, without opening a review; if nothing changed, it does nothing). The pencil on the chip edits the name, shortcut and schedule; it is listed among the scheduled jobs on the Automation page with a "quick send" badge, with **Run now**.
- **Notifications (Settings):** when a send ends, JSON to a webhook (status, label, machines, operation and byte counts, duration, summary text) and/or a message to a chat through a Telegram bot; always for failed or partial endings, optional for successful ones; the failed machines are listed with their reasons; a **Test** button. Dry runs are not reported.
- **Error screen:** if the interface crashes, instead of a blank window it shows the text of the error with **Reload**, **Create diagnostics folder** and **Copy error** buttons; uncaught errors become a warning toast and a log line (they go into the diagnostics folder). The diagnostics folder now also holds that session's log lines.
- **Window and scale:** the window's size, position and maximized state come back on the next start (if the screen is not connected, it opens in the centre). **UI scale** 70–175%: Ctrl + / Ctrl − / Ctrl 0 or Settings › Appearance; the title bar buttons scale too.
- **Shortcuts:** Ctrl / lists all shortcuts; Ctrl , Settings; Ctrl Enter opens the review on the Send page and sends in the review (with Shift, a dry run); Ctrl 1…9 the pages (Overview is 1). The hints in the command palette follow the page order.
- **The "New in this version" card:** on the first start after an update, the CHANGELOG section of that version is shown once (the file comes with the app); it opens again from Settings › About and the command palette.
- **Speed:** the content comparison remembers hashes (location, path, size, time) in `hashcache.json`; a send compared by content also takes the hash while it copies big files, so the next comparison by content does not read that file over the network. Pages other than the Overview are loaded when first opened (first bundle 1.34 MB → 1.12 MB). The run log streams to `history/<id>.log` at once; the last 2000 lines stay in memory, and the history detail reads from the file (up to 50 thousand lines).
- **Release workflow:** the packaged app is opened once on every platform and a picture of its window is taken; a blank window (a broken package) stops the release, and the image is kept as an artifact. Locally: `npm run smoke`. `scripts/bench-smb-compress.ps1` measures the copy speed to a share with robocopy with and without /COMPRESS (not measured yet, as there is no access to remote machines).

## 2.0.3 — 2026-10-17

- **Fast comparison with a manifest:** after every send, `samsync-manifest.json` stays at the root of the target (everything below the sent folder: name, size, date; who wrote it and when). The next send starts from the manifest instead of walking the target folder by folder over the network — first the root's listing and 24 sample files are compared with the target; if even one does not match (for example, the release was copied from a disk), the old full scan runs. A manifest older than 7 days is not used. The review shows a "from manifest" badge; the Compare page always looks directly. When the pack sent to a relay is applied, the relay writes the manifest from its own disk.
- **Two people on one machine:** while a send runs, `samsync-lock.json` sits at the root of the target (computer name, user, name of the send, start time, version). If someone else holds a fresh lock, the review shows an "ahmet is writing" badge with an explanation on the machine card, and a warning goes into the run log; the send still goes ahead. A lock older than 30 minutes is ignored; the lock is removed when the send ends. This file and `samsync-manifest.json` are never sent, never compared and never deleted in a mirror.
- **Review: folder tree.** The send plan now shows folder by folder: each folder row carries the counts of its branch (+new ~changed !newer on target −to delete), the number of operations and the size; chains of single-child folders show on one row ("Models/Vehicle"); the first level opens by itself, and there are Unfold all / Fold all buttons; a folder's checkbox selects or deselects the whole branch; while you search, the matches are always visible. The Flat list is still there, and the switch between the two is remembered.

## 2.0.2 — 2026-10-17

- **Compressed pack:** files are no longer copied one by one to a machine marked as relay (one running SamSync); the changes of the send are written as a single compressed pack (`_SamSyncRelay\jobs\<id>.pack`, gzip per file; files that are already compressed, such as zip/png/mp4, go in as they are), SamSync there applies the pack to its own disk (backup, in-use file check and verification work the same), and then passes it on to the machines of its group. One stream instead of several round trips per file over the network; a DLL shrinks to ~40% and a PDB to ~23% of its size. A relay with nobody in its group takes the pack for itself too. The run log shows "Pack: 6.5 MB → 2.6 MB (40%)". If the machine does not answer, the pack is taken back and everything, the relay included, is sent directly.
- **Relay heartbeat:** SamSync on the relay writes `_SamSyncRelay\alive.json` to the share every half minute. On the Targets page the badge says "relay on / relay off"; if the heartbeat is stale or missing, the plan writes to that machine and the ones behind it directly, without waiting 60 s.
- **Quick sends:** save the list on the Send page (sources, targets, options) under a name; then send with one click — from the strip on the Send page, from **Quick send** in the tray menu, from the command palette, with `SamSync.exe --quick "name"` (a shortcut or Task Scheduler), or with a system-wide **shortcut key** (e.g. Ctrl+Alt+1; it also works while the app sits in the tray). If "Review first" is on, the review opens. This is specific to this machine (settings.json).
- **Settings:** a **Release notes** button in the Updates section (the release page on GitHub); **Create a diagnostics folder…** in the About section — the logs, the configuration, the settings and a summary (machine, access, relay, last runs) are copied into one folder, without passwords.
- **README:** `npm run screenshots` takes the screenshots from the demo itself, in both languages; the Targets page is added to the gallery.
- **Stay awake:** the computer does not go to sleep while a send runs (the screen may turn off); a PDB send that takes minutes over Wi‑Fi no longer breaks off halfway.
- **Speed test:** with the gauge on the machine card, 3 MB of random data is written, read back and removed; the write/read speed and latency show on the card and in the log ("↑0.5 ↓2.1 MB/s • 180 ms").
- **Relay status:** on a machine that is a relay, the "This machine" card shows the relay's state: the group, the number of jobs taken, the time and result of the last job.
- **Targets:** each machine card shows the speed, duration and time of the last send ("last send: 1.5 MB/s • 12 s • 3 minutes ago"); a slow machine is clear at a glance.
- **Plan:** a machine the window saw as reachable in the last 60 s is not checked for access again while planning (one round trip less per send).

## 2.0.1 — 2026-10-16

- **Relay (distribution through one machine):** when a machine is marked as **relay** on the Targets page, the files for the group machines selected together with it go only to it first (a single copy over your own, often slow, link); SamSync there picks the job up from the `_SamSyncRelay` folder on the share, passes the files on from its own disk over the group's network and writes the result. The review, the run panel and the history show each machine with a "via X" badge and the result that came back from the relay. If the relay does not pick up the job within 60 s (when SamSync does not run there), a separate direct send to those machines starts from here. A group machine selected on its own does not go through the relay; the Compare page and `--check-only` look at every machine directly. `copy.relayAckSeconds` and `copy.relayTimeoutMinutes` set the waits.
- **Speed:** a send makes 3 operations on the target per file instead of 8 (copy, rename; on Windows the modification time comes with the copy); folders are queried once; the free space query runs at the same time as the comparison. Default concurrency: 16 files, 8 targets (at most 64 / 32); the Node file thread pool is 32. The quiet period of new watches is 0.8 s (at least 0.2 s).
- **Right-click menu:** the menu now starts a small program called **SamSyncSend.exe**; it hands the command to the running app through a pipe in a few milliseconds (before, every click opened a second Electron process, ~1 s). If the app is not running, it starts SamSync.exe. It comes with the installer and the zip; the single-file portable version keeps starting itself. A second SamSync.exe now also exits without loading the heavy modules.
- **Reachability check:** the regular check made while the window is open now looks at the share itself on Windows too: a machine that answers on port 445 but does not offer the share shows as "unreachable", and the SMB session stays open, so the next send does not lose time setting up a session.
- **Run panel:** during a send it shows the speed (MB/s) and the time left; next to each target its own speed, and its average when it finishes. The log gets the size, duration and speed per target.
- **File in use:** if a file of 1 MB or more is going to be replaced on the target, the file there is first opened for writing as a test; if a program holds it (e.g. a loaded DLL), the error "the file is in use… or there is no write permission" is given without moving the file over the network at all and without retrying. The same clear message is given on rename too (instead of a raw EPERM).
- **Automation:** a **Send now** button on the watch cards. It sends what differs from the target in the watched paths without waiting, also while the watch is off; on a watch that runs a sync job, it runs the job. Only differences go, nothing is deleted on the target.

## 2.0.0 — SamSync

A cross-platform desktop app written from scratch to replace the old PowerShell tool (1.x) (Electron + React + TypeScript). The old tool's menus, one-click sending and wizard features are included too.

- **Send** — drag and drop, picking files/folders or pasting a path. The grouped target picker has search, reachability dots, profiles and "failed in the last run".
  - **Plan:** before sending, a file-by-file plan is made for each target: new / will be updated / newer on target / extra.
  - **Review:** per-row inclusion, the source–target line diff, applying the selection to all targets.
  - **Modes:** Overwrite, Newer only, Mirror. As in the old wizard, each target can get its own mode and backup setting.
  - **Comparison:** date+size, content, size.
  - **Tabs:** each tab keeps its own sources and targets; items that come from the right-click menu open in a tab of their own.
- **Compare** — compares the sources on the Send page with the targets without sending anything. For each target, the new / changed / newer on target / extra files are listed with a filter and search, and the line diff of the selected file shows next to it.
- **Git** — local changes (staged, unstaged, untracked) or selected commits (one, several, a range; last commit, last 3, unpushed).
  - The files of the commits are shown in one merged list, with each file's diff next to it.
  - The content is taken from the disk or from the commit; deleted and moved files are removed from the target too.
  - Commit content is compared by the git object hash.
- **Sync** — folder pairs: Two-way (remembers the last state, so it tells deletions and conflicts apart), Mirror, Update, Custom. There are filters, versioning, per-row changes in the operations grid and a remote folder browser.
  - **Ignore file:** the patterns of the `.samsyncignore` at the root of either side or of the sent folder are excluded.
  - **Deletions:** to the versioning folder (limited by count and by days), to the Recycle Bin in local folders, or permanently.
  - **Job file:** a job is exported and imported as `.samsync-job.json`.
  - `--sync <job>` runs it without opening a window (exit code 0 = success).
- **Automation** — live watch and scheduled sync.
  - **Watch:** on a change it sends only what changed, and retries unreachable machines once a minute.
  - **Scheduled sync:** runs at an interval or at set times, on a single machine.
  - All of it can be paused; the app can keep running in the system tray and can start hidden at sign-in.
  - **Git events:** after a commit, amend, merge or pull (optionally rebase, cherry-pick, reset), the changed files are sent; switching branches sends nothing.
  - **Targets:** machines from the configuration, plain folders that need no configuration, or a sync job that runs on every change (live sync).
  - **Settings:** retrying unreachable machines (off by default, the interval is adjustable), notifications, the file limit of a single send, running missed schedules at start.
- **Backups** — finds the backup versions (`_SamSyncYedek`) on the targets and writes them back.
  - Items that come from the Explorer and Notepad++ menus are searched for on all machines.
  - The old tool's backup folders are scanned too. A folder at the target root that starts with `_` and holds only `yyyyMMdd-HHmmss` folders counts as a backup folder and is not deleted in mirror mode.
- **History** — results per target, errors, log, resending.
  - A CSV report is written automatically after every run; the last 300 reports are kept.
  - Machines that are off count as failed too.
- **Explorer menu** — comes with the installer and is on by default. It has the same structure as the old tool's menu:
  - Send to all, Review and send…, Send with last settings, Restore from backup…;
  - profiles, groups and machines;
  - separators between sections;
  - given the limit of 16 entries, this machine's group is expanded first; the behaviour can be changed with `menuShowNodes`.

  The app rebuilds the menu at every start to point at the running program; the uninstaller removes the menu.
- **Notepad++** — a “SamSync” folder in the tab right-click menu, the same commands and shortcuts in the Run menu (`notepadPlusPlusShortcuts`; the default `Ctrl+Alt+W` = Send with last settings).
  - The `shortcuts.xml` signature that Notepad++ 8.9.6.2 requires is written into `config.xml`.
  - Settings changed while Notepad++ is open are written again when Notepad++ closes.
  - Commands longer than 260 characters are skipped with a warning.
- **Command line**
  - `--to` selects the targets: machine, `group:`, `profile:`, `all`, `last`.
  - `--yes` sends at once, without the review.
  - `--restore` opens the Backups page with the items.
  - `--plan-only` and `--check-only` run without opening a window: the plan or the state of the targets is written to standard output. The states are `Ayni` / `Farkli` / `Yok` / `Erisilemedi` / `Hata` (same / different / missing / unreachable / error; the old tool's words, kept so its scripts keep working); exit code 0 means everything is the same.
  - The processes Explorer starts for each item are merged into one send.
- **Profiles** — store the send options together with the targets. The old wizard's profiles and last settings can be brought in with Settings → Configuration file → *Import wizard settings*.
- **Mirror mode** — if there are items to delete on the targets, a separate confirmation with the total count is asked before sending. A one-click send that would delete is not sent directly; the review opens.
- **Writing** — atomic writes (temporary file + rename), optional content verification, retries, parallel targets and files, a bandwidth limit per target, cancel, cleanup of old backups.
- **Post-copy command** — `{source}` is the last item sent, `{destination}` is that item's path on the target.
- **Target types** — SMB share, folder/mounted drive, SFTP.
- **Configuration editor** — the config file is edited as JSON, checked as you type and when you save, and saved exactly as typed; another file can be loaded, and a copy can be exported.
- **Between starts** — the open page, the Send tabs, an unsaved sync job and the Backups entry are kept; leaving the page or closing the app with unsaved settings asks first.
- **Portable versions** — a single-file exe and a zip; settings and history stay in the `SamSync-data` folder next to the program.
- **Old configuration** — the old `config.json` is read as is; the old tool's fields are kept when saving.
  - The machine recognition rules are the same (including the `SAMSYNC_NODE_ID` environment variable and `<name>.<USERDNSDOMAIN>`).
  - Group names are limited to the same characters as the node id.
- **Auto-update** — GitHub Releases, a web address or a network folder. GitHub Actions builds the Windows, macOS and Linux packages; when all three pass, it publishes the release itself.
- **Appearance**
  - Turkish and English interface; by default the computer's language is followed.
  - Dark (default), Light and Match system themes; accent colour; Compact density.
  - Command palette (`Ctrl+K`).
