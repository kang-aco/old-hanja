import type { APIRoute } from 'astro';
import { extractHanja } from '../../lib/hash';

export const prerender = false;

/**
 * POST /api/radical-cards  { text }
 *   → 구절에 나온 한자들의 부수 암기 카드
 *
 * 전부 D1(Unihan 기반 8,500여 자 + 강희부수 214개) 조회이므로 LLM 비용이 0 이다.
 * 예전에는 이 카드를 AI 가 만들었는데, 카드 2장으로 제한해야 할 만큼 출력 토큰을
 * 많이 먹었고 부수·획수 정보도 틀릴 수 있었다. 이제 정확한 데이터로 개수 제한 없이 만든다.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const db = locals.runtime.env.DB;
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });

  if (!db) return json({ ok: false, error: 'D1 바인딩이 없습니다.' }, 500);

  let payload: { text?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return json({ ok: false, error: '요청 형식이 올바르지 않습니다.' }, 400);
  }

  const text = typeof payload.text === 'string' ? payload.text : '';
  // 원문 순서를 유지하면서 중복 제거
  const chars = [...new Set(extractHanja(text))];
  if (chars.length === 0) return json({ ok: true, cards: [] });

  try {
    const placeholders = chars.map(() => '?').join(',');

    // 1) 구절에 나온 한자들의 부수 정보
    const { results: targets } = await db
      .prepare(
        `SELECT c.hanja, c.eum, c.hun, c.definition, c.stroke_count,
                r.radical, r.name AS radical_name, r.meaning AS radical_meaning,
                r.stroke_count AS radical_strokes, r.variants, r.mnemonic
           FROM characters c
           LEFT JOIN radicals r ON r.radical = c.radical
          WHERE c.hanja IN (${placeholders})`,
      )
      .bind(...chars)
      .all<Record<string, unknown>>();

    const rows = targets ?? [];
    if (rows.length === 0) return json({ ok: true, cards: [] });

    // 2) 등장한 부수별로, 같은 부수를 쓰는 다른 한자들을 한 번에 가져온다.
    //    획수가 적은 것부터 = 기초 한자부터 보여 준다.
    const radicals = [...new Set(rows.map((r) => r.radical).filter(Boolean))] as string[];
    const siblings = new Map<string, Array<Record<string, unknown>>>();
    if (radicals.length > 0) {
      const rp = radicals.map(() => '?').join(',');
      // 한국어 훈이 있는 글자(직접 큐레이션한 182자)를 앞세우고, 그다음 획수가 적은 순.
      // hun 이 없는 글자도 영문 뜻(definition)이 있으므로 후보에서 빼지 않는다.
      // 예전에 hun IS NOT NULL 로 걸렀더니 후보가 182자로 줄어 목록이 거의 비었다.
      const { results: sibs } = await db
        .prepare(
          `SELECT hanja, eum, hun, definition, radical, stroke_count
             FROM characters
            WHERE radical IN (${rp}) AND (hun IS NOT NULL OR definition IS NOT NULL)
            ORDER BY (hun IS NULL), stroke_count ASC
            LIMIT 2000`,
        )
        .bind(...radicals)
        .all<Record<string, unknown>>();
      for (const s of sibs ?? []) {
        const key = String(s.radical);
        const list = siblings.get(key) ?? [];
        if (list.length < 8) list.push(s);
        siblings.set(key, list);
      }
    }

    // 원문에 나온 순서대로 카드를 정렬한다
    const order = new Map(chars.map((c, i) => [c, i]));
    const cards = rows
      .filter((r) => r.radical)
      .sort((a, b) => (order.get(String(a.hanja)) ?? 0) - (order.get(String(b.hanja)) ?? 0))
      .map((r) => ({
        hanja: r.hanja,
        eum: r.eum,
        hun: r.hun,
        definition: r.definition,
        stroke_count: r.stroke_count,
        radical: r.radical,
        radical_name: r.radical_name,
        radical_meaning: r.radical_meaning,
        radical_strokes: r.radical_strokes,
        variants: r.variants,
        mnemonic: r.mnemonic,
        same_radical_chars: (siblings.get(String(r.radical)) ?? []).filter(
          (s) => s.hanja !== r.hanja,
        ),
      }));

    return json({ ok: true, count: cards.length, cards });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: `부수 정보를 불러올 수 없습니다: ${detail}` }, 500);
  }
};
