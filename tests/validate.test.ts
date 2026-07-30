/**
 * 어순 재구성 검증 로직의 회귀 테스트 — 제품 코드를 직접 호출한다.
 *
 * 각 테스트에 "어떤 사고를 막는지" 한 줄로 적어 둔다. 이 판정 규칙들은 통제 실험을
 * 여러 차례 반복해서 얻은 것이고, 실험 이력이 없으면 나중에 왜 이렇게 되어 있는지
 * 알 수 없다. 특히 "이탈도 총량" 기준과 "0이 아니면 경고 유지" 정책은 그냥 보면
 * 지나치게 복잡해 보여서 단순화하고 싶어지는데, 단순화하면 과거 사고가 되살아난다.
 */
import { describe, it, expect } from 'vitest';
import {
  hanjaCountDiff,
  totalDeviation,
  judgeRepair,
  reconstructionWarning,
  describeDiff,
  inventory,
  repairPrompt,
} from '../src/lib/validate';

// ── 고정 자료 ────────────────────────────────────────────────────────────────

/** 실제로 프로덕션에서 실패했던 구절. 뒤 절에 없는 之를 만들어 넣는 사고가 났다. */
const P1 = '知之爲知之, 不知爲不知, 是知也';

/** P1 의 실제 실패 형태 — 뒤 절에 之를 끼워 넣어 앞 절과 모양을 맞추려 한 결과 */
const P1_之추가 =
  '[知(알)之(그것을)爲(라 하고)知(안다)之(그것을)]' +
  ' [不知(모르)之(그것을)爲(라 한다)不知(모른다)]' +
  ' [是(이것이)知(아는 것)也(이다)]';

/** P1 의 올바른 형태 — 뒤 절에 之가 없는 채로 둔 것 */
const P1_정답 =
  '[知(알)之(그것을)爲(라 하고)知(안다)之(그것을)]' +
  ' [不知(모르)爲(라 한다)不知(모른다)]' +
  ' [是(이것이)知(아는 것)也(이다)]';

/**
 * 之 개수만 다른 재구성들. 之 외의 글자 구성은 원문과 정확히 같게 맞춰 두었으므로,
 * 어긋남은 항상 "之 한 종류"뿐이고 총량만 달라진다. 수용 기준을 시험하는 핵심 자료다.
 */
const 원문 = '知之爲知之';
const 之2 = '[知(알)之(그것을) 爲(라 하고) 知(안다)之(그것을)]';
const 之3 = '[知(알)之(그것을) 爲(라 하고) 知(안다)之(그것을)之(그것을)]';
const 之4 = '[知(알)之(그것을)之(그것을) 爲(라 하고) 知(안다)之(그것을)之(그것을)]';
/** 之는 맞았으나 爲를 하나 더 쓴 경우 — 이탈도 총량이 之3 과 똑같이 1 이다 */
const 爲2 = '[知(알)之(그것을) 爲(라 하고)爲(라 하고) 知(안다)之(그것을)]';
/** 원문에 아예 없는 글자(也)를 넣은 경우 */
const 없는글자 = '[知(알)之(그것을) 爲(라 하고) 知(안다)之(그것을)也(이다)]';

// ── hanjaCountDiff ──────────────────────────────────────────────────────────

describe('hanjaCountDiff', () => {
  // 사고: 대구 구문에서 두 절의 모양을 맞추려고 뒤 절에 之를 만들어 넣었다.
  // 프롬프트 규칙을 네 차례 강화해도 막히지 않아 코드로 막기로 한 그 사례다.
  it('원문에 없는 之를 뒤 절에 만들어 넣으면 잡아낸다', () => {
    const diff = hanjaCountDiff(P1, P1_之추가);
    expect(diff).toEqual([{ hanja: '之', expected: 2, got: 3 }]);
  });

  // 사고 방지의 반대편: 올바른 재구성을 틀렸다고 하면 교정이 헛돌고 비용만 든다.
  it('올바른 재구성은 어긋남이 없다고 판정한다', () => {
    expect(hanjaCountDiff(P1, P1_정답)).toEqual([]);
  });

  // 사고: 모델이 원문에 없는 글자를 지어내는 경우. expected 0 으로 잡혀야 한다.
  it('원문에 없는 한자가 섞이면 expected 0 으로 잡아낸다', () => {
    expect(hanjaCountDiff(원문, 없는글자)).toEqual([{ hanja: '也', expected: 0, got: 1 }]);
  });

  /**
   * 사고: 한자 범위의 시작을 U+F900 이 아니라 豈(U+8C48) 로 잘못 적어, 잘못된 범위
   * U+8C48–U+FAFF 안에 한글 음절(U+AC00–U+D7A3)이 통째로 들어갔다. 그 결과 괄호 안의
   * 한국어 풀이("배우고")까지 한자로 세어져 개수 비교가 전부 망가졌다.
   * 두 한자는 눈으로 구별되지 않아 시각 검사로는 끝까지 못 찾았다.
   */
  it('괄호 안의 한국어 풀이를 한자로 세지 않는다', () => {
    expect(hanjaCountDiff('學而', '[學(배우)而(고)]')).toEqual([]);
  });

  it('빈 재구성은 원문의 모든 글자를 누락으로 잡는다', () => {
    const diff = hanjaCountDiff(원문, '');
    expect(totalDeviation(diff)).toBe(5); // 知2 + 之2 + 爲1
  });
});

