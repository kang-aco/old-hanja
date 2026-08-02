/**
 * buildPrompt / buildAnalysisRequest 자체 검사.
 *
 * 이 층은 결정론적이다. 같은 입력이면 항상 같은 요청이 나오고, 네트워크·DB·시계를
 * 건드리지 않는다. 그래서 API 호출 없이(비용 0) 여기서 고정할 수 있다.
 *
 * 프롬프트 *내용*에 관한 검사는 tests/prompt-rules.test.ts 에 있다.
 * 이 파일은 조립 자체 — 무엇이 어떤 값으로 실려 나가는지 — 를 본다.
 * 실제로 사고가 났던 곳이 내용보다 이쪽이었다.
 */
import { describe, it, expect } from 'vitest';
import { SYSTEM_PROMPT, ANALYSIS_SCHEMA, buildPrompt, buildAnalysisRequest } from '../src/lib/prompt';
import { maxTokensFor, resolveModel, type Mode } from '../src/lib/analysis';
import { extractHanja } from '../src/lib/hanja';

const 원문 = '學而時習之, 不亦說乎';
const 긴원문 = '學而時習之, 不亦說乎? 有朋自遠方來, 不亦樂乎? 人不知而不慍, 不亦君子乎?';
const 모드: Mode[] = ['light', 'deep'];

describe('buildPrompt', () => {
  /**
   * 브리지 테스트 — 이 파일에서 유일하게 SYSTEM_PROMPT 상수를 직접 본다.
   *
   * prompt-rules.test.ts 의 내용 검사 19건을 모두 buildPrompt 경유로 돌렸으므로,
   * "buildPrompt 가 상수를 우회하고 다른 문자열을 내보내는" 경우를 아무도 보지 않게
   * 된다. 이 한 건이 그 구멍을 막는다. 분리 시점에 내용을 바꾸지 않았다는 못이기도 하다.
   */
  it('system 은 SYSTEM_PROMPT 를 그대로 내보낸다', () => {
    expect(buildPrompt({ text: 원문, mode: 'light' }).system).toBe(SYSTEM_PROMPT);
  });

  it('user 메시지에 원문이 들어간다', () => {
    expect(buildPrompt({ text: 원문, mode: 'light' }).user).toContain(원문);
  });

  // 접두어가 사라지면 모델이 지시문과 원문의 경계를 잃는다. 분리 전 템플릿 그대로다.
  it('user 메시지의 접두어가 유지된다', () => {
    expect(buildPrompt({ text: 원문, mode: 'light' }).user).toBe(`[분석할 한문 구절]\n${원문}`);
  });

  /**
   * 계획서에는 "정밀 모드에는 추가 지침이 들어간다 (precise.length > basic.length)"는
   * 예시가 있었는데 이 앱에서는 성립하지 않는다. 정밀 모드는 프롬프트를 늘리는 것이
   * 아니라 모델을 바꾸는 방식이다(resolveModel: haiku-4-5 → sonnet-5).
   * 그 사실을 테스트로 적어 둔다 — 나중에 모드별 프롬프트를 도입하면 여기가 깨진다.
   */
  it('모드가 system 프롬프트를 바꾸지 않는다 — 정밀 모드는 모델을 바꾼다', () => {
    const light = buildPrompt({ text: 원문, mode: 'light' });
    const deep = buildPrompt({ text: 원문, mode: 'deep' });
    expect(deep.system).toBe(light.system);
    expect(deep.user).toBe(light.user);
    expect(resolveModel('deep', {})).not.toBe(resolveModel('light', {}));
  });

  // 순수 함수여야 한다. 호출 결과를 만져도 다음 호출이 오염되지 않아야 한다.
  it('같은 입력이면 같은 결과를 준다', () => {
    expect(buildPrompt({ text: 원문, mode: 'light' })).toEqual(
      buildPrompt({ text: 원문, mode: 'light' }),
    );
  });

  it('반환값을 변경해도 다음 호출에 영향이 없다', () => {
    const first = buildPrompt({ text: 원문, mode: 'light' });
    first.system = '망가뜨림';
    first.user = '망가뜨림';
    expect(buildPrompt({ text: 원문, mode: 'light' }).system).toBe(SYSTEM_PROMPT);
  });
});

