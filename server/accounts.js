// ユーザーネーム＋パスワードのアカウント
import crypto from 'node:crypto';

// 同じ名前かどうかの判定用キー（全角/半角・大文字/小文字・空白の違いは同じ名前とみなす）
export function nameKey(name) {
  return String(name).normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

export function validatePassword(cfg, raw) {
  const pw = typeof raw === 'string' ? raw.normalize('NFKC') : '';
  const { minLength, maxLength } = cfg.account;
  if (pw.length < minLength) return { ok: false, error: `パスワードは${minLength}文字以上にしてね` };
  if (pw.length > maxLength) return { ok: false, error: `パスワードは${maxLength}文字以内にしてね` };
  if (!/^[\x21-\x7e]+$/.test(pw)) return { ok: false, error: 'パスワードは半角の英数字・記号で入力してね' };
  return { ok: true, password: pw };
}

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw.normalize('NFKC'), salt, 32);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(pw, stored) {
  if (typeof pw !== 'string' || !stored) return false;
  const [algo, saltHex, hashHex] = stored.split('$');
  if (algo !== 'scrypt') return false;
  const hash = crypto.scryptSync(pw.normalize('NFKC'), Buffer.from(saltHex, 'hex'), 32);
  const expected = Buffer.from(hashHex, 'hex');
  return hash.length === expected.length && crypto.timingSafeEqual(hash, expected);
}

// ログイン失敗が続いたら少し待たせる（総当たり対策）
export class LoginGuard {
  constructor({ maxFailures = 5, lockMs = 60_000, now = () => Date.now() } = {}) {
    this.max = maxFailures;
    this.lockMs = lockMs;
    this.now = now;
    this.map = new Map(); // key -> { count, until }
  }

  blockedFor(key) {
    const e = this.map.get(key);
    if (!e || !e.until) return 0;
    const left = e.until - this.now();
    if (left <= 0) { this.map.delete(key); return 0; }
    return Math.ceil(left / 1000);
  }

  fail(key) {
    const e = this.map.get(key) || { count: 0, until: 0 };
    e.count++;
    if (e.count >= this.max) { e.until = this.now() + this.lockMs; e.count = 0; }
    this.map.set(key, e);
  }

  success(key) {
    this.map.delete(key);
  }
}
