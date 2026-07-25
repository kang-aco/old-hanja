/**
 * 어순 재구성 검증 — 원문의 한자가 그대로 다 쓰였는지 결정론적으로 확인한다.
 *
 * 왜 필요한가: 대구(對句) 구문에서 모델이 두 절의 모양을 맞추려고 원문에 없는
 * 글자를 만들어 넣는 일이 있다. 대표 사례가 知之爲知之, 不知爲不知 로,
 * 앞 절에는 之가 두 번 있고 뒤 절에는 하나도 없는데 뒤 절에 之를 끼워 넣는다.
 *
 * 실측: 프롬프트 규칙을 네 차례 강화해도 Haiku 는 3/3 실패, Sonnet 도 1/3 실패했다.
 * 지시로는 막히지 않으므로 코드로 막는다. 이 검사는 우회되지 않고 비용도 0 이다.
 */
import { extractHanja } from './hanja';

export interface CountMismatch {
  hanja: string;
  expected: number;
  got: number;
}

function tally(text: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of extractHanja(text)) m.set(c, (m.get(c) ?? 0) + 1);
  return m;
}

/**
 * 원문과 재구성의 한자 개수를 비교한다.
 * 재구성의 풀이는 한글이므로, 한자 개수는 원문과 정확히 같아야 한다.
 */
export function hanjaCountDiff(original: string, reconstruction: string): CountMismatch[] {
  const src = tally(original);
  const got = tally(reconstruction);
  const diff: CountMismatch[] = [];

  for (const [hanja, expected] of src) {
    const g = got.get(hanja) ?? 0;
    if (g !== expected) diff.push({ hanja, expected, got: g });
  }
  // 원문에 없는 한자가 들어간 경우도 잡는다
  for (const [hanja, g] of got) {
    if (!src.has(hanja)) diff.push({ hanja, expected: 0, got: g });
  }
  return diff;
}

/**
 * 어긋난 정도의 총합. 수용 판정에 쓴다.
 * 어긋난 "글자 종류 수"로 비교하면 之 하나만 틀린 경우 항상 1 대 1 이 되어
 * 부분 개선(2→4 를 2→3 으로)을 받아들일 수 없었다.
 */
export function totalDeviation(diff: CountMismatch[]): number {
  return diff.reduce((sum, d) => sum + Math.abs(d.expected - d.got), 0);
}

/** 원문의 글자 구성표 — 재생성 시 맞춰야 할 목표를 명시적으로 알려 준다 */
export function inventory(original: string): string {
  const src = tally(original);
  return [...src.entries()].map(([c, n]) => `${c}×${n}`).join(', ');
}

/** 재생성 요청에 넣을 사람이 읽을 수 있는 오류 설명 */
export function describeDiff(diff: CountMismatch[]): string {
  return diff
    .map((d) =>
      d.expected === 0
        ? `${d.hanja}는 원문에 없는데 ${d.got}번 썼습니다`
        : `${d.hanja}는 원문에 ${d.expected}번인데 ${d.got}번 썼습니다`,
    )
    .join('. ');
}

/** 어순 재구성만 다시 만들기 위한 최소 스키마 — 출력 토큰을 아낀다 */
export const REPAIR_SCHEMA = {
  type: 'object',
  properties: { word_order_reconstruction: { type: 'string' } },
  required: ['word_order_reconstruction'],
  additionalProperties: false,
};

export function repairPrompt(original: string, previous: string, diff: CountMismatch[]): string {
  return `한문 구절의 어순 재구성을 다시 작성하십시오.

원문: ${original}

직전 시도: ${previous}

문제: ${describeDiff(diff)}.

규칙
- 원문에 있는 한자만, 원문에 나온 횟수만큼 정확히 쓰십시오. 만들어 넣거나 빼면 안 됩니다.
- "한자(풀이)" 순서로 씁니다. 예) 習(익히면)
- 부정사 不·未·非·勿는 뒤 글자와 붙여 한 덩어리로 씁니다. 예) 不思(생각하지 않으면)
- 절이 여럿이면 절마다 대괄호를 따로 씌우십시오. 절마다 글자 수와 구성이 다를 수
  있으니, 원문에 있는 그대로만 쓰십시오.
- 한국어 어순으로 배열하고, 목적어 之는 동사 앞으로 옮겨 "그것을"로 풉니다.`;
}
