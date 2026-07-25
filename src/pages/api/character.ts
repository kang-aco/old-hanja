import type { APIRoute } from 'astro';
import { charactersByEum, charactersByRadical, getCharacter, getRadical } from '../../lib/db';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });

/**
 * GET /api/character?hanja=學   → 한자 상세 (음·훈·부수·획수 + 같은 부수 한자)
 * GET /api/character?eum=학     → 한글 음으로 한자 후보 목록 (입력 자동완성)
 *
 * 전부 D1 조회이므로 API 비용이 발생하지 않습니다.
 */
export const GET: APIRoute = async ({ url, locals }) => {
  const db = locals.runtime.env.DB;
  if (!db) return json({ ok: false, error: 'D1 바인딩이 없습니다.' }, 500);

  const hanja = url.searchParams.get('hanja')?.trim();
  const eum = url.searchParams.get('eum')?.trim();

  if (hanja) {
    const char = await getCharacter(db, [...hanja][0] ?? hanja);
    if (!char) return json({ ok: true, found: false });
    const radical = char.radical ? await getRadical(db, char.radical) : null;
    const siblings = char.radical
      ? (await charactersByRadical(db, char.radical, 12)).filter((c) => c.hanja !== char.hanja)
      : [];
    return json({ ok: true, found: true, character: char, radical, siblings });
  }

  if (eum) {
    const candidates = await charactersByEum(db, eum, 12);
    return json({ ok: true, eum, candidates });
  }

  return json({ ok: false, error: 'hanja 또는 eum 파라미터가 필요합니다.' }, 400);
};
