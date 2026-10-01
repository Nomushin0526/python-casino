// カードID（P0001）とQRの確認コード（P0001-ABCD）
import crypto from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 紛らわしい I O 0 1 を除外

export function makeId(cfg, n) {
  return cfg.card.idPrefix + String(n).padStart(cfg.card.idDigits, '0');
}

export function checkCode(cfg, id) {
  const mac = crypto.createHmac('sha256', cfg.card.secret).update(id).digest();
  let out = '';
  for (let i = 0; i < 4; i++) out += ALPHABET[mac[i] % ALPHABET.length];
  return out;
}

export function cardCode(cfg, id) {
  return `${id}-${checkCode(cfg, id)}`;
}

// 読み取った文字列からIDを取り出す。admin=true ならチェックコード省略・数字だけも許可
export function parseCode(cfg, raw, { admin = false } = {}) {
  if (typeof raw !== 'string') return null;
  let s = raw.normalize('NFKC').toUpperCase().replace(/\s+/g, '');
  // URL形式で埋め込まれていても末尾だけ使う
  const m = s.match(/([A-Z]*)(\d+)(?:[-_]?([A-Z0-9]{4}))?$/);
  if (!m) return null;
  const [, prefix, digits, check] = m;
  if (prefix && prefix !== cfg.card.idPrefix.toUpperCase()) return null;
  if (!prefix && !admin) return null;
  const n = Number(digits);
  if (!Number.isInteger(n) || n <= 0 || digits.length > cfg.card.idDigits + 2) return null;
  const id = makeId(cfg, n);
  if (check) {
    if (check !== checkCode(cfg, id)) return null;
  } else if (cfg.card.requireCheckCode && !admin) {
    return null;
  }
  return id;
}
