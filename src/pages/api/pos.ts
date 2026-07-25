import type { APIRoute } from 'astro';
import { extractHanja } from '../../lib/hash';

export const prerender = false;

/**
 * POST /api/pos  { text }
 *   → 글자별 품사 태깅 + 이 구절에 나타난 문형 패턴
 *
 * 전부 D1 조회다 (UD Classical Chinese · Kyoto 트리뱅크에서 만든 표).
 * LLM 을 쓰지 않으므로 비용이 0 이고, 사람이 검수한 코퍼스라 품사가 더 정확하다.
 * 之(속격 조사 vs 대명사)처럼 다의적인 글자는 분포를 함께 돌려준다.
 */

interface PosRow {
  hanja: string;
  upos: string;
  pos_ko: string;
  detail: string | null;
  gloss: string | null;
  freq: number;
  dist_json: string | null;
}

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
  const seq = extractHanja(text); // 원문 순서 유지 (중복 제거하지 않음)
  if (seq.length === 0) return json({ ok: true, tokens: [], patterns: [] });

  try {
    const uniq = [...new Set(seq)];
    const ph = uniq.map(() => '?').join(',');
    const { results } = await db
      .prepare(
        `SELECT hanja, upos, pos_ko, detail, gloss, freq, dist_json
           FROM pos_chars WHERE hanja IN (${ph})`,
      )
      .bind(...uniq)
      .all<PosRow>();

    const byChar = new Map((results ?? []).map((r) => [r.hanja, r]));

    // 원문 순서대로 태깅. 코퍼스에 없는 글자는 upos 를 null 로 둔다.
    const tokens = seq.map((ch) => {
      const r = byChar.get(ch);
      if (!r) return { hanja: ch, upos: null, pos_ko: null, gloss: null, ambiguous: false };
      let dist: Array<{ pos: string; upos: string; n: number }> = [];
      try {
        dist = r.dist_json ? JSON.parse(r.dist_json) : [];
      } catch {
        dist = [];
      }
      // 2순위 품사가 전체의 20% 를 넘으면 "다의적"으로 표시한다
      const total = dist.reduce((s, d) => s + d.n, 0) || r.freq;
      const ambiguous = dist.length > 1 && dist[1]!.n / total >= 0.2;
      return {
        hanja: ch,
        upos: r.upos,
        pos_ko: r.pos_ko,
        detail: r.detail,
        gloss: r.gloss,
        freq: r.freq,
        dist,
        ambiguous,
      };
    });

    // 이 구절에서 실제로 만들어지는 품사 n-gram 을 코퍼스 빈도와 맞춰 본다
    const upos = tokens.map((t) => t.upos);
    const keys = new Set<string>();
    for (const n of [3, 2]) {
      for (let i = 0; i + n <= upos.length; i++) {
        const win = upos.slice(i, i + n);
        if (win.some((u) => !u)) continue;
        keys.add(win.join(' '));
      }
    }

    let patterns: Array<Record<string, unknown>> = [];
    if (keys.size > 0) {
      const list = [...keys];
      const pph = list.map(() => '?').join(',');
      const { results: pr } = await db
        .prepare(
          `SELECT pattern, pattern_ko, n, freq, example, example_gloss
             FROM pos_patterns WHERE pattern IN (${pph})
            ORDER BY n DESC, freq DESC LIMIT 8`,
        )
        .bind(...list)
        .all<Record<string, unknown>>();
      patterns = pr ?? [];
    }

    // ── 허사 해설 — 구절에 실제로 나온 것만 ────────────────────────────
    const { results: fw } = await db
      .prepare(
        `SELECT hanja, role, position_hint, example, example_ko
           FROM function_words WHERE hanja IN (${ph})`,
      )
      .bind(...uniq)
      .all<Record<string, unknown>>();
    // 원문에 나온 순서대로
    const fwOrder = new Map(seq.map((c, i) => [c, i]));
    const functionWords = (fw ?? []).sort(
      (a, b) => (fwOrder.get(String(a.hanja)) ?? 0) - (fwOrder.get(String(b.hanja)) ?? 0),
    );

    // ── 정형 문형 — 문자열 템플릿을 정규식으로 바꿔 맞춘다 ──────────────
    // 구두점·공백을 뺀 한자열에 대고 맞추므로 "是知也" 처럼 쉼표가 끼어도 잡힌다.
    const hanjaOnly = seq.join('');
    const { results: sp } = await db
      .prepare(
        `SELECT pattern, pattern_type, explanation, example_hanja, example_korean, priority
           FROM sentence_patterns ORDER BY priority DESC`,
      )
      .all<Record<string, unknown>>();

    const matched: Array<Record<string, unknown>> = [];
    for (const row of sp ?? []) {
      const pat = String(row.pattern);
      // …… 자리표를 "한자 0~8자"로 바꾼다. 그 외 글자는 그대로 일치해야 한다.
      // 반드시 게으른(lazy) 수량자를 쓸 것. 탐욕적으로 두면 不……不…… 이
      // "不知爲不知是知也" 처럼 문장 끝까지 삼켜 엉뚱한 구간을 보여 준다.
      const parts = pat.split('……').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      const source = parts.join('[\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF]{0,8}?');
      let re: RegExp;
      try {
        re = new RegExp(source);
      } catch {
        continue;
      }
      const hit = re.exec(hanjaOnly);
      if (hit) matched.push({ ...row, matched_text: hit[0] });
      if (matched.length >= 6) break;
    }

    const known = tokens.filter((t) => t.upos).length;
    return json({
      ok: true,
      coverage: { known, total: tokens.length },
      tokens,
      patterns,
      function_words: functionWords,
      sentence_patterns: matched,
      source: 'UD Classical Chinese (Kyoto) · CC BY-SA 4.0',
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: `품사 정보를 불러올 수 없습니다: ${detail}` }, 500);
  }
};
