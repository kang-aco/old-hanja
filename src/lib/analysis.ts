/**
 * 구문독해 분석 — 프롬프트 · JSON 스키마 · 타입
 *
 * PRD 의 4개 탭(풀이 / 방법론 / 연관 콘텐츠 / 부수 암기)에 필요한 데이터를
 * 한 번의 LLM 호출로 모두 받아온다. Structured Outputs 로 형태를 강제한다.
 *
 * ※ 비용 정책 (중요) — 실측 기준
 *  - 기본(light): claude-haiku-4-5, 사고 토큰 없음 → 1건당 약 $0.011 (약 15~16원)
 *  - 정밀(deep):  claude-sonnet-5, 사고 토큰 없음 → 1건당 약 $0.039 (약 54원)
 *  - 캐시 히트:   0원. 같은 구절은 D1 에서 꺼내므로 두 번째 조회부터 무료다.
 *  - 스키마 description 을 최소화해 고정 입력 오버헤드를 4.9k → 2.6k 토큰으로 줄였다.
 *  - 배열 개수와 문장 길이를 프롬프트로 못박고, max_tokens 로 하드 캡을 둔다.
 *  - MAX_DAILY_ANALYSES(기본 50)로 하루 지출 상한을 건다 (최악 약 800원/일).
 */

// ── 모델 티어 ───────────────────────────────────────────────────────────────

/** 기본: 가장 저렴한 티어. $1 / $5 per MTok */
export const MODEL_LIGHT = 'claude-haiku-4-5';
/** 정밀: 어려운 구절용. $3 / $15 per MTok (2026-08-31 까지 도입가 $2 / $10) */
export const MODEL_DEEP = 'claude-sonnet-5';

export type Mode = 'light' | 'deep';

/** 1M 토큰당 단가 (USD) — 응답에 예상 비용을 표시하는 데만 사용 */
export const PRICING: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5': { input: 1.0, output: 5.0 },
  'claude-sonnet-5': { input: 3.0, output: 15.0 },
  'claude-opus-5': { input: 5.0, output: 25.0 },
};

/**
 * 출력 예산 — 입력 길이에 비례해서 잡는다.
 *
 * 글자별 분해(word_breakdown)를 없앤 뒤로는 어순 재구성과 번역문만 길이에 비례한다.
 * 실측(한자 9자→784, 62자→1616, 136자→2401 토큰)에서 얻은 근사식:
 *     필요 출력 ≈ 700 + 15 × 한자수  (UI 예상치는 약간 넉넉하게 잡는다)
 * 여기에 약 60% 여유를 둔다. 캡 12000 은 입력 상한에서도 걸리지 않는 안전장치다.
 *
 * 참고: 글자별 분해가 있던 시절은 75 × 한자수 였다. 그것이 비용·지연·입력상한의
 * 주된 원인이었고, 제거 후 출력이 약 1/5 로 줄었다.
 */
export function maxTokensFor(mode: Mode, hanjaCount: number): number {
  const base = mode === 'deep' ? 1400 : 1000;
  return Math.min(12000, Math.round(base + hanjaCount * 22));
}

/** UI 에 표시할 예상 비용(USD). 실제 과금은 응답의 usage 로 다시 계산한다. */
export function predictCostUsd(mode: Mode, hanjaCount: number): number {
  const model = mode === 'deep' ? MODEL_DEEP : MODEL_LIGHT;
  const inputTokens = 1750; // 시스템 프롬프트 + 스키마 고정 오버헤드
  const outputTokens = 700 + 15 * hanjaCount;
  return estimateCostUsd(model, inputTokens, outputTokens);
}

export function resolveModel(mode: Mode, env: Partial<Env>): string {
  if (mode === 'deep') return env.ANTHROPIC_MODEL_DEEP || MODEL_DEEP;
  return env.ANTHROPIC_MODEL || MODEL_LIGHT;
}

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICING[model] ?? PRICING['claude-haiku-4-5']!;
  return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
}

// ── 타입 ────────────────────────────────────────────────────────────────────

export interface Technique {
  technique: string;
  explanation: string;
  example: string;
}

export interface RelatedIdiom {
  idiom: string;
  eum: string;
  meaning: string;
  source: string;
  connection: string;
}

export interface RelatedPassage {
  passage: string;
  eum: string;
  source: string;
  modern_korean: string;
  context: string;
}

