#!/bin/bash
# ===== ランキングを別ウィンドウで開く（macOS）。2台目のモニターへ移動して ⌃⌘F で全画面 =====
SERVER="http://localhost:3000"
cd "$(dirname "$0")"
open -na "Google Chrome" --args --user-data-dir="$PWD/.browser-ranking" --no-first-run --app="$SERVER/ranking"
