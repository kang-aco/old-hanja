/**
 * 디버그 관측 — 코드를 고치지 않고 "어느 층에서 틀렸는지" 좁히는 화면의 재료.
 *
 * 이 파일 안에서 네트워크·DB·시계를 건드리지 않는다. 호출부(analyze.ts)가 각 층에서
 * 손에 쥔 값을 넘기면, 여기서는 그것을 화면이 읽을 수 있는 모양으로 투영만 한다.
 *
 * 담을 항목은 과거에 실제로 난 사고를 하나씩 대보고 정했다. 이미 `meta`(모델·토큰·
 * 캐시 여부·비용)나 `repair`(교정 채택 여부·이탈도 총량)로 나가는 값은 여기 담지
 * 않는다 — 같은 값을 두 곳에서 만들면 언젠가 서로 어긋난다.
 *
 * 사고 대조 결과 이 파일에만 있는 것 둘:
 *  - input.invisible : 폭 없는 문자를 코드포인트로 적어 보인다. 원문과 정규화 결과를
 *    나란히 놓기만 하면 U+FEFF 가 낀 구절과 안 낀 구절이 화면에서 똑같아 보인다.
 *    캐시 키가 갈라진 사고가 발각되지 않은 이유가 정확히 그것이었다.
 *  - validate.repair_* : 교정 호출의 요청 파라미터는 analyze.ts 인라인이라 어디에도
 *    남지 않았다. 교정이 3/3 무효였던 원인이 "예산 700 을 사고 토큰이 다 먹은 것"
 *    이었는데, 예산도 thinking 여부도 사후에 볼 방법이 없었다.
 *
 * 화면이 잡지 못하는 것(사각지대)은 다음 둘이며, 각각 테스트가 대신 잡는다.
 *  - 프롬프트 few-shot 예시 자체의 결함 → tests/prompt-rules.test.ts
 *    (3,000자 프롬프트에서 글자 하나의 '부재'는 사람이 눈으로 못 찾는다)
 *  - 캐시 키 재료에 버전이 들어 있는가 → tests/cache-key.test.ts
 *    (해시는 단방향이라 키를 봐도 재료를 복원할 수 없다)
 */
import type { Mode } from './analysis';
import { ANALYSIS_VERSION } from './cache-key';
import { sha256 } from './hash';
import type { CountMismatch } from './validate';

// ── 접근 통제 ───────────────────────────────────────────────────────────────

/**
 * DEBUG_KEY 의 최소 길이.
 *
 * 짧은 키를 허용하면 "?debug=1 만으로는 아무것도 보이지 않는다"가 설정값에 기대는
 * 우연이 된다 — DEBUG_KEY=1 로 두는 순간 깨진다. 길이 하한을 두면 그 완료 조건이
 * 설정과 무관한 불변조건이 된다. 짧은 키는 조용히 무시하지 않고 README 와
 * .env.example 에 "16자 이상"과 그 이유를 적어 둔다.
 */
export const MIN_DEBUG_KEY_LENGTH = 16;

/**
 * 넘어온 값이 DEBUG_KEY 와 일치하는가.
 *
 * 키가 없거나(미설정·빈 값), 16자 미만이거나, 값이 넘어오지 않았으면 무조건 false 다.
 * false 면 호출부는 debug 필드를 **아예 만들지 않는다**. 빈 debug 필드를 내보내면
 * "키가 틀렸다"는 사실 자체가 새어 나가고, 화면 쪽에도 분기가 하나 더 생긴다.
 *
 * 비교를 다이제스트끼리 하는 이유: 문자열 `===` 는 길이와 앞자리에서 조기 반환하므로
 * 응답 시간에 정보가 실린다. Workers 런타임에는 timingSafeEqual 이 없고, 추측값의
 * SHA-256 은 키와 아무 상관이 없으므로 자리별 비교로 얻을 것이 남지 않는다.
 *
 * ※ 돌연변이 검사에서 **살아남는 것이 정상인 변형이 둘** 있다. 테스트가 무효라서가
 *   아니라 단위 테스트로 관측할 수 있는 성질이 아니어서다. 아래 두 줄에 각각 적어 둔다.
 */
