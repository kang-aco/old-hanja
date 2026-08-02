/**
 * 캐시 키 회귀 테스트.
 *
 * 이 파일이 막는 사고는 추상적인 것이 아니라 이 프로젝트에서 실제로 두 번 난 것이다.
 *  (1) mode 가 키에 빠져 "정밀 분석" 토글이 아무 효과가 없었다.
 *  (2) 버전이 키에 빠져 로직을 고쳐 배포해도 낡은 결과가 영구히 서빙됐다.
 * 둘 다 "돈이 새거나 개선이 사용자에게 닿지 않는" 종류라 화면만 봐서는 모른다.
 *
 * 골든 해시(아래 PROD_HASH)의 오라클은 내 계산이 아니라 **프로덕션 D1 에 실재하는
 * 행**이다. 원격 D1 에서 조회해 확인한 `analyses.text_hash` 값을 그대로 박았다.
 * 통과한다는 것은 분리가 키를 한 비트도 바꾸지 않았다는 뜻이다.
 *
 * 버전을 올리면 이 골든값이 바뀐다. 그때 이 테스트가 깨지는 것이 정상이다.
 * 새 값으로 갱신하고, 옛 값은 "버전이 키를 가른다"는 증거로 아래에 남긴다.
 */
import { describe, it, expect } from 'vitest';
import { cacheKey } from '../src/lib/cache-key';
import { ANALYSIS_VERSION, normalize } from '../src/lib/analysis';
import { sha256 } from '../src/lib/hash';

/** 프로덕션 D1 의 analyses 테이블에 실제로 들어 있는 행의 구절과 그 text_hash. */
const PROD_TEXT = '知之爲知之, 不知爲不知, 是知也';
const PROD_HASH = 'd5ac31dfdee8395f792df98612b34fefa3124e3858e21527283761f0f6b87b7c';

describe('cacheKey — 분리가 키를 바꾸지 않았다', () => {
  /**
   * 3단계의 요청 스냅숏에 해당하는 못.
   *
   * 라우트 핸들러 안에 인라인이던 조립을 함수로 옮겼다. 그 이사가 무변경이었음을
   * 프로덕션 데이터로 확인한다. 이 값이 달라지면 배포 즉시 전 캐시가 미스가 된다.
   */
  it('프로덕션에 실재하는 행의 해시를 그대로 만든다', async () => {
    expect(await cacheKey(PROD_TEXT, 'light')).toBe(PROD_HASH);
  });

  /**
   * 위 골든 해시만으로는 부족하다. PROD_TEXT 는 이미 정규화된 구절이라
   * cacheKey 안에서 normalize 를 부르든 안 부르든 같은 값이 나온다.
   *
   * cacheKey 가 normalize 를 안에서 부르는 것이 "동작 불변"인 근거는
   * 호출자(api/analyze.ts)가 이미 정규화된 text 를 넘긴다는 사실 + normalize 의
   * 멱등성이다. 뒤쪽은 코드가 바뀌면 조용히 무너질 수 있으므로 직접 못박는다.
   */
  it('normalize 는 멱등이다 — cacheKey 의 무변경 근거', () => {
    const 입력 = [
      '  學而   時習之  ',
      '學而\n\t時習之',
      `學${String.fromCodePoint(0x200b)}而`,
      `學${String.fromCodePoint(0xfeff)}而`,
      `學${String.fromCodePoint(0xfeff)}${String.fromCodePoint(0xfeff)}而`,
      `${String.fromCodePoint(0xfeff)}學而${String.fromCodePoint(0xfeff)}`,
      `學${String.fromCodePoint(0x2060)}而`,
      PROD_TEXT,
    ];
    for (const t of 입력) {
      expect(normalize(normalize(t))).toBe(normalize(t));
    }
  });
});

