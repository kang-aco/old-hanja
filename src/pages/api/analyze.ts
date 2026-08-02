import type { APIRoute } from 'astro';
import Anthropic from '@anthropic-ai/sdk';
import {
  estimateCostUsd,
  hasHanja,
  normalize,
  resolveModel,
  resolveRepairModel,
  type Analysis,
  type AnalyzeMeta,
  type Mode,
} from '../../lib/analysis';
import { buildAnalysisRequest } from '../../lib/prompt';
import { cacheKey } from '../../lib/cache-key';
import { extractHanja } from '../../lib/hash';
import {
  REPAIR_SCHEMA,
  hanjaCountDiff,
  judgeRepair,
  reconstructionWarning,
  repairPrompt,
  totalDeviation,
  type CountMismatch,
} from '../../lib/validate';
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
const MAX_INPUT_CHARS = 300;

/**
 * 한 번에 분석할 수 있는 한자 수 상한.
 *
 * 글자별 분해를 없앤 뒤 출력이 약 1/3 로 줄어 지연이 길이와 거의 무관해졌다
 * (실측: 9자→23초, 62자→19초, 136자→23초). 그래서 예전 150자에서 300자로 올렸다.
 * 300자면 출력 약 5,200토큰 · 40초 내외로 예상되며, 응답을 서버에서 모아 반환하므로
 * Cloudflare 엣지의 약 100초 제한에도 충분한 여유가 있다.
 */
