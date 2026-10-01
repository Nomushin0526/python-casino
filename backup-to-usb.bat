@echo off
chcp 65001 > nul
rem ===== DBをUSBメモリにバックアップ（サーバー起動中でもOK） =====
cd /d "%~dp0"
set /p DRIVE=USBメモリのドライブ文字を入力してEnter（例: E）:
if "%DRIVE%"=="" exit /b 1
node --disable-warning=ExperimentalWarning scripts\backup.js %DRIVE%:\casino-backup
pause
