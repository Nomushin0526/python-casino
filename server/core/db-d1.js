// Cloudflare版：D1 を共通の非同期インターフェースで包む
import { SCHEMA_STATEMENTS } from './schema.js';

let initialized = false;

export async function d1Adapter(d1) {
  if (!initialized) {
    // 初回だけテーブルを作る（何度実行しても大丈夫な SQL）
    await d1.batch(SCHEMA_STATEMENTS.map((s) => d1.prepare(s)));
    initialized = true;
  }
  const prep = (sql, params) => d1.prepare(sql).bind(...params);
  return {
    async get(sql, ...params) { return (await prep(sql, params).first()) || null; },
    async all(sql, ...params) { return (await prep(sql, params).all()).results; },
    async run(sql, ...params) {
      const r = await prep(sql, params).run();
      return { lastId: Number(r.meta?.last_row_id ?? 0), changes: Number(r.meta?.changes ?? 0) };
    },
    async batch(list) {
      const rs = await d1.batch(list.map(([sql, params = []]) => prep(sql, params)));
      return rs.map((r) => ({ lastId: Number(r.meta?.last_row_id ?? 0), changes: Number(r.meta?.changes ?? 0) }));
    },
  };
}
