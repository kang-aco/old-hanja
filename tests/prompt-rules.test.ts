/**
 * 프롬프트 규칙이 살아 있는지 확인하는 테스트.
 *
 * ── 이 파일이 검사하지 않는 것 ─────────────────────────────────────────────
 * AI 출력의 정확성은 검사하지 않는다. 출력은 매번 문장이 달라지므로 여기서 고정할 수
 * 없다. 이 파일이 막는 것은 "통제 실험으로 얻은 규칙이 프롬프트에서 조용히 사라지는
 * 것" 하나뿐이다. 실제로 프롬프트의 few-shot 예시에서 之 한 글자가 빠진 탓에 모델이
 * 그 결함 템플릿을 충실히 모방한 일이 있었고, 그것이 이 프로젝트 최대의 정확도 발견이다.
 *
 * ── 프롬프트를 고쳤을 때 ───────────────────────────────────────────────────
 * 프롬프트를 의도적으로 개선했다면 이 테스트도 함께 갱신하는 것이 정상이다.
 * 실패가 곧 잘못을 뜻하지 않는다. 검사 대상을 문장이 아니라 핵심 토큰으로 줄여 둔 것도
 * 정당한 개선 때마다 깨지지 않게 하기 위한 것이다. 다만 갱신할 때는 "그 규칙이 왜
 * 있었는지"를 확인하고 지우십시오 — 위 之 사례가 그렇게 사라졌다.
 */
import { describe, it, expect } from 'vitest';
import {
  SYSTEM_PROMPT,
  ANALYSIS_SCHEMA,
  ANALYSIS_VERSION,
  maxTokensFor,
  predictCostUsd,
} from '../src/lib/analysis';
import { HANJA_CLASS } from '../src/lib/hanja';
import { hanjaCountDiff } from '../src/lib/validate';

// ── 규칙 존재 확인 — 핵심 토큰만 ────────────────────────────────────────────

/**
 * 각 항목은 [규칙 이름, 찾을 토큰, 그 규칙이 없을 때 실제로 났던 사고].
 * 토큰은 일부러 짧게 잡았다. 문장 전체를 박아 두면 표현을 다듬을 때마다 깨진다.
 */
const 규칙: [string, string, string][] = [
  ['不 독음 — ㄷ·ㅈ 앞에서는 부', '(부지)', '不知를 "불지"로 읽었다'],
  ['不 독음 — 그 밖에서는 불', '(불역)', '不亦을 "부역"으로 읽었다'],
  ['부정사 붙여쓰기', '부정사', '不(생각하지) 思(않으면) — 두 글자의 뜻이 뒤바뀌었다'],
  ['"한자(풀이)" 표기 순서', '한자(풀이)', '익히면(習) 처럼 뒤집어 썼다'],
  ['대괄호는 절 단위', '절(節)', '글자마다 대괄호를 씌워 읽을 수 없었다'],
  ['원문 충실이 대칭보다 우선', '원문 충실', '대구의 모양을 맞추려고 없는 글자를 만들어 넣었다'],
  ['之는 목적어일 때 대명사로', '그것을', '之(할)·之(~을) 처럼 어미로 풀었다'],
];

describe('프롬프트 규칙이 살아 있다', () => {
  for (const [이름, 토큰, 사고] of 규칙) {
    it(`${이름} — 없으면: ${사고}`, () => {
      expect(SYSTEM_PROMPT).toContain(토큰);
    });
  }
});

// ── few-shot 예시 자체 검사 ─────────────────────────────────────────────────

/**
 * 프롬프트에 실린 예시를 뽑아내서, 그 예시가 프롬프트 자신이 가르치는 불변조건을
 * 만족하는지 본다. 예시 문자열을 테스트에 베껴 두지 않으므로 표현을 다듬어도 깨지지
 * 않고, 예시가 규칙을 위반하는 순간에만 깨진다. 바로 之 누락 사고의 형태다.
 */
function fewShotPairs(): { source: string; reconstruction: string }[] {
  const lines = SYSTEM_PROMPT.split('\n');
  const pairs: { source: string; reconstruction: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(/예\)\s*(.+)$/);
    if (!m) continue;

    // "예) 知之爲知之, 不知爲不知 — 앞 절에는 …" 처럼 설명이 붙은 경우 원문만 남긴다
    const source = m[1]!.split(' — ')[0]!.trim();

    // 다음 줄이 화살표로 시작할 때만 재구성이 딸린 예시다
    const next = (lines[i + 1] ?? '').trim();
    if (!next.startsWith('→')) continue;

    let reconstruction = next.slice(1).trim();
    // 절이 여러 줄로 이어지는 경우 이어 붙인다
    for (let j = i + 2; j < lines.length; j++) {
      const t = (lines[j] ?? '').trim();
      if (!t.startsWith('[')) break;
      reconstruction += ' ' + t;
    }
    pairs.push({ source, reconstruction });
  }
  return pairs;
}

const pairs = fewShotPairs();

// 정규식은 한자 범위를 조합해서 만든다 (범위 정의를 두 곳에 두지 않기 위해).
/** 한글 바로 뒤에 한자가 담긴 괄호가 오는 형태 — 예) 익히면(習) */
const REVERSED = new RegExp(`[가-힣]\\(${HANJA_CLASS}`);
/** 부정사 뒤에 한자가 오지 않는 형태 — 예) 不(생각하지) 思(않으면) */
const LOOSE_NEGATIVE = new RegExp(`[不未非勿](?!${HANJA_CLASS})`);

