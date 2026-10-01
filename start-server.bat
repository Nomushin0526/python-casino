@echo off
chcp 65001 > nul
rem ===== 学祭カジノ サーバー起動（PC-A でダブルクリック） =====
cd /d "%~dp0"
title IT-CASINO SERVER
where node > nul 2> nul
if errorlevel 1 (
  echo [エラー] Node.js が見つかりません。README の「準備」を見て Node.js をインストールしてください。
  pause
  exit /b 1
)
if not exist "node_modules\express" (
  echo 初回セットアップ中です（インターネット接続が必要）...
  call npm install --omit=dev
  if errorlevel 1 (
    echo [エラー] npm install に失敗しました。
    pause
    exit /b 1
  )
)
:loop
node --disable-warning=ExperimentalWarning server\index.js
echo.
echo サーバーが停止しました。5秒後に自動で再起動します（終了するにはこのウィンドウを閉じる）
timeout /t 5
goto loop
