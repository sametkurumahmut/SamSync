; electron-builder includes this file in the NSIS installer (directories.buildResources/installer.nsh).

!macro customUnInstall
  ; An update runs the old uninstaller too; keep the menus then, the new version rewrites them on start.
  ${ifNot} ${isUpdated}
    ; the app knows where the Notepad++ entries are; the registry key goes even if that fails
    ExecWait '"$INSTDIR\SamSync.exe" --remove-integrations'
    DeleteRegKey HKCU "Software\Classes\AllFilesystemObjects\shell\SamSync"
  ${endIf}
!macroend