describe('few-shot 예시', () => {
  /**
   * 추출이 조용히 실패하면 아래 검사들이 0건을 돌면서 전부 통과한다. 그것이 이 파일에서
   * 가장 위험한 고장 방식이므로 먼저 막는다.
   */
  it('예시를 최소 2개 뽑아냈다 — 추출이 조용히 실패하지 않았다', () => {
    expect(pairs.length).toBeGreaterThanOrEqual(2);
  });

  /**
   * 사고: 예시가 學而時習之를 "[學(배우)而(고) 時(때때로) 習(익히면)]" 으로 之를 빼고
   * 보여 주었다. 모델은 지시가 아니라 예시를 따르므로, 예시가 틀리면 출력도 틀린다.
   * 프롬프트 규칙을 아무리 강화해도 잡히지 않던 오류의 진짜 원인이었다.
   */
  it.each(pairs)('원문의 글자가 빠짐없이 나타난다 — $source', ({ source, reconstruction }) => {
    expect(hanjaCountDiff(source, reconstruction)).toEqual([]);
  });

  it.each(pairs)('빈 괄호를 남기지 않는다 — $source', ({ reconstruction }) => {
    expect(reconstruction).not.toMatch(/\(\s*\)/);
  });

  it.each(pairs)('"풀이(한자)" 로 뒤집혀 있지 않다 — $source', ({ reconstruction }) => {
    expect(reconstruction).not.toMatch(REVERSED);
  });

  it.each(pairs)('대괄호 짝이 맞는다 — $source', ({ reconstruction }) => {
    const open = (reconstruction.match(/\[/g) ?? []).length;
    const close = (reconstruction.match(/\]/g) ?? []).length;
    expect(open).toBe(close);
    expect(open).toBeGreaterThan(0);
  });

  it.each(pairs)('부정사가 뒤 글자와 붙어 있다 — $source', ({ reconstruction }) => {
    expect(reconstruction).not.toMatch(LOOSE_NEGATIVE);
  });
});

/**
 * 위 두 정규식은 "매치되지 않아야 한다" 쪽으로만 쓰이므로, 조합이 잘못되어 아무것도
 * 매치하지 못하면 조용히 전부 통과한다. 실제로 정규식을 조합했다가 조용히 매치에
 * 실패한 일이 있었으므로 대조군을 둔다.
 */
describe('대조군 — 조합한 정규식이 실제로 위반을 잡아낸다', () => {
  it('뒤집힌 표기를 잡아낸다', () => {
    expect('익히면(習)').toMatch(REVERSED);
    expect('習(익히면)').not.toMatch(REVERSED);
  });

  it('떨어진 부정사를 잡아낸다', () => {
    expect('不(생각하지) 思(않으면)').toMatch(LOOSE_NEGATIVE);
    expect('不思(생각하지 않으면)').not.toMatch(LOOSE_NEGATIVE);
  });
});

// ── 비용·예산 관련 불변조건 ─────────────────────────────────────────────────

describe('출력 예산', () => {
  /**
   * 사고: max_tokens 를 4000 으로 고정해 두어 긴 구절의 응답이 중간에 잘렸다.
   * 잘린 JSON 은 파싱에 실패해 분석 자체가 실패했다.
   */
  it('한자 수가 늘면 예산도 늘어난다', () => {
    expect(maxTokensFor('light', 100)).toBeGreaterThan(maxTokensFor('light', 10));
  });

  it('정밀 모드가 기본 모드보다 예산이 크다', () => {
    expect(maxTokensFor('deep', 50)).toBeGreaterThan(maxTokensFor('light', 50));
  });

  // 상한이 없으면 입력 길이에 따라 비용이 무한정 늘어난다.
  it('상한을 넘지 않는다', () => {
    expect(maxTokensFor('deep', 100_000)).toBe(12_000);
  });
});

describe('비용 모델', () => {
  it('정밀 모드가 기본 모드보다 비싸다', () => {
    expect(predictCostUsd('deep', 20)).toBeGreaterThan(predictCostUsd('light', 20));
  });

  it('구절이 길면 비용 예측도 커진다', () => {
    expect(predictCostUsd('light', 100)).toBeGreaterThan(predictCostUsd('light', 10));
  });

  /**
   * 사고: 글자별 분해(word_breakdown)가 출력 토큰의 대부분을 차지해 1건당 약 50원이
   * 들었다. 제거해서 약 19원으로 내렸다. 다시 들어오면 비용이 그대로 되돌아간다.
   */
  it('글자별 분해가 되살아나지 않았다', () => {
    expect(Object.keys(ANALYSIS_SCHEMA.properties)).not.toContain('word_breakdown');
    expect(SYSTEM_PROMPT).not.toContain('word_breakdown');
  });
});

describe('ANALYSIS_VERSION', () => {
  /**
   * 사고: 캐시 키에 버전이 없어서, 교정 로직을 고쳐 배포했는데도 이미 분석된 구절은
   * 낡은 결과를 영구히 돌려주었다. 개선이 사용자에게 닿지 않았고 검증 자체가 막혔다.
   * (캐시 키 조립을 한 곳으로 모으는 일은 4단계에서 한다. 여기서는 값의 존재만 본다.)
   */
  it('빈 값이 아니다', () => {
    expect(typeof ANALYSIS_VERSION).toBe('string');
    expect(ANALYSIS_VERSION.length).toBeGreaterThan(0);
  });
});
