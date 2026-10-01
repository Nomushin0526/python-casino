#!/bin/bash
# 学祭カジノ サーバー起動（macOS ではダブルクリック、Linux では ./start-server.command）
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "[エラー] Node.js が見つかりません"; read -r; exit 1
fi
if [ ! -d node_modules/express ]; then
  echo "初回セットアップ中です（インターネット接続が必要）..."
  npm install --omit=dev || { read -r; exit 1; }
fi
while true; do
  node --disable-warning=ExperimentalWarning server/index.js
  echo "サーバーが停止しました。5秒後に再起動します（Ctrl+C で終了）"
  sleep 5
done