export async function debugAllowed(
  provided: string | null | undefined,
  env: Partial<Env>,
): Promise<boolean> {
  const key = env.DEBUG_KEY ?? '';
  if (key.length < MIN_DEBUG_KEY_LENGTH) return false;
  // 빠른 길일 뿐 판정을 바꾸지 않는다 — 키는 16자 이상이므로 빈 값과 같아질 수 없다.
  // 지워도 어떤 테스트도 깨지지 않는 것이 정상이다. 남겨 두는 것은 공격자가 넘긴
  // 값을 해싱조차 하지 않기 위해서다.
  if (!provided) return false;
  // 아래를 `provided === key` 로 바꿔도 테스트는 전부 통과한다. 두 구현의 차이는
  // 결과가 아니라 응답 시간이고, 그것은 단위 테스트가 볼 수 있는 것이 아니다.
  // 그러므로 이 줄을 지키는 것은 테스트가 아니라 위 주석이다.
  const [a, b] = await Promise.all([sha256(provided), sha256(key)]);
  return a === b;
}

// ── 보이지 않는 문자 ────────────────────────────────────────────────────────

/**
 * 훑을 코드포인트 범위 — 정규식 리터럴이 아니라 숫자로 적는다.
 *
 * 이 프로젝트는 보이지 않는 문자를 소스에 리터럴로 적었다가 세 번 다쳤다(한자 범위를
 * U+F900 대신 U+8C48 로 적어 한글이 한자로 판정된 것, 캐시 키 구분자에 U+0000 이
 * 들어간 것, normalize 의 문자 클래스가 `[…]` 로만 보인 것). 숫자로 적으면 편집
 * 과정에서 조용히 달라져도 눈에 보인다. tests/normalize.test.ts 의 소스 스캐너가
 * 이 파일도 훑는다.
 *
 * **정규화가 제거하는 것보다 넓게 훑는다.** 목적이 다르기 때문이다. normalize 는
 * "지울 것"만 알면 되지만, 이 화면은 "왜 두 구절의 키가 갈라졌는가"에 답해야 한다.
 * 남아서 키를 가르는 문자(변이 선택자·IVS)와, 지워지지 않고 공백 한 칸으로 바뀌는
 * 문자(U+00A0, U+3000 등 `\s` 에 걸리는 것들)가 오히려 답인 경우가 많다.
 *
 *  0x00-0x08, 0x0B-0x0C, 0x0E-0x1F, 0x7F-0x9F  제어문자 (탭·개행·복귀는 뺀다)
 *  0xA0                                        NO-BREAK SPACE
 *  0xAD                                        SOFT HYPHEN
 *  0x2000-0x200F                               각종 공백 · 폭 없는 문자 · 방향 표시
 *  0x2028-0x202F                               줄/문단 구분자 · 방향 제어 · 좁은 NBSP
 *  0x205F-0x206F                               수학 공백 ~ 보이지 않는 연산자 · 서식
 *  0x3000                                      IDEOGRAPHIC SPACE
 *  0xFE00-0xFE0F                               변이 선택자 (이체자 구분에 쓰인다)
 *  0xFEFF                                      BOM
 *  0xFFF9-0xFFFB                               삽입 주석 문자
 *  0xE0100-0xE01EF                             IVS (BMP 밖이라 코드포인트로 훑는다)
 */
const INVISIBLE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0000, 0x0008],
  [0x000b, 0x000c],
  [0x000e, 0x001f],
  [0x007f, 0x009f],
  [0x00a0, 0x00a0],
  [0x00ad, 0x00ad],
  [0x2000, 0x200f],
  [0x2028, 0x202f],
  [0x205f, 0x206f],
  [0x3000, 0x3000],
  [0xfe00, 0xfe0f],
  [0xfeff, 0xfeff],
  [0xfff9, 0xfffb],
  [0xe0100, 0xe01ef],
];

const label = (cp: number) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;

/**
 * 문자열에 낀 보이지 않는 문자를 `U+FEFF@3` 형태로 나열한다.
 *
 * 위치는 UTF-16 인덱스가 아니라 **코드포인트 순번**이다. 사람이 원문을 세는 방식과
 * 같아야 화면에서 짚을 수 있고, IVS 처럼 BMP 밖 문자가 섞여도 어긋나지 않는다.
 */
export function findInvisible(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (INVISIBLE_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi)) {
      out.push(`${label(cp)}@${i}`);
    }
    i++;
  }
  return out;
}

// ── payload ─────────────────────────────────────────────────────────────────

