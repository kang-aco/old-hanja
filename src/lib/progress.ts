/**
 * 학습 진도 — 브라우저 localStorage 에만 둔다.
 *
 * 이 앱에는 로그인이 없다(검색 기록조차 익명이다). 서버에 사용자를 식별할 방법이
 * 없으므로 진도를 D1 에 두면 누구의 것인지 알 수 없다. 그래서 기기 안에만 남긴다.
 * 대가로 기기를 바꾸거나 브라우저 저장소를 비우면 진도가 사라진다. 대신 계정도,
 * 서버 비용도, 개인정보 보관 책임도 생기지 않는다.
 *
 * 커리큘럼 목록(curriculum.astro)과 풀이 화면(index.astro)이 함께 쓴다.
 * 키 문자열을 양쪽에 각각 적으면 한쪽만 고쳐져 진도가 갈라지므로 여기서만 정의한다.
 */

/** 저장 키. 형식을 바꿀 때는 뒤의 판을 올려 옛 데이터와 섞이지 않게 한다. */
const KEY = 'hanmun:progress:v1';

export interface ProgressEntry {
  /** 사용자가 직접 "맞혔다"고 표시했는지 (자기채점이므로 판단은 사용자 몫이다) */
  done: boolean;
  /** 마지막으로 푼 시각 (ISO 8601) */
  at: string;
}

export type Progress = Record<string, ProgressEntry>;

/**
 * localStorage 는 두 가지로 던진다 — 서버 렌더링 중에는 존재하지 않고,
 * 사파리 프라이빗 모드 등에서는 접근 자체가 예외를 낸다. 진도는 부가 기능이므로
 * 어느 쪽이든 조용히 없는 것으로 취급하고 앱은 계속 동작해야 한다.
 */
function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function readProgress(): Progress {
  const s = store();
  if (!s) return {};
  try {
    const raw = s.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    // 손상된 값이나 다른 형식이 들어 있으면 빈 진도로 시작한다.
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Progress;
  } catch {
    return {};
  }
}

function write(p: Progress): void {
  const s = store();
  if (!s) return;
  try {
    s.setItem(KEY, JSON.stringify(p));
  } catch {
    /* 용량 초과 등은 무시한다 — 진도가 안 남을 뿐 앱은 계속 쓸 수 있다 */
  }
}

export function isDone(p: Progress, passage: string): boolean {
  return p[passage]?.done === true;
}

/** 한 구절을 푼 것으로 기록한다. 맞혔는지는 사용자가 스스로 판단한 값이다. */
export function markDone(passage: string, done = true): Progress {
  const p = readProgress();
  p[passage] = { done, at: new Date().toISOString() };
  write(p);
  return p;
}

export function clearProgress(): void {
  const s = store();
  if (!s) return;
  try {
    s.removeItem(KEY);
  } catch {
    /* 무시 */
  }
}

/** 완료 건수 — 목록에 남아 있는 구절만 센다(시드가 바뀌어 사라진 구절은 제외). */
export function countDone(p: Progress, passages: string[]): number {
  return passages.reduce((n, t) => n + (isDone(p, t) ? 1 : 0), 0);
}
