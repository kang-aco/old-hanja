import type { APIRoute } from 'astro';
import Anthropic from '@anthropic-ai/sdk';
import {
  ANALYSIS_SCHEMA,
  MAX_TOKENS,
  SYSTEM_PROMPT,
  estimateCostUsd,
  hasHanja,
  normalize,
  resolveModel,
  type Analysis,
  type AnalyzeMeta,
  type Mode,
} from '../../lib/analysis';
import { extractHanja, sha256 } from '../../lib/hash';
import {
  findIdioms,
  findPassages,
  getCachedAnalysis,
  logSearch,
  putCachedAnalysis,
  todayApiCalls,
} from '../../lib/db';

export const prerender = false;

const DEFAULT_DAILY_CAP = 50;
const MAX_INPUT_CHARS = 200;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;

  let payload: { text?: unknown; mode?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return json({ ok: false, error: '요청 형식이 올바르지 않습니다.' }, 400);
  }

  const raw = typeof payload.text === 'string' ? payload.text : '';
  const text = normalize(raw);
  const mode: Mode = payload.mode === 'deep' ? 'deep' : 'light';

  // ── 입력 검증 (API 호출 전에 걸러서 비용 발생을 막는다) ──────────────────
  if (!text) {
    return json({ ok: false, error: '한문 구절을 입력해 주세요.' }, 400);
  }
  if (text.length > MAX_INPUT_CHARS) {
    return json(
      {
        ok: false,
        error: `한 번에 분석할 수 있는 길이는 ${MAX_INPUT_CHARS}자까지입니다. 구절을 나눠서 입력해 주세요.`,
      },
      400,
    );
  }
  if (!hasHanja(text)) {
    return json({ ok: false, error: '한자가 포함된 구절을 입력해 주세요. 예: 學而時習之' }, 400);
  }

  const textHash = await sha256(text);
  const db = env.DB;

  // ── 1) 캐시 조회 — 히트하면 API 비용 0 ──────────────────────────────────
  const cached = db ? await getCachedAnalysis(db, textHash) : null;
  if (cached) {
    if (db) await logSearch(db, textHash, text, true);
    const meta: AnalyzeMeta = {
      model: cached.model,
      mode,
      cached: true,
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: 0,
    };
    return json({ ok: true, analysis: cached.result, meta, extras: await extras(db, text) });
  }

  // ── 2) 일일 호출 상한 ────────────────────────────────────────────────────
  const cap = Number(env.MAX_DAILY_ANALYSES ?? DEFAULT_DAILY_CAP);
  if (db && Number.isFinite(cap) && cap > 0) {
    const used = await todayApiCalls(db);
    if (used >= cap) {
      return json(
        {
          ok: false,
          error: `오늘의 분석 한도(${cap}회)를 모두 사용했습니다. 이미 분석한 구절은 계속 무료로 다시 볼 수 있습니다.`,
          code: 'daily_cap',
        },
        429,
      );
    }
  }

  if (!env.ANTHROPIC_API_KEY) {
    return json(
      {
        ok: false,
        code: 'no_api_key',
        error:
          'ANTHROPIC_API_KEY 가 설정되지 않아 새 구절을 분석할 수 없습니다. ' +
          '이미 분석한 구절과 부수 사전은 그대로 이용할 수 있습니다. ' +
          '(로컬: .env / 배포: Pages → Settings → Environment variables 에 Secret 으로 추가)',
      },
      503,
    );
  }

  // ── 3) LLM 호출 ─────────────────────────────────────────────────────────
  const model = resolveModel(mode, env);
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  // 비용 최적화 — 두 모드 모두 사고(thinking) 토큰을 쓰지 않는다.
  //  - haiku-4-5: thinking / effort 파라미터 자체를 지원하지 않으므로 보내지 않는다.
  //  - sonnet-5: adaptive thinking 이 기본 ON 이라 명시적으로 끈다. 켜면 출력 토큰이 약 2배가 된다.
  //    구조화된 추출 작업이라 사고를 끄더라도 Haiku 대비 정확도 이득은 그대로 남는다.
  const isDeep = mode === 'deep';
  const params: Record<string, unknown> = {
    model,
    max_tokens: MAX_TOKENS[mode],
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `[분석할 한문 구절]\n${text}` }],
    output_config: { format: { type: 'json_schema', schema: ANALYSIS_SCHEMA } },
  };
  if (isDeep) params.thinking = { type: 'disabled' };

  let message: Anthropic.Message;
  try {
    // output_config 는 SDK 버전에 따라 타입 정의가 없을 수 있어 캐스팅한다.
    message = (await client.messages.create(params as never)) as Anthropic.Message;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const status = err instanceof Anthropic.APIError ? err.status : undefined;
    if (status === 429) {
      return json(
        { ok: false, error: 'API 사용량 제한에 걸렸습니다. 잠시 후 다시 시도해 주세요.' },
        429,
      );
    }
    return json({ ok: false, error: `분석 요청이 실패했습니다: ${detail}` }, 502);
  }

  if (message.stop_reason === 'refusal') {
    return json({ ok: false, error: '이 요청은 처리할 수 없습니다. 다른 구절로 시도해 주세요.' }, 422);
  }
  if (message.stop_reason === 'max_tokens') {
    return json(
      { ok: false, error: '구절이 너무 길어 분석이 중간에 끊겼습니다. 더 짧게 나눠 입력해 주세요.' },
      502,
    );
  }

  const textBlock = message.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    return json({ ok: false, error: '분석 결과가 비어 있습니다. 다시 시도해 주세요.' }, 502);
  }

  let analysis: Analysis;
  try {
    analysis = JSON.parse(textBlock.text) as Analysis;
  } catch {
    return json({ ok: false, error: '분석 결과를 해석할 수 없습니다. 다시 시도해 주세요.' }, 502);
  }

  const inputTokens = message.usage?.input_tokens ?? 0;
  const outputTokens = message.usage?.output_tokens ?? 0;
  const meta: AnalyzeMeta = {
    model,
    mode,
    cached: false,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: estimateCostUsd(model, inputTokens, outputTokens),
  };

  // ── 4) 캐시 저장 + 기록 (실패해도 응답은 정상 반환) ──────────────────────
  if (db) {
    try {
      await putCachedAnalysis(db, textHash, text, analysis, model);
      await logSearch(db, textHash, text, false);
    } catch {
      /* D1 실패는 사용자 경험을 막지 않는다 */
    }
  }

  return json({ ok: true, analysis, meta, extras: await extras(db, text) });
};

/** D1 시드에서 추가 연관 콘텐츠를 가져온다 (API 비용 0) */
async function extras(db: D1Database | undefined, text: string) {
  if (!db) return { idioms: [], passages: [] };
  const chars = extractHanja(text);
  try {
    const [idioms, passages] = await Promise.all([
      findIdioms(db, chars, 6),
      findPassages(db, chars, 6),
    ]);
    return { idioms, passages: passages.filter((p) => normalize(p.passage) !== text) };
  } catch {
    return { idioms: [], passages: [] };
  }
}