const MAX_HANJA = 300;

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

  const hanjaCount = extractHanja(text).length;
  if (hanjaCount > MAX_HANJA) {
    return json(
      {
        ok: false,
        code: 'too_many_hanja',
        error:
          `한자가 ${hanjaCount}자입니다. 한 번에 ${MAX_HANJA}자까지 분석할 수 있습니다. ` +
          '문장 단위로 나눠 입력해 주세요. 나눠서 분석하면 어순 풀이도 더 정확합니다.',
      },
      400,
    );
  }

  // 캐시 키를 만드는 코드는 src/lib/cache-key.ts 한 곳뿐이다.
  // 무엇이 키를 가르는지(버전·mode·정규화된 원문)와 두 번의 사고 이력은 그 파일에 있다.
  const textHash = await cacheKey(text, mode);
  const db = env.DB;

  // ── 1) 캐시 조회 — 히트하면 API 비용 0 ──────────────────────────────────
  // D1 이 없거나(바인딩 누락) 스키마가 안 들어가 있어도 분석 자체는 계속 되어야 한다.
  // 캐시는 최적화일 뿐이므로 실패를 삼키고 캐시 미스로 취급한다.
  let cached: Awaited<ReturnType<typeof getCachedAnalysis>> = null;
  if (db) {
    try {
      cached = await getCachedAnalysis(db, textHash);
    } catch {
      cached = null;
    }
  }
  if (cached) {
    try {
      await logSearch(db!, textHash, text, true);
    } catch {
      /* 기록 실패는 무시 */
    }
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
    // 상한 조회가 실패하면(테이블 없음 등) 상한을 적용하지 않고 넘어간다.
    let used: number | null = null;
    try {
      used = await todayApiCalls(db);
    } catch {
      used = null;
    }
    if (used !== null && used >= cap) {
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

  // 프롬프트·스키마·출력 예산·thinking 분기는 모두 buildAnalysisRequest 안에 있다.
  // 그 함수는 네트워크를 건드리지 않는 순수 함수라 API 호출 없이 테스트로 고정된다
  // (tests/prompt.test.ts, tests/__snapshots__/request-*.txt).
  const params = buildAnalysisRequest({ text, mode }, model);

  let message: Anthropic.Message;
  try {
    // 반드시 스트리밍으로 호출한다.
    // max_tokens 가 커지면 SDK 가 비스트리밍 요청을 거부한다
    // ("Streaming is required for operations that may take longer than 10 minutes").
    // 여기서는 스트림을 서버에서 모아 한 번에 JSON 으로 반환하므로 클라이언트 코드는 그대로다.
    // output_config 는 SDK 버전에 따라 타입 정의가 없을 수 있어 캐스팅한다.
    const stream = client.messages.stream(params as never);
    message = (await stream.finalMessage()) as Anthropic.Message;
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
      {
        ok: false,
        code: 'truncated',
        error:
          `구절이 예상보다 길어 분석이 중간에 끊겼습니다 (한자 ${hanjaCount}자). ` +
          '문장 단위로 나눠서 한 번에 40자 정도씩 입력하면 더 정확하고 저렴합니다.',
      },
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

  let inputTokens = message.usage?.input_tokens ?? 0;
  let outputTokens = message.usage?.output_tokens ?? 0;

  // ── 3-1) 어순 재구성 검증 — 원문 글자가 그대로 다 쓰였는지 ────────────────
  // 대구 구문에서 모델이 대칭을 맞추려고 없는 글자를 만들어 넣는다. 프롬프트 규칙을
  // 네 차례 강화해도 막히지 않아(Haiku 3/3 실패, Sonnet 1/3 실패) 코드로 검증한다.
  // 검증 자체는 비용 0 이고, 어긋났을 때만 해당 필드만 다시 만든다.
  const warnings: string[] = [];
  let diff: CountMismatch[] = hanjaCountDiff(text, analysis.word_order_reconstruction);

  // 어긋났으면 해당 필드만 1회 다시 만든다.
  let repairInfo: {
    model: string;
    accepted: boolean;
    /** 교정 전/후 어긋난 총량. 개선했는데도 거부됐는지 구분하려면 이 값이 필요하다 */
    before: number;
    after: number | null;
    /** 교정 호출이 왜 무효였는지 (max_tokens 로 잘림 등) */
    stop?: string | null;
  } | null = null;
  if (diff.length > 0) {
    const repairModel = resolveRepairModel(model, env);
    repairInfo = {
      model: repairModel,
      accepted: false,
      before: totalDeviation(diff),
      after: null,
    };
    try {
      // 교정 모델이 light 모델이 아니면(예: sonnet) 사고 토큰을 끈다.
      // sonnet-5 는 adaptive thinking 이 기본 ON 이라, 끄지 않으면 작은 max_tokens 를
      // 사고가 다 먹어 JSON 이 나오지 않는다. 실제로 그 때문에 교정이 3/3 무효였다.
      const repairParams: Record<string, unknown> = {
        model: repairModel,
        max_tokens: 1200, // 한 필드만 다시 만들므로 작게 두되, 잘리지 않을 만큼은 준다
        messages: [
          { role: 'user', content: repairPrompt(text, analysis.word_order_reconstruction, diff) },
        ],
        output_config: { format: { type: 'json_schema', schema: REPAIR_SCHEMA } },
      };
      if (repairModel !== resolveModel('light', env)) {
        repairParams.thinking = { type: 'disabled' };
      }

      const repair = (await client.messages
        .stream(repairParams as never)
        .finalMessage()) as Anthropic.Message;

      inputTokens += repair.usage?.input_tokens ?? 0;
      outputTokens += repair.usage?.output_tokens ?? 0;
      repairInfo.stop = repair.stop_reason ?? null;

      const rb = repair.content.find((b) => b.type === 'text');
      if (rb && rb.type === 'text') {
        const fixed = (JSON.parse(rb.text) as { word_order_reconstruction?: string })
          .word_order_reconstruction;
        if (fixed) {
          const after = hanjaCountDiff(text, fixed);
          // 수용 기준은 완전 일치가 아니라 이탈도 감소다. 之 를 2→4 로 틀린 것을
          // 2→3 으로 줄인 재생성은 아직 맞지 않아도 이전보다 나으므로 받아들인다.
          const verdict = judgeRepair(diff, after);
          repairInfo.after = verdict.after;
          if (verdict.accepted) {
            analysis.word_order_reconstruction = fixed;
            diff = after;
            repairInfo.accepted = true;
          }
        }
      }
    } catch {
      /* 재생성 실패는 원래 결과를 그대로 두고 경고만 붙인다 */
    }

    // 부분적으로만 개선된 결과도 버리지 않고 그대로 보여 준다. 대신 어디가 아직
    // 원문과 다른지 문구로 밝혀, 사용자가 그 부분만 걸러 읽을 수 있게 한다.
    const warning = reconstructionWarning(diff, repairInfo.accepted);
    if (warning) warnings.push(warning);
  }

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

  // repair 는 관측용이다. 교정이 얼마나 자주 필요한지, 받아들여졌는지 확인할 수 있다.
  return json({ ok: true, analysis, meta, warnings, repair: repairInfo, extras: await extras(db, text) });
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
