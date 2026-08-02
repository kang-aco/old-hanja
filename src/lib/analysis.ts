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

/**
 * 분석 로직의 버전. 캐시 키에 포함된다.
 *
 * 프롬프트·스키마·교정 로직을 바꿀 때마다 올리십시오. 올리지 않으면 이미 분석된
 * 구절은 낡은 결과가 영구히 서빙되어 개선이 사용자에게 닿지 않습니다.
 * 실제로 그 일이 있었습니다 — 교정 로직을 고쳐 배포했는데도 프로덕션의 p1 이
 * 수정 전 캐시(cached=true, 0원)를 그대로 돌려주어 검증 자체가 막혔습니다.
 *
 * 올리면 기존 캐시가 자연히 무효가 되고(키가 달라져 캐시 미스), 다음 조회 때
 * 새로 분석됩니다. 낡은 행은 남지만 용량이 작아 그대로 두어도 무해합니다.
 */
export const ANALYSIS_VERSION = 'v3-repair-budget';

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

/**
 * 어순 재구성 재생성(교정)에 쓸 모델.
 *
 * 기본값은 본 분석과 같은 모델이다. 교정만 더 좋은 모델로 올리는 실험을 위해
 * ANTHROPIC_MODEL_REPAIR 로 따로 지정할 수 있게 열어 두었다. 기본값이 분석 모델과
 * 같으므로, 이 값을 설정하지 않으면 동작이 달라지지 않는다.
 */
export function resolveRepairModel(analysisModel: string, env: Partial<Env>): string {
  return env.ANTHROPIC_MODEL_REPAIR || analysisModel;
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

// ── 프롬프트·스키마는 src/lib/prompt.ts 로 옮겼다 ─────────────────────────
// 프롬프트 조립을 순수 함수로 격리하기 위한 층 분리다. 이 파일에는 타입·모델 선택·
// 단가·출력 예산·정규화만 남는다. prompt.ts 가 이 파일을 참조하므로(maxTokensFor, Mode),
// 반대 방향으로 import 하면 순환 참조가 된다. 이 파일은 prompt.ts 를 import 하지 않는다.

/** 원문 정규화 — 캐시 키 계산에 사용 */
export function normalize(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/[​-‍﻿]/g, '')
    .trim();
}

// 한자 판별은 src/lib/hanja.ts 한 곳에서만 정의한다 (범위 오류 재발 방지).
export { hasHanja } from './hanja';
