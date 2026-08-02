/**
 * 디버그 화면 회귀 테스트.
 *
 * 이 화면은 프롬프트 전문과 AI 원본 응답을 그대로 내보낸다. 그래서 이 파일이 막는
 * 첫 번째 사고는 분석 오류가 아니라 **노출**이다 — 키가 없거나 틀렸는데 debug 가
 * 딸려 나가는 것. 기본 상태(환경변수 미설정)가 완전 차단인지를 가장 먼저 못박는다.
 *
 * 두 번째는 이 화면 자체가 사각지대를 재현하는 것이다. 원문과 정규화 결과를 나란히
 * 놓기만 하면 U+FEFF 가 낀 구절과 안 낀 구절이 화면에서 똑같이 보인다. 캐시 키가
 * 갈라진 사고가 발각되지 않은 이유가 정확히 그것이었으므로, 폭 없는 문자를
 * 코드포인트로 적어 보이는지를 검사한다.
 *
 * 이 파일에는 보이지 않는 문자를 리터럴로 적지 않는다 — 주석에도 적지 않는다.
 * 코드포인트 숫자로만 쓰고 String.fromCodePoint 로 만든다.
 * (tests/normalize.test.ts 의 소스 스캐너가 이 파일도 훑는다.)
 */
import { describe, it, expect } from 'vitest';
import {
  MIN_DEBUG_KEY_LENGTH,
  buildDebug,
  debugAllowed,
  findInvisible,
  viewRequest,
  type DebugInput,
} from '../src/lib/debug';
import { ANALYSIS_VERSION } from '../src/lib/cache-key';
import { buildAnalysisRequest } from '../src/lib/prompt';

const ch = (cp: number) => String.fromCodePoint(cp);

/** 16자 이상 — 실제 운영에서 쓸 법한 모양 */
const KEY = 'a1b2c3d4e5f6g7h8';

/** 기본 재료. 각 검사에서 필요한 것만 덮어쓴다. */
const base: DebugInput = {
  allowed: true,
  raw: '學而時習之',
  normalized: '學而時習之',
  hanjaCount: 5,
  mode: 'light',
  cacheKey: 'f'.repeat(64),
  cacheHit: false,
};

// ── 접근 통제 ───────────────────────────────────────────────────────────────

describe('debugAllowed — 기본은 완전 차단', () => {
  /**
   * 가장 중요한 검사. DEBUG_KEY 를 설정하지 않은 상태(=프로덕션의 기본값)에서는
   * 무엇을 넘겨도 열리면 안 된다. 여기가 뚫리면 시스템 프롬프트 전문이 공개된다.
   */
  it.each([['1'], [KEY], [''], ['undefined'], ['true']])(
    'DEBUG_KEY 가 없으면 %s 를 넘겨도 열리지 않는다',
    async (provided) => {
      expect(await debugAllowed(provided, {})).toBe(false);
    },
  );

  it('DEBUG_KEY 가 빈 문자열이면 빈 문자열을 넘겨도 열리지 않는다', async () => {
    expect(await debugAllowed('', { DEBUG_KEY: '' })).toBe(false);
  });

  it('값을 넘기지 않으면 열리지 않는다', async () => {
    expect(await debugAllowed(null, { DEBUG_KEY: KEY })).toBe(false);
    expect(await debugAllowed(undefined, { DEBUG_KEY: KEY })).toBe(false);
    expect(await debugAllowed('', { DEBUG_KEY: KEY })).toBe(false);
  });
});

