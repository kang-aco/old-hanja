/**
 * 입력 정규화 회귀 테스트.
 *
 * 왜 여기에 테스트를 두는가: analysis.ts 의 normalize() 안에 폭 없는 문자를 걸러내는
 * 문자 클래스가 있는데, 그 범위가 오랫동안 **보이지 않는 문자 그대로** 적혀 있었다.
 * 화면으로는 `[-]` 처럼만 보이고 무엇이 걸러지는지 알 수 없었다.
 *
 * 이 프로젝트는 보이지 않는 문자로 세 번 헤맸다.
 *  - 한자 범위를 리터럴로 적다가 U+F900 대신 U+8C48 을 써서 한글이 한자로 판정됐다.
 *  - 캐시 키 조립 문자열에 널 문자(U+0000)가 구분자로 들어가 정규식 교체가 세 번 실패했다.
 *  - normalize() 의 순서가 뒤집혀 있어 클래스에 적힌 U+FEFF 가 닿지 않는 코드였다.
 *    (2단계에서 발견 → 4단계에서 수정. 아래 "고친 동작" 항목들이 그 결과다.)
 * 그래서 어떤 코드포인트가 실제로 걸러지는지를 숫자로 명시해 고정해 둔다.
 * 이 파일에는 보이지 않는 문자를 리터럴로 적지 않는다 — 주석에도 적지 않는다.
 *
 * 2단계에서는 이 파일이 **현 동작을 기록**만 했다(버그를 알면서 고치지 않았다).
 * 4단계에서 캐시 키를 손대며 함께 고쳤으므로, 이제는 **의도한 동작**을 고정한다.
 */
import { describe, it, expect } from 'vitest';
import { normalize } from '../src/lib/analysis';

// 소스를 문자열로 읽는다. node:fs 를 쓰지 않는 이유: tsconfig 의 types 에
// @types/node 가 없고(Workers 런타임에도 없다) astro check 가 에러를 낸다.
// Vite 의 ?raw 임포트는 번들러가 처리하므로 런타임 의존이 생기지 않는다.
import analysisSrc from '../src/lib/analysis.ts?raw';
import cacheKeySrc from '../src/lib/cache-key.ts?raw';
import hanjaSrc from '../src/lib/hanja.ts?raw';
import promptSrc from '../src/lib/prompt.ts?raw';
import analyzeSrc from '../src/pages/api/analyze.ts?raw';
import normalizeTestSrc from './normalize.test.ts?raw';
import cacheKeyTestSrc from './cache-key.test.ts?raw';

const ch = (cp: number) => String.fromCodePoint(cp);

describe('normalize — 폭 없는 문자', () => {
  // 문자 클래스에 적힌 범위는 U+200B–U+200D, U+2060–U+2064, U+FEFF 다.
  it.each([
    ['U+200B ZERO WIDTH SPACE', 0x200b],
    ['U+200C ZERO WIDTH NON-JOINER', 0x200c],
    ['U+200D ZERO WIDTH JOINER', 0x200d],
  ])('%s 를 제거한다', (_label, cp) => {
    expect(normalize(`學${ch(cp)}而`)).toBe('學而');
  });

  it('여러 개가 섞여 있어도 모두 제거한다', () => {
    expect(normalize(`學${ch(0x200b)}${ch(0x200c)}而${ch(0x200d)}`)).toBe('學而');
  });

  /**
   * 고친 동작 — U+FEFF 는 이제 제거된다. 예전에는 **공백 한 칸으로 바뀌었다.**
   *
   * 원인은 순서였다. 예전 구현은 공백 정리(`\s+` → ' ')를 먼저 돌렸는데,
   * 자바스크립트의 `\s` 정의에 U+FEFF 가 포함된다. 그래서 폭 없는 문자 클래스는
   * U+FEFF 를 볼 일이 없었다 — 클래스에 적혀 있어도 닿지 않는 코드였다.
   * (`\s` 의 폭 없는 문자 범위는 U+2000~U+200A 에서 끝나므로 U+200B~U+200D 는
   * 포함되지 않는다. 그래서 그 셋은 예전 순서에서도 정상 제거됐다.)
   *
   * 결과가 왜 중요한가: 글자 사이에 U+FEFF 가 끼면 없던 공백이 생겨 정규화 결과가
   * 갈라지고, 캐시 키도 갈라져 같은 구절이 두 번 과금됐다. 화면에는 폭이 없어
   * 보이지 않으므로 사람이 알아챌 방법이 없었다.
   */
  it('U+FEFF 를 제거한다 (예전에는 공백으로 바뀌었다)', () => {
    expect(normalize(`學${ch(0xfeff)}而`)).toBe('學而');
  });

  // 연속으로 껴 있어도 공백이 생기지 않는다. 예전에는 `\s+` 가 둘을 한 칸으로 묶었다.
  it('U+FEFF 가 연속이어도 공백이 생기지 않는다', () => {
    expect(normalize(`學${ch(0xfeff)}${ch(0xfeff)}而`)).toBe('學而');
  });

  /**
   * 결과는 예전과 같지만 이유가 달라졌다.
   * 예전: 공백이 된 뒤 trim 으로 사라짐 / 지금: 애초에 제거됨.
   * 앞뒤는 어느 쪽이든 사라지므로 이 자리에서는 차이가 드러나지 않는다.
   */
  it('앞뒤의 U+FEFF 도 사라진다', () => {
    expect(normalize(`${ch(0xfeff)}學而${ch(0xfeff)}`)).toBe('學而');
  });

  /**
   * 고친 동작 — U+2060~U+2064 도 이제 제거된다. 예전에는 범위 밖이라 그대로 남았다.
   *
   * 전부 폭이 없고 한문 구절에서 의미를 갖지 않는다. 남겨두면 U+FEFF 와 똑같은
   * 방식으로 캐시 키를 가른다. "같은 증상, 다른 코드포인트"를 또 겪지 않으려고
   * 이번에 함께 넣었다.
   */
  it.each([
    ['U+2060 WORD JOINER', 0x2060],
    ['U+2061 FUNCTION APPLICATION', 0x2061],
    ['U+2062 INVISIBLE TIMES', 0x2062],
    ['U+2063 INVISIBLE SEPARATOR', 0x2063],
    ['U+2064 INVISIBLE PLUS', 0x2064],
  ])('%s 를 제거한다', (_label, cp) => {
    expect(normalize(`學${ch(cp)}而`)).toBe('學而');
  });

  /**
   * 일부러 건드리지 않는 것 — 변이 선택자(U+FE00~FE0F)와 IVS(U+E0100~).
   * CJK 이체자를 구분하는 데 실제로 쓰인다. 지우면 서로 다른 글자가 같은 캐시 키로
   * 합쳐진다. 이 앱은 source_guess.note 로 이체자 메모를 받는 앱이다.
   */
  it('변이 선택자(U+FE0E)는 남긴다 — 이체자 구분에 쓰인다', () => {
    expect(normalize(`學${ch(0xfe0e)}而`)).toBe(`學${ch(0xfe0e)}而`);
  });

  // U+00AD SOFT HYPHEN 은 폭이 없지 않아(줄바꿈 위치에서 하이픈으로 보인다) 범위에서 뺐다.
  it('U+00AD SOFT HYPHEN 은 남긴다 — 이번 범위에서 제외했다', () => {
    expect(normalize(`學${ch(0x00ad)}而`)).toBe(`學${ch(0x00ad)}而`);
  });

  // 이 성질이 곧 "눈에 똑같은 구절이 두 번 과금되지 않는다" 이다.
  it('폭 없는 문자가 낀 원문과 안 낀 원문이 같은 결과가 된다', () => {
    const 낀것 = `學${ch(0x200b)}而${ch(0xfeff)}時${ch(0x2060)}習之`;
    expect(normalize(낀것)).toBe(normalize('學而時習之'));
  });
});