describe('buildAnalysisRequest', () => {
  it('model 을 인자로 받은 값 그대로 싣는다', () => {
    expect(buildAnalysisRequest({ text: 원문, mode: 'light' }, 'claude-test-9').model).toBe(
      'claude-test-9',
    );
  });

  /**
   * 사고: max_tokens 를 4000 으로 고정해 두어 긴 구절의 JSON 이 중간에 잘렸다.
   * 잘린 JSON 은 파싱에 실패해 분석 전체가 실패했다. 예산이 실제 입력 길이에서
   * 계산되는지 본다 — 한자 수를 인자로 받지 않고 text 에서 직접 구하는 이유다.
   */
  it.each(모드)('%s / max_tokens 가 실제 한자 수에서 계산된다', (mode) => {
    for (const text of [원문, 긴원문]) {
      const req = buildAnalysisRequest({ text, mode }, resolveModel(mode, {}));
      expect(req.max_tokens).toBe(maxTokensFor(mode, extractHanja(text).length));
    }
  });

  it('긴 구절이 더 큰 예산을 받는다', () => {
    const 짧게 = buildAnalysisRequest({ text: 원문, mode: 'light' }, 'm').max_tokens as number;
    const 길게 = buildAnalysisRequest({ text: 긴원문, mode: 'light' }, 'm').max_tokens as number;
    expect(길게).toBeGreaterThan(짧게);
  });

  /**
   * 사고: sonnet-5 는 adaptive thinking 이 기본 ON 이다. 끄지 않으면 작은 max_tokens 를
   * 사고 토큰이 다 먹어 JSON 이 아예 나오지 않는다 — 교정이 3/3 무효였던 원인이다.
   * 반대로 haiku-4-5 는 thinking 파라미터를 지원하지 않으므로 보내면 안 된다.
   */
  it('deep 에는 thinking 을 끄는 지시가 붙는다', () => {
    expect(buildAnalysisRequest({ text: 원문, mode: 'deep' }, 'm').thinking).toEqual({
      type: 'disabled',
    });
  });

  it('light 에는 thinking 키 자체가 없다', () => {
    const req = buildAnalysisRequest({ text: 원문, mode: 'light' }, 'm');
    expect('thinking' in req).toBe(false);
  });

  // Structured Outputs 가 빠지면 모델이 자유 형식으로 답해 JSON.parse 가 깨진다.
  it('output_config 에 분석 스키마가 붙는다', () => {
    const req = buildAnalysisRequest({ text: 원문, mode: 'light' }, 'm');
    expect(req.output_config).toEqual({
      format: { type: 'json_schema', schema: ANALYSIS_SCHEMA },
    });
  });

  it('messages 는 user 한 건이고 buildPrompt 의 user 와 같다', () => {
    const req = buildAnalysisRequest({ text: 원문, mode: 'light' }, 'm');
    expect(req.messages).toEqual([
      { role: 'user', content: buildPrompt({ text: 원문, mode: 'light' }).user },
    ]);
  });

  /**
   * 키 집합이 늘거나 줄면 API 로 나가는 요청의 성격이 달라진다. 스냅숏
   * (tests/__snapshots__/request-*.txt) 이 세부까지 고정하지만, 여기서 한눈에 보이게
   * 적어 둔다. temperature 나 top_p 같은 것이 조용히 끼어드는 것도 이 검사가 잡는다.
   */
  it('실려 나가는 키가 정해진 것뿐이다', () => {
    expect(Object.keys(buildAnalysisRequest({ text: 원문, mode: 'light' }, 'm'))).toEqual([
      'model',
      'max_tokens',
      'system',
      'messages',
      'output_config',
    ]);
    expect(Object.keys(buildAnalysisRequest({ text: 원문, mode: 'deep' }, 'm'))).toEqual([
      'model',
      'max_tokens',
      'system',
      'messages',
      'output_config',
      'thinking',
    ]);
  });

  it('같은 입력이면 같은 요청을 준다', () => {
    expect(buildAnalysisRequest({ text: 원문, mode: 'deep' }, 'm')).toEqual(
      buildAnalysisRequest({ text: 원문, mode: 'deep' }, 'm'),
    );
  });
});