describe('debugAllowed — 짧은 키는 미설정으로 취급', () => {
  /**
   * 계획서의 완료 조건은 "`?debug=1` 만으로는 아무것도 보이지 않는다" 다.
   * 길이 하한이 없으면 그 조건이 설정값에 기대는 우연이 된다 — DEBUG_KEY=1 로
   * 두는 순간 깨진다. 하한을 두면 설정과 무관한 불변조건이 된다.
   */
  it('DEBUG_KEY=1 로 설정해도 ?debug=1 로 열리지 않는다', async () => {
    expect(await debugAllowed('1', { DEBUG_KEY: '1' })).toBe(false);
  });

  it('하한보다 한 자 짧은 키는 정확히 일치해도 열리지 않는다', async () => {
    const short = 'x'.repeat(MIN_DEBUG_KEY_LENGTH - 1);
    expect(await debugAllowed(short, { DEBUG_KEY: short })).toBe(false);
  });

  it('하한 길이의 키는 열린다 — 경계가 한 칸 어긋나 있지 않다', async () => {
    const exact = 'x'.repeat(MIN_DEBUG_KEY_LENGTH);
    expect(await debugAllowed(exact, { DEBUG_KEY: exact })).toBe(true);
  });
});

describe('debugAllowed — 정확히 일치할 때만', () => {
  it('일치하면 열린다', async () => {
    expect(await debugAllowed(KEY, { DEBUG_KEY: KEY })).toBe(true);
  });

  /**
   * 부분 일치로 통과하면 키를 한 자씩 알아내는 공격이 성립한다.
   * 접두·접미·대소문자·공백을 각각 막는다.
   */
  it.each([
    ['접두사만', KEY.slice(0, -1)],
    ['한 자 더 붙음', `${KEY}x`],
    ['대소문자 다름', KEY.toUpperCase()],
    ['앞뒤 공백', ` ${KEY} `],
    ['전혀 다름', 'z'.repeat(KEY.length)],
  ])('%s 이면 열리지 않는다', async (_label, provided) => {
    expect(await debugAllowed(provided, { DEBUG_KEY: KEY })).toBe(false);
  });
});

// ── payload 생성 ────────────────────────────────────────────────────────────

describe('buildDebug — 차단이면 필드 자체가 없다', () => {
  /**
   * 빈 객체를 돌려주면 응답에 debug 키가 생긴다. 그 자체로 "이 앱에 디버그 화면이
   * 있고 키가 틀렸다"는 사실이 새어 나가고, 완료 조건도 흐려진다.
   */
  it('allowed 가 false 면 undefined 를 돌려준다', () => {
    expect(buildDebug({ ...base, allowed: false })).toBeUndefined();
  });

  /** 호출부의 `...(debug && { debug })` 가 실제로 키를 만들지 않는지 그대로 확인한다 */
  it('undefined 를 스프레드하면 응답에 debug 키가 생기지 않는다', () => {
    const debug = buildDebug({ ...base, allowed: false });
    const body = { ok: true, ...(debug && { debug }) };
    expect(Object.keys(body)).toEqual(['ok']);
    expect('debug' in body).toBe(false);
  });

  it('allowed 가 true 면 payload 를 돌려준다', () => {
    expect(buildDebug(base)).toBeDefined();
  });
});

describe('buildDebug — 담기는 것과 담기지 않는 것', () => {
  /**
   * 최상위 키를 통째로 고정한다. 나중에 env 나 원본 응답 객체를 통째로 끼워 넣는
   * 변경이 들어오면 여기서 걸린다 — API 키가 화면으로 새는 가장 흔한 경로다.
   */
  it('최상위 키는 정해진 다섯 개뿐이다', () => {
    expect(Object.keys(buildDebug(base)!)).toEqual([
      'input',
      'cache',
      'request',
      'response',
      'validate',
    ]);
  });

  it('버전은 cache-key.ts 의 것을 그대로 쓴다', () => {
    expect(buildDebug(base)!.cache.version).toBe(ANALYSIS_VERSION);
  });

  it('캐시 키와 mode 를 그대로 싣는다 — 정밀 토글이 키를 가르는지 화면에서 본다', () => {
    const d = buildDebug({ ...base, mode: 'deep', cacheKey: 'ab'.repeat(32) })!;
    expect(d.cache.key).toBe('ab'.repeat(32));
    expect(d.cache.mode).toBe('deep');
  });

  /**
   * 캐시 히트면 요청을 아예 만들지 않았다. 그 자리에 "보냈을 법한" 프롬프트를
   * 재구성해 넣으면 이 화면의 전제("실제로 전송된 것")가 무너진다.
   */
  it('캐시 히트면 request 가 null 이다', () => {
    const d = buildDebug({ ...base, cacheHit: true })!;
    expect(d.cache.hit).toBe(true);
    expect(d.request).toBeNull();
  });

  it('요청을 넘기면 투영해서 싣는다', () => {
    const params = buildAnalysisRequest({ text: '學而時習之', mode: 'light' }, 'claude-haiku-4-5');
    const d = buildDebug({ ...base, request: params })!;
    expect(d.request?.model).toBe('claude-haiku-4-5');
    expect(d.request?.max_tokens).toBe(params.max_tokens);
  });

  it('응답과 검증을 넘기지 않으면 null 이다 — 없는 것을 지어내지 않는다', () => {
    const d = buildDebug(base)!;
    expect(d.response).toBeNull();
    expect(d.validate).toBeNull();
  });
});

