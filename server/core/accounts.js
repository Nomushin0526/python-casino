// 名前とパスワード（Web Crypto を使うので PC版・Cloudflare版の両方で動く）
const enc = new TextEncoder();
const ITERATIONS = 10000; // Cloudflare の無料枠の処理時間に収まる程度

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

export function randomHex(bytes = 16) {
  const a = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (s) => new Uint8Array(s.match(/../g).map((h) => parseInt(h, 16)));

async function derive(pw, salt, iterations) {
  const key = await globalThis.crypto.subtle.importKey('raw', enc.encode(pw.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  return globalThis.crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}

export async function hashPassword(pw) {
  const salt = unhex(randomHex(16));
  const bits = await derive(pw, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${hex(salt)}$${hex(bits)}`;
}

export async function verifyPassword(pw, stored) {
  if (typeof pw !== 'string' || !stored) return false;
  const [algo, iter, saltHex, hashHex] = stored.split('$');
  if (algo !== 'pbkdf2') return false;
  const bits = hex(await derive(pw, unhex(saltHex), Number(iter)));
  // 長さが同じ文字列の比較（タイミング差をなるべく出さない）
  let diff = bits.length ^ hashHex.length;
  for (let i = 0; i < bits.length; i++) diff |= bits.charCodeAt(i) ^ hashHex.charCodeAt(i % hashHex.length);
  return diff === 0;
}
