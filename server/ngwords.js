// ニックネームの簡易NGワードフィルタ
function toHiragana(s) {
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

export function normalizeForCheck(s) {
  return toHiragana(s.normalize('NFKC').toLowerCase())
    .replace(/[ー\-_~〜・.,!?！？\s'"`*＊/\\|]/g, '')
    .replace(/[0０]/g, 'o');
}

export function validateNickname(cfg, raw) {
  if (typeof raw !== 'string') return { ok: false, error: 'ニックネームを入力してね' };
  const nickname = raw.normalize('NFKC').replace(/[\u0000-\u001f\u007f<>&]/g, '').trim();
  if (!nickname) return { ok: false, error: 'ニックネームを入力してね' };
  if ([...nickname].length > cfg.nickname.maxLength) {
    return { ok: false, error: `${cfg.nickname.maxLength}文字以内にしてね` };
  }
  const norm = normalizeForCheck(nickname);
  const plain = toHiragana(nickname.normalize('NFKC').toLowerCase());
  for (const w of cfg.ngWords || []) {
    const nw = normalizeForCheck(w);
    if (nw && (norm.includes(nw) || plain.includes(toHiragana(w.toLowerCase())))) {
      return { ok: false, error: 'そのニックネームは使えません。別の名前にしてね' };
    }
  }
  return { ok: true, nickname };
}
