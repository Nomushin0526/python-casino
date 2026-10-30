// Cloudflare Pages Functions：/api/* をすべて共通のAPI本体（server/core/api.js）に渡す
import config from '../../config.json';
import { createApi } from '../../server/core/api.js';
import { d1Adapter } from '../../server/core/db-d1.js';

export async function onRequest({ request, env }) {
  if (!env.DB) {
    return Response.json({ error: 'NO_DB', message: 'データベース（D1）がつながっていません。README の「ネット公開」を確認してください' }, { status: 500 });
  }
  const url = new URL(request.url);
  const db = await d1Adapter(env.DB);
  // 管理画面のパスワードは Cloudflare の環境変数 ADMIN_PASSWORD で設定（未設定なら管理画面は使えない）
  const api = createApi(config, db, { adminPassword: env.ADMIN_PASSWORD || '', platform: 'cloudflare' });
  let body = {};
  if (request.method === 'POST') {
    try { body = await request.json(); } catch { body = {}; }
  }
  const out = await api.handle({
    method: request.method,
    path: url.pathname.replace(/^\/api/, '') || '/',
    query: url.searchParams,
    body,
    adminToken: request.headers.get('x-admin-token') || url.searchParams.get('token'),
    joinUrl: `${url.origin}/`,
  });
  return Response.json(out.json, { status: out.status, headers: { 'cache-control': 'no-store' } });
}
