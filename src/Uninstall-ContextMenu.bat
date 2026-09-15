@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "POWERSHELL_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"

"%POWERSHELL_EXE%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%Uninstall-ContextMenu.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if "%EXIT_CODE%"=="0" (
    echo Kaldirma basariyla tamamlandi.
) else (
    echo Kaldirma basarisiz oldu. Hata kodu: %EXIT_CODE%
)
pause
exit /b %EXIT_CODE%
