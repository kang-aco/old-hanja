/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

interface Env {
  /** D1 — 고사성어 / 부수 / 한자 / 검색기록 / 분석 캐시 */
  DB: D1Database;
  /** R2 — 폰트 / 에셋 / PDF 내보내기 (Phase 4~5, 선택) */
  R2?: R2Bucket;
  /** Anthropic API 키 (Pages 환경변수 또는 .dev.vars) */
  ANTHROPIC_API_KEY: string;
  /** 기본(저비용) 모델 오버라이드. 기본값 claude-haiku-4-5 */
  ANTHROPIC_MODEL?: string;
  /** 정밀 분석 모델 오버라이드. 기본값 claude-sonnet-5 */
  ANTHROPIC_MODEL_DEEP?: string;
  /** 어순 재구성 교정에만 쓸 모델. 미설정 시 본 분석과 같은 모델을 쓴다 */
  ANTHROPIC_MODEL_REPAIR?: string;
  /** 하루 최대 API 호출 수 (캐시 미스만 계산). 기본값 50 */
  MAX_DAILY_ANALYSES?: string;
}

type Runtime = import('@astrojs/cloudflare').Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {}
}