// ── 요청 투영 ───────────────────────────────────────────────────────────────

describe('viewRequest — 실제로 보낸 것만 보여 준다', () => {
  const light = buildAnalysisRequest({ text: '學而時習之', mode: 'light' }, 'claude-haiku-4-5');
  const deep = buildAnalysisRequest({ text: '學而時習之', mode: 'deep' }, 'claude-sonnet-5');

  /**
   * 조립 결과에서 직접 뽑는다. 화면이 따로 조립하면 실제로 보낸 것과 다른 값을
   * 보여 주게 되고, 그 순간 이 화면을 믿을 수 없게 된다.
   */
  it('system 과 user 를 조립 결과 그대로 싣는다', () => {
    const v = viewRequest(light);
    expect(v.system).toBe(light.system);
    expect(v.user).toBe((light.messages as Array<{ content: string }>)[0]!.content);
  });

  /**
   * max_tokens 사고(4000 고정으로 긴 구절이 잘림)를 화면에서 잡으려면 이 값이
   * 실제 요청의 값이어야 한다. 화면이 다시 계산하면 잘린 이유를 영영 못 본다.
   */
  it('max_tokens 를 실제 요청에서 가져온다', () => {
    expect(viewRequest(light).max_tokens).toBe(light.max_tokens);
    expect(viewRequest({ ...light, max_tokens: 700 }).max_tokens).toBe(700);
  });

  /** 교정이 3/3 무효였던 원인이 thinking 이었다. 붙었는지 여부가 한눈에 보여야 한다 */
  it('thinking 은 붙었을 때만 값이 있다', () => {
    expect(viewRequest(light).thinking).toBeNull();
    expect(viewRequest(deep).thinking).toBe('disabled');
  });

  /** temperature 처럼 조용히 끼어든 파라미터를 화면에서 바로 본다 */
  it('실려 나간 최상위 키를 정렬해서 보여 준다', () => {
    expect(viewRequest(light).keys).toEqual([
      'max_tokens',
      'messages',
      'model',
      'output_config',
      'system',
    ]);
    expect(viewRequest({ ...light, temperature: 0.7 }).keys).toContain('temperature');
  });
});

// ── 보이지 않는 문자 ────────────────────────────────────────────────────────

