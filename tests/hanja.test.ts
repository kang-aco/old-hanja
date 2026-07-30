/**
 * 한자 판별 회귀 테스트.
 *
 * 사고 이력: 한자 범위를 리터럴 한자로 적다가 CJK 호환 한자의 시작을 U+F900 이 아니라
 * U+8C48 로 잘못 썼다. 잘못된 범위 U+8C48–U+FAFF 안에 한글 음절(U+AC00–U+D7A3)이
 * 통째로 들어가, 한글까지 한자로 판정되어 어순 재구성의 한국어 풀이("배우고")에
 * 사전 팝업이 열렸고 한자 개수 검증도 함께 망가졌다.
 *
 * U+8C48 과 U+F900 은 눈으로 구별되지 않는다. 그래서 시각 검사로는 끝까지 찾지 못했고,
 * 이 테스트가 그 역할을 대신한다.
 *
 * 그런 이유로 이 파일에서 경계 글자는 반드시 코드포인트 숫자로 적는다. 리터럴로 적으면
 * 테스트 쪽에서 같은 실수를 되풀이하면서 통과해 버린다.
 */
import { describe, it, expect } from 'vitest';
import { HANJA_CLASS, hasHanja, extractHanja, isSingleHanja } from '../src/lib/hanja';

const ONE = new RegExp(HANJA_CLASS);
const ch = (cp: number) => String.fromCodePoint(cp);

describe('HANJA_CLASS 표기', () => {
  /**
   * 범위를 리터럴 한자로 적는 것이 사고의 직접 원인이었다. \u 이스케이프로만 적으면
   * 범위가 눈에 보이고 오타가 검토에서 걸린다. ASCII 인쇄 가능 문자만 쓰였는지 본다.
   */
  it('\\u 이스케이프로만 적혀 있다 — 리터럴 한자를 쓰지 않는다', () => {
    expect(HANJA_CLASS).toContain('\\u');
    expect(HANJA_CLASS).toMatch(/^[\x20-\x7e]+$/);
  });

  // 아래 "매치되지 않아야 한다" 검사들이 정규식이 아무것도 매치하지 못해서 통과하는
  // 경우를 막는 대조군이다. 과거에 조합한 정규식이 조용히 아무것도 매치하지 못한
  // 일이 있었으므로 대조군을 반드시 함께 둔다.
  it('대조군 — 조합한 정규식이 실제로 한자를 매치한다', () => {
    expect(ONE.test(ch(0x5b78))).toBe(true); // 學
  });
});

describe('한글을 한자로 판정하지 않는다', () => {
  // 사고: 잘못된 범위가 한글 음절 영역을 통째로 삼켰다.
  it('한글 음절 영역의 양 끝을 매치하지 않는다', () => {
    expect(hasHanja(ch(0xac00))).toBe(false); // 음절 영역 시작
    expect(hasHanja(ch(0xd7a3))).toBe(false); // 음절 영역 끝
  });

  it('어순 재구성에 쓰이는 한국어 풀이를 매치하지 않는다', () => {
    expect(hasHanja('배우고')).toBe(false);
    expect(hasHanja('생각하지 않으면')).toBe(false);
    expect(hasHanja('그것을')).toBe(false);
  });

  it('공백·괄호·라틴 문자·숫자를 매치하지 않는다', () => {
    expect(hasHanja(' ()[]')).toBe(false);
    expect(hasHanja('abc')).toBe(false);
    expect(hasHanja('123')).toBe(false);
  });
});

describe('한자 범위', () => {
  it('세 범위의 경계 글자를 모두 매치한다', () => {
    expect(hasHanja(ch(0x3400))).toBe(true); // 확장 A 시작
    expect(hasHanja(ch(0x4dbf))).toBe(true); // 확장 A 끝
    expect(hasHanja(ch(0x4e00))).toBe(true); // 통합 한자 시작
    expect(hasHanja(ch(0x9fff))).toBe(true); // 통합 한자 끝
    expect(hasHanja(ch(0xf900))).toBe(true); // 호환 한자 시작
    expect(hasHanja(ch(0xfaff))).toBe(true); // 호환 한자 끝
  });

  /**
   * U+8C48 자체는 통합 한자 영역 안이라 한자로 판정되는 것이 맞다. 문제는 이 글자를
   * 호환 한자 범위의 *시작*으로 삼았을 때 범위가 U+8C48–U+FAFF 로 벌어져 한글이 그
   * 안에 들어가 버린다는 것이다. 위의 한글 검사와 이 검사가 함께 그 조합을 잡는다.
   */
  it('U+8C48 은 통합 한자로서 정상 판정된다', () => {
    expect(hasHanja(ch(0x8c48))).toBe(true);
  });

  // 확장 B 이상은 서로게이트 쌍이라 별도 처리가 필요하고 고전 구절에 거의 없어서
  // 일부러 뺐다. 뺀 것이 실수가 아니라 결정임을 기록한다.
  it('확장 B(U+20000~)는 일부러 매치하지 않는다', () => {
    expect(hasHanja(ch(0x20000))).toBe(false);
  });
});

describe('extractHanja', () => {
  /**
   * 이 함수의 결과가 한자 개수 검증의 입력이다. 괄호 안 한국어가 섞여 들어오면
   * 개수 비교가 통째로 무의미해진다. 사고가 났던 지점이 정확히 여기다.
   */
  it('괄호 안의 한국어 풀이를 걸러낸다', () => {
    expect(extractHanja('學(배우고)')).toEqual(['學']);
    expect(extractHanja('[學(배우)而(고) 時(때때로)]')).toEqual(['學', '而', '時']);
  });

  it('원문 순서를 지키고 중복을 제거하지 않는다', () => {
    expect(extractHanja('知之爲知之')).toEqual(['知', '之', '爲', '知', '之']);
  });

  it('한자가 없으면 빈 배열을 준다', () => {
    expect(extractHanja('한글만 있습니다')).toEqual([]);
  });
});

describe('isSingleHanja', () => {
  // 사전 팝업을 열지 말지 결정하는 데 쓰인다. 두 글자 이상이면 열지 않아야 한다.
  it('한자 한 글자일 때만 참이다', () => {
    expect(isSingleHanja('學')).toBe(true);
    expect(isSingleHanja('學而')).toBe(false);
    expect(isSingleHanja('배')).toBe(false);
    expect(isSingleHanja('')).toBe(false);
    expect(isSingleHanja('學(배우)')).toBe(false);
  });
});