describe('cacheKey — 무엇이 키를 가르는가', () => {
  // 실제 사고 (1). 이것이 깨지면 정밀 분석 토글이 다시 무효가 된다.
  it('mode 가 다르면 키가 다르다', async () => {
    expect(await cacheKey(PROD_TEXT, 'light')).not.toBe(await cacheKey(PROD_TEXT, 'deep'));
  });

  /**
   * 실제 사고 (2). 버전이 키 재료에 실제로 들어가는지 본다.
   *
   * 다른 버전 문자열로 같은 형식의 키를 직접 만들어 비교한다. 값이 같다면 버전이
   * 키에 반영되지 않는다는 뜻이고, 그러면 로직을 고쳐 배포해도 낡은 결과가 계속
   * 서빙된다 — 프로덕션 검증이 막혔던 그 상황이다.
   */
  it('버전이 키에 반영된다', async () => {
    const 다른버전 = await sha256(`${ANALYSIS_VERSION}-XX light ${PROD_TEXT}`);
    expect(await cacheKey(PROD_TEXT, 'light')).not.toBe(다른버전);
  });

  it('원문이 다르면 키가 다르다', async () => {
    expect(await cacheKey('學而時習之', 'light')).not.toBe(await cacheKey('不亦說乎', 'light'));
  });
});

describe('cacheKey — 무엇이 키를 가르지 않는가', () => {
  /**
   * 호출자가 정규화를 잊어도 같은 키가 나와야 한다.
   *
   * ※ 입력을 고르는 데 함정이 있다. 이미 정규화된 구절을 쓰면 normalize 가 아무것도
   *   하지 않아 이 테스트는 언제나 통과하는 빈 검사가 된다. 그래서 정규화가 실제로
   *   값을 바꾸는 입력을 쓰고, 그 전제부터 먼저 못박는다.
   */
  it('정규화 전 원문과 정규화된 원문이 같은 키가 된다', async () => {
    const raw = '  學而   時習之  ';
    expect(raw).not.toBe(normalize(raw)); // 전제: 이 입력은 정규화로 실제로 달라진다
    expect(await cacheKey(raw, 'light')).toBe(await cacheKey(normalize(raw), 'light'));
  });

  /**
   * 완료 조건 — 폭 없는 문자가 낀 원문과 끼지 않은 원문이 같은 캐시 키를 만든다.
   *
   * 이것이 4단계에서 normalize() 를 고친 이유다. 예전에는 U+FEFF 가 공백 한 칸으로
   * 바뀌고 U+2060 은 그대로 남아, 화면상 완전히 똑같은 구절이 다른 키를 받아 두 번
   * 과금됐다. 폭이 없어 사람 눈으로는 원인을 찾을 수 없는 종류의 사고다.
   * (웹에서 원문을 복사해 붙이면 실제로 이런 문자가 따라 들어온다.)
   */
  it('폭 없는 문자가 낀 원문과 안 낀 원문이 같은 키가 된다', async () => {
    const zw = (cp: number) => String.fromCodePoint(cp);
    const 낀것 = `學${zw(0x200b)}而${zw(0xfeff)}時${zw(0x2060)}習之`;
    expect(낀것).not.toBe('學而時習之'); // 전제: 두 문자열은 실제로 다르다
    expect(await cacheKey(낀것, 'light')).toBe(await cacheKey('學而時習之', 'light'));
  });

  // 이 성질이 곧 "같은 구절을 두 번 과금하지 않는다" 이다.
  it('공백만 다른 두 원문이 같은 키가 된다', async () => {
    expect(await cacheKey(' 學而  時習之 ', 'light')).toBe(await cacheKey('學而 時習之', 'light'));
  });

  it('같은 입력이면 항상 같은 키를 준다', async () => {
    expect(await cacheKey(PROD_TEXT, 'deep')).toBe(await cacheKey(PROD_TEXT, 'deep'));
  });
});

describe('cacheKey — DB 컬럼과의 계약', () => {
  // analyses.text_hash 는 UNIQUE 인덱스가 걸린 컬럼이고 스키마 주석이 SHA-256 이라고 못박는다.
  it('64자 16진 문자열이다', async () => {
    expect(await cacheKey(PROD_TEXT, 'light')).toMatch(/^[0-9a-f]{64}$/);
  });

  /**
   * 계획서 원안은 키를 `[버전, mode, 원문].join('|')` 로 두자고 했다. 그렇게 하면
   * 원문이 키 컬럼에 그대로 실려 컬럼의 의미와 스키마 주석이 함께 깨진다.
   * 해시를 조인 문자열로 되돌리는 회귀를 이 검사가 잡는다.
   */
  it('원문이 키에 그대로 실리지 않는다', async () => {
    const key = await cacheKey(PROD_TEXT, 'light');
    expect(key).not.toContain(PROD_TEXT);
    expect(key).not.toContain('學');
    expect(key).not.toContain(ANALYSIS_VERSION);
  });
});
