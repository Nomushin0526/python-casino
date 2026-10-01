#!/bin/bash
# ===== ゲーム端末を Chrome の全画面（キオスク）モードで開く（macOS） =====
#  2台目の Mac では SERVER を1台目のアドレスに、TERMINAL を PC-B に書き換える
#  （1台目のアドレスはサーバー起動時のターミナルに表示されます）
#  終了するときは ⌘Q
SERVER="http://localhost:3000"
TERMINAL="PC-A"

cd "$(dirname "$0")"
if [ ! -d "/Applications/Google Chrome.app" ]; then
  echo "[エラー] Google Chrome が見つかりません。https://www.google.com/chrome/ からインストールしてください"
  read -r; exit 1
fi
# --unsafely-treat-insecure-origin-as-secure : http 接続でもカメラを使えるようにする
open -na "Google Chrome" --args \
  --user-data-dir="$PWD/.browser-game" \
  --no-first-run --kiosk \
  --autoplay-policy=no-user-gesture-required \
  --overscroll-history-navigation=0 \
  --unsafely-treat-insecure-origin-as-secure="$SERVER" \
  "$SERVER/?terminal=$TERMINAL"