export interface Analysis {
  original: string;
  eum: string;
  source_guess: {
    book: string;
    chapter: string;
    confidence: 'high' | 'medium' | 'low' | 'unknown';
    note: string;
  };
  word_order_reconstruction: string;
  modern_korean: string;
  english_translation: string;
  methodology: Technique[];
  related_idioms: RelatedIdiom[];
  related_passages: RelatedPassage[];
}

export interface AnalyzeMeta {
  model: string;
  mode: Mode;
  cached: boolean;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

// ── 시스템 프롬프트 ─────────────────────────────────────────────────────────
// 짧게 유지한다 = 매 호출 입력 토큰이 줄어든다.

export const SYSTEM_PROMPT = `당신은 한문 고전 번역 전문가입니다. 한문 구절을 영어 구문독해처럼 단계별로 분해해 설명합니다.

[각 필드]
- eum: 원문 전체의 한글 독음. 예) 학이시습지 불역열호
- source_guess: 확실할 때만 book/chapter 를 채웁니다. 모르면 confidence="unknown", book="미상", chapter="". note 는 이체자·판본 메모(없으면 "").
- word_order_reconstruction: 이 분석의 핵심입니다. 한국어 어순으로 재배열하되 한자를 괄호와 함께 남겨 어느 글자가 어디로 갔는지 보이게 씁니다. 허사(之 而 於 以 者 所 則 乎 也 矣 焉)의 기능을 괄호 안에 드러내십시오. 빈 괄호를 남기지 마십시오.
  예) [學(배운 것)을 時(때때로) 習(익히)而(고)] 不亦(어찌 ~않으랴) 說(기쁘)乎(겠는가)
  구절이 길면 문장 단위로 줄을 나눕니다.
- methodology: 이 구절에 실제로 적용된 기법만 정확히 2개. 일반론 나열 금지. example 은 구절 안의 짧은 예.
- related_idioms 2개, related_passages 2개. connection/context 에 왜 연관되는지 밝힙니다.

[금지]
- 원문의 글자를 고치지 마십시오.
- 없는 출전·없는 명구를 지어내지 마십시오. 확실하지 않으면 널리 알려진 것만 쓰십시오.

[분량 — 반드시 지킬 것]
- 설명 필드(explanation, connection, context, note)는 한 문장, 45자 이내.
- meaning 은 단어나 짧은 구.
- 같은 내용을 여러 필드에서 되풀이하지 마십시오.
- 지정된 개수를 초과하지 마십시오. 많이 쓰는 것보다 정확한 것이 좋은 답입니다.

[문체] 한국어. 고등학생이 읽을 수 있는 평이한 문장.

[한문이 아닌 입력] modern_korean 에 분석할 수 없는 이유를 한 문장으로 적고, 배열 필드는 모두 빈 배열로 두십시오.`;

// ── Structured Outputs 스키마 ──────────────────────────────────────────────
// 제약: 모든 object 는 additionalProperties:false + 전 속성 required.
//       minLength / maxItems 등 수치 제약은 미지원 → 프롬프트로 통제한다.

// 스키마 설명문(description)은 매 요청의 입력 토큰으로 과금되므로 최소한만 남긴다.
// 세부 규칙은 위 SYSTEM_PROMPT 에서 한 번만 지시한다.

const obj = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

const S = { type: 'string' };
const arr = (items: unknown) => ({ type: 'array', items });

export const ANALYSIS_SCHEMA = obj({
  original: S,
  eum: S,
  source_guess: obj({
    book: S,
    chapter: S,
    confidence: { type: 'string', enum: ['high', 'medium', 'low', 'unknown'] },
    note: S,
  }),
  word_order_reconstruction: S,
  modern_korean: S,
  english_translation: S,
  methodology: arr(obj({ technique: S, explanation: S, example: S })),
  related_idioms: arr(obj({ idiom: S, eum: S, meaning: S, source: S, connection: S })),
  related_passages: arr(obj({ passage: S, eum: S, source: S, modern_korean: S, context: S })),
});

/** 원문 정규화 — 캐시 키 계산에 사용 */
export function normalize(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/[​-‍﻿]/g, '')
    .trim();
}

// 한자 판별은 src/lib/hanja.ts 한 곳에서만 정의한다 (범위 오류 재발 방지).
export { hasHanja } from './hanja';
