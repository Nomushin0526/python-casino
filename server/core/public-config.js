// フロントに渡してよい設定だけを抜き出す（パスワード等は除外）

// "_" で始まるキー（コメント）を取り除く
function stripComments(v) {
  if (Array.isArray(v)) return v.map(stripComments);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).filter(([k]) => !k.startsWith('_')).map(([k, x]) => [k, stripComments(x)]));
  }
  return v;
}

export function publicConfig(cfg) {
  const games = {};
  for (const [id, g] of Object.entries(cfg.games)) if (g.enabled) games[id] = g;
  return stripComments({
    chips: cfg.chips,
    session: cfg.session,
    nickname: cfg.nickname,
    ranking: cfg.ranking,
    account: cfg.account,
    games,
  });
}

// 設定の深いマージ（PC版の config.local.json、Cloudflare版の環境変数で使う）
export function deepMerge(base, over) {
  if (Array.isArray(over) || typeof over !== 'object' || over === null) return over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = k in out && typeof out[k] === 'object' && !Array.isArray(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out;
}