/** 실제로 전송된 요청. 조립 결과(params)에서 투영하므로 조립과 어긋날 수 없다. */
export interface RequestView {
  model: string;
  max_tokens: number;
  /** thinking 파라미터의 type. 아예 붙지 않았으면 null */
  thinking: string | null;
  system: string;
  user: string;
  /**
   * 실려 나간 최상위 키 전부.
   * temperature 처럼 조용히 끼어든 파라미터를 화면에서 바로 본다
   * (tests/prompt.test.ts 가 같은 것을 테스트 쪽에서 못박고 있다).
   */
  keys: string[];
}

/** 파싱 **전**의 AI 응답. 4층과 5층을 가르는 것이 이 원문이다. */
export interface ResponseView {
  stop_reason: string | null;
  parsed_ok: boolean;
  raw_text: string;
}

export interface ValidateView {
  /** 최종 이탈 내역 — 교정을 채택했으면 교정 후 */
  diff: CountMismatch[];
  /** 최종 이탈도 총량 */
  deviation: number;
  /** 교정 전 이탈 내역. 교정이 어느 글자를 고쳤는지 보려면 이 둘을 대봐야 한다 */
  initial_diff: CountMismatch[];
  /**
   * 교정 호출의 요청 파라미터. analyze.ts 인라인이라 여기 말고는 남는 곳이 없다.
   * 교정 프롬프트 전문은 `repair_request.user` 다 — 따로 담지 않는다.
   */
  repair_request: RequestView | null;
  repair_response: ResponseView | null;
}

export interface DebugPayload {
  input: {
    raw: string;
    normalized: string;
    changed: boolean;
    hanja_count: number;
    invisible: { raw: string[]; normalized: string[] };
  };
  cache: { key: string; version: string; mode: Mode; hit: boolean };
  /** 캐시 히트면 null — 요청을 아예 만들지 않았다. 없는 것을 지어내지 않는다 */
  request: RequestView | null;
  response: ResponseView | null;
  validate: ValidateView | null;
}

export interface DebugInput {
  allowed: boolean;
  raw: string;
  normalized: string;
  hanjaCount: number;
  mode: Mode;
  cacheKey: string;
  cacheHit: boolean;
  /** buildAnalysisRequest 의 결과를 그대로 넘긴다 */
  request?: Record<string, unknown> | null;
  response?: ResponseView | null;
  validate?: ValidateView | null;
}

/**
 * SDK 요청 파라미터를 화면용으로 투영한다.
 *
 * 조립 결과에서 직접 뽑는다. 화면이 따로 조립하면 실제로 보낸 것과 다른 값을 보여
 * 주게 되고, 그러면 이 화면을 믿을 수 없다.
 *
 * output_config 의 JSON 스키마 전문은 담지 않는다 — 매 요청 같은 상수라 화면을
 * 뒤덮기만 한다. 스키마가 빠지거나 딴 것이 끼어든 경우는 `keys` 로 드러나고,
 * 스키마 내용 자체는 tests/prompt.test.ts 와 스냅숏이 못박고 있다.
 */
export function viewRequest(params: Record<string, unknown>): RequestView {
  const messages = params.messages as Array<{ content?: unknown }> | undefined;
  const thinking = params.thinking as { type?: unknown } | undefined;
  return {
    model: String(params.model ?? ''),
    max_tokens: Number(params.max_tokens ?? 0),
    thinking: thinking?.type === undefined ? null : String(thinking.type),
    system: String(params.system ?? ''),
    user: String(messages?.[0]?.content ?? ''),
    keys: Object.keys(params).sort(),
  };
}

/**
 * 디버그 payload. **allowed 가 false 면 undefined 를 돌려준다.**
 *
 * 호출부는 `...(debug && { debug })` 로 펼치므로, 키가 없거나 틀리면 응답에 debug
 * 라는 키 자체가 생기지 않는다. 빈 객체를 돌려주면 그 사실만으로 키의 존재가
 * 드러나고, 완료 조건("키 없이는 아무것도 보이지 않는다")도 흐려진다.
 */
export function buildDebug(input: DebugInput): DebugPayload | undefined {
  if (!input.allowed) return undefined;
  return {
    input: {
      raw: input.raw,
      normalized: input.normalized,
      changed: input.raw !== input.normalized,
      hanja_count: input.hanjaCount,
      invisible: {
        raw: findInvisible(input.raw),
        normalized: findInvisible(input.normalized),
      },
    },
    cache: {
      key: input.cacheKey,
      version: ANALYSIS_VERSION,
      mode: input.mode,
      hit: input.cacheHit,
    },
    request: input.request ? viewRequest(input.request) : null,
    response: input.response ?? null,
    validate: input.validate ?? null,
  };
}