// ── totalDeviation ─────────────────────────────────────────────────────────

describe('totalDeviation', () => {
  /**
   * 사고: 수용 기준이 처음에는 "완전 일치", 다음에는 "어긋난 글자 종류 수" 였다.
   * 之를 2→4 로 틀린 것을 2→3 으로 줄인 재생성은 두 기준 모두에서 버려졌다.
   * 종류 수로 보면 둘 다 "之 한 종류"라서 1 대 1 이 되기 때문이다.
   * 프로덕션에서 이탈도를 2→1 로 절반으로 줄인 교정이 실제로 거부된 것을 확인하고
   * 총량 기준으로 바꿨다. 이 테스트가 그 근거를 못 박는다.
   */
  it('종류 수로는 구별되지 않는 부분 개선을 구별한다', () => {
    const 나쁨 = hanjaCountDiff(원문, 之4);
    const 나음 = hanjaCountDiff(원문, 之3);

    // 종류 수는 똑같이 1 — 옛 기준으로는 개선을 알아볼 수 없었다
    expect(나쁨.length).toBe(1);
    expect(나음.length).toBe(1);

    // 총량은 다르다 — 새 기준은 개선을 알아본다
    expect(totalDeviation(나쁨)).toBe(2);
    expect(totalDeviation(나음)).toBe(1);
  });

  it('어긋남이 없으면 0 이다', () => {
    expect(totalDeviation(hanjaCountDiff(원문, 之2))).toBe(0);
  });

  it('여러 글자가 어긋나면 절댓값을 합한다', () => {
    expect(totalDeviation([
      { hanja: '之', expected: 2, got: 4 },
      { hanja: '爲', expected: 1, got: 0 },
    ])).toBe(3);
  });
});

// ── judgeRepair ────────────────────────────────────────────────────────────

describe('judgeRepair', () => {
  // 정책: 완전 일치가 아니라 "이탈도 총량이 줄었으면 수용".
  it('총량이 줄면 수용한다', () => {
    const v = judgeRepair(hanjaCountDiff(원문, 之4), hanjaCountDiff(원문, 之3));
    expect(v).toEqual({ accepted: true, exact: false, before: 2, after: 1 });
  });

  it('총량이 늘면 거부한다', () => {
    const v = judgeRepair(hanjaCountDiff(원문, 之3), hanjaCountDiff(원문, 之4));
    expect(v.accepted).toBe(false);
  });

  /**
   * 총량 기준은 이전보다 관대하므로, "다른 글자에서 새로 어긋나며 총량은 그대로"인
   * 옆걸음질까지 받아들이면 안 된다. 之 하나 틀림(1)과 爲 하나 틀림(1)은 총량이 같다.
   * 기준이 `a < b` 인지 `a <= b` 인지가 여기서 갈린다.
   */
  it('총량이 같으면 거부한다 — 다른 글자로 옮겨간 것은 개선이 아니다', () => {
    const before = hanjaCountDiff(원문, 之3);
    const after = hanjaCountDiff(원문, 爲2);
    expect(totalDeviation(before)).toBe(totalDeviation(after)); // 둘 다 1
    expect(judgeRepair(before, after).accepted).toBe(false);
  });

  it('완전히 맞으면 수용하고 exact 로 표시한다', () => {
    const v = judgeRepair(hanjaCountDiff(원문, 之3), hanjaCountDiff(원문, 之2));
    expect(v).toEqual({ accepted: true, exact: true, before: 1, after: 0 });
  });

  it('처음부터 어긋남이 없었으면 수용하지 않는다 — 교정할 것이 없다', () => {
    expect(judgeRepair([], []).accepted).toBe(false);
    expect(judgeRepair([], []).exact).toBe(true);
  });
});

// ── reconstructionWarning ──────────────────────────────────────────────────

