@echo off
chcp 65001 > nul
rem ===== ランキングを別ウィンドウで開く（2台目のモニターへドラッグして F11 で全画面） =====
set SERVER=http://localhost:3000

set BROWSER=
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set BROWSER="%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set BROWSER="%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set BROWSER="%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set BROWSER="%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER (
  echo [エラー] Chrome / Edge が見つかりません
  pause
  exit /b 1
)
start "" %BROWSER% --user-data-dir="%~dp0.browser-ranking" --no-first-run --app=%SERVER%/ranking
