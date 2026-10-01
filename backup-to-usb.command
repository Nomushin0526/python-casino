#!/bin/bash
# ===== DBをUSBメモリにバックアップ（macOS・サーバー起動中でもOK） =====
cd "$(dirname "$0")"
echo "接続中のドライブ:"
ls /Volumes
echo
read -r -p "USBメモリの名前を入力してEnter（例: USB）: " NAME
if [ -z "$NAME" ] || [ ! -d "/Volumes/$NAME" ]; then
  echo "/Volumes/$NAME が見つかりません"; read -r; exit 1
fi
node --disable-warning=ExperimentalWarning scripts/backup.js "/Volumes/$NAME/casino-backup"
read -r -p "Enterで閉じる"
