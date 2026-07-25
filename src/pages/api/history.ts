import type { APIRoute } from 'astro';
import { recentSearches, todayApiCalls } from '../../lib/db';

export const prerender = false;

/**
 * GET /api/history → 최근 검색 5개 + 오늘 사용한 API 호출 수 / 남은 한도
 */
export const GET: APIRoute = async ({ locals }) => {
  const env = locals.runtime.env;
  const db = env.DB;
  if (!db) {
    return new Response(JSON.stringify({ ok: true, recent: [], usage: null }), {
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }

  const cap = Number(env.MAX_DAILY_ANALYSES ?? 50);
  const [recent, used] = await Promise.all([recentSearches(db, 5), todayApiCalls(db)]);

  return new Response(
    JSON.stringify({
      ok: true,
      recent,
      usage: { used, cap, remaining: Math.max(0, cap - used) },
    }),
    { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } },
  );
};