describe('reconstructionWarning', () => {
  /**
   * 정책: "총량이 줄었으면 수용, 단 0이 아니면 경고는 계속 유지".
   *
   * 부분 개선된 결과를 버리지 않고 화면에 보여 주기로 했으므로, 화면에 나온 재구성이
   * 아직 원문과 다를 수 있다는 사실을 반드시 알려야 한다. "교정에 성공했으니 경고를
   * 끄자"는 판단이 이 정책을 깨뜨리는 가장 흔한 방향이다.
   */
  it('개선되었더라도 어긋남이 남아 있으면 경고한다', () => {
    const w = reconstructionWarning(hanjaCountDiff(원문, 之3), true);
    expect(w).not.toBeNull();
    expect(w).toContain('之');
  });

  it('개선되지 않았고 어긋남이 남아 있으면 경고한다', () => {
    expect(reconstructionWarning(hanjaCountDiff(원문, 之3), false)).not.toBeNull();
  });

  it('개선 여부에 따라 문구가 달라진다', () => {
    const diff = hanjaCountDiff(원문, 之3);
    expect(reconstructionWarning(diff, true)).not.toBe(reconstructionWarning(diff, false));
  });

  it('어긋남이 없으면 경고하지 않는다', () => {
    expect(reconstructionWarning([], true)).toBeNull();
    expect(reconstructionWarning([], false)).toBeNull();
  });
});

// ── describeDiff / inventory ───────────────────────────────────────────────

describe('describeDiff', () => {
  // 이 문구는 교정 요청 프롬프트에 그대로 들어간다. 모델이 무엇을 고쳐야 하는지
  // 아는 유일한 단서이므로, 개수와 글자가 모두 문장에 드러나야 한다.
  it('원문에 있는 글자의 개수 오류를 개수와 함께 설명한다', () => {
    expect(describeDiff([{ hanja: '之', expected: 2, got: 3 }]))
      .toBe('之는 원문에 2번인데 3번 썼습니다');
  });

  it('원문에 없는 글자는 다른 문구로 설명한다', () => {
    expect(describeDiff([{ hanja: '也', expected: 0, got: 1 }]))
      .toBe('也는 원문에 없는데 1번 썼습니다');
  });
});

describe('inventory', () => {
  it('원문의 글자 구성을 개수와 함께 나열한다', () => {
    expect(inventory(원문)).toBe('知×2, 之×2, 爲×1');
  });
});

// ── repairPrompt ───────────────────────────────────────────────────────────

describe('repairPrompt', () => {
  const prompt = repairPrompt(원문, 之3, hanjaCountDiff(원문, 之3));

  it('원문·직전 시도·오류 설명을 모두 담는다', () => {
    expect(prompt).toContain(원문);
    expect(prompt).toContain(之3);
    expect(prompt).toContain('之는 원문에 2번인데 3번 썼습니다');
  });

  // 사고: 부정사를 뒤 글자와 떼면 두 글자의 뜻이 서로 뒤바뀐다.
  // 예) 不(생각하지) 思(않으면) — 실제로 이렇게 나왔다.
  it('부정사를 뒤 글자와 붙여 쓰라는 규칙을 담는다', () => {
    expect(prompt).toContain('不思(생각하지 않으면)');
  });

  it('글자를 만들어 넣거나 빼지 말라는 금지를 담는다', () => {
    expect(prompt).toContain('만들어 넣거나 빼면 안 됩니다');
  });

  /**
   * 측정으로 제거한 문구가 되살아나지 않는지 본다.
   *
   * "두 절을 같은 형식으로 맞추라"는 취지의 대구·대칭 어휘를 교정 프롬프트에 넣었을 때
   * 오히려 회귀했다(측정: p1 1/2→0/2, p2 2/2→1/2). 대칭을 요구하니 모델이 원문에 없는
   * 글자를 만들어 넣었기 때문이다 — 교정으로 고치려는 문제를 교정 프롬프트가 유발했다.
   * 읽어 보면 "짝을 맞추라고 알려 주는 게 낫지 않나" 싶어 다시 넣고 싶어지는 자리다.
   */
  it('측정으로 제거한 대구·대칭 어휘가 되살아나지 않았다', () => {
    expect(prompt).not.toContain('대구');
    expect(prompt).not.toContain('대칭');
    expect(prompt).not.toContain('짝');
  });

  /**
   * 원문의 글자 구성표(知×2, 之×2 …)를 교정 프롬프트에 넣어 보았으나 수용률이 오르지
   * 않았고 입력 토큰만 늘었다. inventory() 는 그 실험의 잔존물로 남아 있을 뿐이므로,
   * 교정 프롬프트에 다시 끼워 넣지 않았는지 확인한다.
   */
  it('측정으로 제거한 글자 구성표가 되살아나지 않았다', () => {
    expect(prompt).not.toContain(inventory(원문));
  });
});
