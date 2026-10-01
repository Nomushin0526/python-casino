@echo off
chcp 65001 > nul
rem ===== ゲーム端末をキオスク（全画面）モードで開く =====
rem  PC-A ではそのまま、PC-B では下の SERVER を PC-A のIPアドレスに、TERMINAL を PC-B に書き換える
rem  （PC-A のIPアドレスはサーバー起動時の黒い画面に表示されます）
rem  終了するときは Alt + F4
set SERVER=http://localhost:3000
set TERMINAL=PC-A

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
rem --unsafely-treat-insecure-origin-as-secure : http 接続でもカメラを使えるようにする
start "" %BROWSER% --kiosk --user-data-dir="%~dp0.browser-game" --no-first-run --disable-translate --disable-features=Translate --autoplay-policy=no-user-gesture-required --overscroll-history-navigation=0 --unsafely-treat-insecure-origin-as-secure=%SERVER% "%SERVER%/?terminal=%TERMINAL%"
