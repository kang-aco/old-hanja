import type { APIRoute } from 'astro';
import { charactersByRadical, getRadical, listRadicals } from '../../lib/db';

export const prerender = false;

/**
 * GET /api/radicals              → 강희부수 214개 전체 (부수 사전)
 * GET /api/radicals?radical=子   → 해당 부수 + 그 부수를 쓰는 한자 목록
 */
export const GET: APIRoute = async ({ url, locals }) => {
  const db = locals.runtime.env.DB;
  if (!db) {
    return new Response(JSON.stringify({ ok: false, error: 'D1 바인딩이 없습니다.' }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }

  const radical = url.searchParams.get('radical')?.trim();
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=86400',
  };

  if (radical) {
    const row = await getRadical(db, radical);
    if (!row) return new Response(JSON.stringify({ ok: true, found: false }), { headers });
    const characters = await charactersByRadical(db, row.radical, 30);
    return new Response(JSON.stringify({ ok: true, found: true, radical: row, characters }), {
      headers,
    });
  }

  const radicals = await listRadicals(db);
  return new Response(JSON.stringify({ ok: true, count: radicals.length, radicals }), { headers });
};