describe('normalize — 공백', () => {
  it('연속 공백을 하나로 줄인다', () => {
    expect(normalize('學而   時習之')).toBe('學而 時習之');
  });

  it('줄바꿈과 탭도 공백 하나로 취급한다', () => {
    expect(normalize('學而\n\t時習之')).toBe('學而 時習之');
  });

  it('앞뒤 공백을 없앤다', () => {
    expect(normalize('  學而時習之  ')).toBe('學而時習之');
  });

  // 캐시 키에 쓰이므로 이 성질이 곧 "같은 구절을 두 번 과금하지 않는다" 이다.
  it('공백만 다른 두 입력이 같은 결과가 된다', () => {
    expect(normalize(' 學而  時習之 ')).toBe(normalize('學而 時習之'));
  });

  it('구두점은 건드리지 않는다', () => {
    expect(normalize('知之爲知之, 不知爲不知, 是知也')).toBe('知之爲知之, 不知爲不知, 是知也');
  });
});

describe('normalize — 소스 표기 규칙', () => {
  /**
   * 사람이 지키던 규칙을 기계가 지키게 한다.
   *
   * 이 규칙("보이지 않는 문자를 리터럴로 적지 않는다")은 이 파일 상단에 주석으로만
   * 있었고, 실제로 4단계 작업 중에 문자 클래스를 고쳐 적다가 U+200B·U+200D·U+2060·
   * U+2064·U+FEFF 를 리터럴로 써 넣는 일이 벌어졌다. 눈으로는 보이지 않으니
   * 코드 리뷰로도 잡히지 않는다. 코드포인트로 훑는 수밖에 없다.
   *
   * prompt.ts 와 api/analyze.ts 도 대상이다. SYSTEM_PROMPT 에 보이지 않는 문자가
   * 끼면 3단계에서 SHA-256 으로 고정해 둔 프롬프트가 조용히 달라진다. 그쪽 스냅숏이
   * 깨지기는 하겠지만, 원인이 무엇인지는 알려주지 못한다 — 화면에 보이지 않는
   * 문자이므로 diff 를 봐도 알 수 없다. 여기서 코드포인트로 먼저 잡는다.
   */
  it.each([
    ['src/lib/analysis.ts', analysisSrc],
    ['src/lib/cache-key.ts', cacheKeySrc],
    ['src/lib/hanja.ts', hanjaSrc],
    ['src/lib/prompt.ts', promptSrc],
    ['src/pages/api/analyze.ts', analyzeSrc],
    ['tests/normalize.test.ts', normalizeTestSrc],
    ['tests/cache-key.test.ts', cacheKeyTestSrc],
  ])('%s 에 보이지 않는 문자가 리터럴로 남아 있지 않다', (_path, src) => {
    const 금지 = (cp: number) =>
      cp === 0x0000 ||
      cp === 0x00ad ||
      (cp >= 0x200b && cp <= 0x200f) ||
      (cp >= 0x2060 && cp <= 0x2064) ||
      cp === 0xfeff;
    const 발견 = [...src]
      .map((c) => c.codePointAt(0)!)
      .filter(금지)
      .map((cp) => 'U+' + cp.toString(16).toUpperCase().padStart(4, '0'));
    expect(발견).toEqual([]);
  });
});