describe('findInvisible — 사각지대를 재현하지 않는다', () => {
  it('정상 한문 구절에는 아무것도 없다', () => {
    expect(findInvisible('學而時習之, 不亦說乎')).toEqual([]);
  });

  /**
   * 실제 사고: 글자 사이에 U+FEFF 가 끼면 정규화 결과가 갈라져 같은 구절이 두 번
   * 과금됐다. 폭이 없어 화면에 보이지 않으니 사람이 알아챌 방법이 없었다.
   * 원문과 정규화 결과를 나란히 놓는 것만으로는 이 사고를 못 잡는다 —
   * 두 문자열이 화면에서 똑같아 보이기 때문이다.
   */
  it('U+FEFF 를 위치와 함께 짚어낸다', () => {
    expect(findInvisible(`學${ch(0xfeff)}而`)).toEqual(['U+FEFF@1']);
  });

  it.each([
    ['U+200B ZERO WIDTH SPACE', 0x200b, 'U+200B'],
    ['U+2060 WORD JOINER', 0x2060, 'U+2060'],
    ['U+00A0 NO-BREAK SPACE', 0x00a0, 'U+00A0'],
    ['U+3000 IDEOGRAPHIC SPACE', 0x3000, 'U+3000'],
    ['U+00AD SOFT HYPHEN', 0x00ad, 'U+00AD'],
    ['U+FE0F 변이 선택자', 0xfe0f, 'U+FE0F'],
    ['U+E0100 IVS', 0xe0100, 'U+E0100'],
  ])('%s 를 짚어낸다', (_label, cp, expected) => {
    expect(findInvisible(`學${ch(cp)}而`)).toEqual([`${expected}@1`]);
  });

  /**
   * normalize 가 **지우지 않는** 문자까지 훑는 것이 핵심이다. 지우는 것만 보면
   * "남아서 키를 가르는 문자"를 못 본다. 변이 선택자와 IVS 는 일부러 남기는
   * 것이므로(이체자 구분) 더더욱 화면에 보여야 한다.
   */
  it('여러 개가 섞이면 원문에 나온 순서대로 모두 짚는다', () => {
    expect(findInvisible(`${ch(0xfeff)}學${ch(0x200b)}而${ch(0x2060)}`)).toEqual([
      'U+FEFF@0',
      'U+200B@2',
      'U+2060@4',
    ]);
  });

  /**
   * 위치는 UTF-16 인덱스가 아니라 코드포인트 순번이다. IVS 처럼 BMP 밖 문자가
   * 앞에 있으면 두 값이 어긋나고, 화면에서 짚은 자리가 실제와 달라진다.
   */
  it('BMP 밖 문자가 앞에 있어도 순번이 밀리지 않는다', () => {
    expect(findInvisible(`學${ch(0xe0100)}而${ch(0xfeff)}`)).toEqual(['U+E0100@1', 'U+FEFF@3']);
  });

  it('탭과 개행은 보이지 않는 문자로 치지 않는다 — 정상 입력이다', () => {
    expect(findInvisible('學\t而\n時')).toEqual([]);
  });
});

describe('buildDebug — 폭 없는 문자를 원문/정규화 양쪽에서 본다', () => {
  /**
   * 이 조합이 사고 진단의 실질이다. raw 에는 있고 normalized 에는 없으면
   * "정규화가 지웠다", 양쪽에 다 있으면 "지우지 않고 남겼다 — 키가 갈라진다",
   * raw 에만 있고 changed 가 true 면 그 문자가 원인이라는 것이 한눈에 보인다.
   */
  it('정규화가 지운 문자는 raw 에만 남는다', () => {
    const raw = `學${ch(0xfeff)}而`;
    const d = buildDebug({ ...base, raw, normalized: '學而' })!;
    expect(d.input.invisible.raw).toEqual(['U+FEFF@1']);
    expect(d.input.invisible.normalized).toEqual([]);
    expect(d.input.changed).toBe(true);
  });

  it('정규화가 남긴 문자는 양쪽에 다 보인다', () => {
    const raw = `學${ch(0xfe0f)}而`;
    const d = buildDebug({ ...base, raw, normalized: raw })!;
    expect(d.input.invisible.raw).toEqual(['U+FE0F@1']);
    expect(d.input.invisible.normalized).toEqual(['U+FE0F@1']);
    expect(d.input.changed).toBe(false);
  });

  it('깨끗한 입력이면 양쪽 다 비어 있다', () => {
    const d = buildDebug(base)!;
    expect(d.input.invisible).toEqual({ raw: [], normalized: [] });
    expect(d.input.changed).toBe(false);
  });
});
