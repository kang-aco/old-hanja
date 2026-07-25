import type { APIRoute } from 'astro';
import { findIdioms } from '../../lib/db';
import { extractHanja } from '../../lib/hash';

export const prerender = false;

/**
 * GET /api/idioms?keyword=學  → 해당 한자를 포함하는 고사성어 (D1, 비용 0)
 */
export const GET: APIRoute = async ({ url, locals }) => {
  const db = locals.runtime.env.DB;
  if (!db) {
    return new Response(JSON.stringify({ ok: false, error: 'D1 바인딩이 없습니다.' }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }

  const keyword = url.searchParams.get('keyword')?.trim() ?? '';
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 8) || 8, 30);
  const chars = extractHanja(keyword);
  const idioms = await findIdioms(db, chars.length ? chars : [keyword].filter(Boolean), limit);

  return new Response(JSON.stringify({ ok: true, keyword, idioms }), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
};
