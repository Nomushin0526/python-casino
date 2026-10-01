// サーバーAPI呼び出し
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function request(method, url, body, headers = {}) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'サーバーに接続できません。スタッフを呼んでください');
  }
  let data = null;
  try { data = await res.json(); } catch { /* 空 */ }
  if (!res.ok) throw new ApiError(res.status, data?.error || 'HTTP', data?.message || `エラー (${res.status})`);
  return data;
}

// 端末ID（ブラウザごとに固定。URL ?terminal=PC-B で名前を指定可能）
export function terminalId() {
  const fromUrl = new URLSearchParams(location.search).get('terminal');
  if (fromUrl) return fromUrl;
  let id = null;
  try { id = localStorage.getItem('casino.terminalId'); } catch { /* ignore */ }
  if (!id) {
    id = 'T-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    try { localStorage.setItem('casino.terminalId', id); } catch { /* ignore */ }
  }
  return id;
}

export const api = {
  session: null, // { playerId, token }
  config: () => request('GET', '/api/config'),
  async login(code) {
    const r = await request('POST', '/api/login', { code, terminalId: terminalId() });
    api.session = r.token ? { playerId: r.player.id, token: r.token } : null;
    return r;
  },
  call(path, body = {}) {
    if (!api.session) return Promise.reject(new ApiError(409, 'SESSION_LOST', 'ログインしていません'));
    return request('POST', path, { ...api.session, ...body });
  },
  async logout() {
    if (!api.session) return;
    try { await api.call('/api/logout'); } catch { /* ignore */ }
    api.session = null;
  },
  heartbeat: () => api.call('/api/heartbeat'),
  profile: (p) => api.call('/api/profile', p),
  startRound: (game, bet, leverage) => api.call('/api/round/start', { game, bet, leverage }),
  finishRound: (roundId, result) => api.call('/api/round/finish', { roundId, result }),
  abortRound: (reason) => api.call('/api/round/abort', { reason }),
};
