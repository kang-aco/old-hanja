/**
 * 프롬프트·요청 파라미터의 스냅숏 기준선.
 *
 * ── 이 파일의 목적 ─────────────────────────────────────────────────────────
 * 프롬프트 조립을 순수 함수로 분리할 때(3단계), 분리 전후로 API 에 나가는 요청이
 * **바이트 단위로 같다**는 것을 증명한다. "눈으로 diff 를 봤다"는 증거로는 부족하다.
 *
 * ── 읽는 방법 ──────────────────────────────────────────────────────────────
 * `tests/__snapshots__/request-*.txt` 가 기준선이다. 이 파일들은 **리팩터링 전**
 * 코드에서 떴다. 리팩터링 커밋의 diff 에 스냅숏 변경이 한 줄도 없으면 요청이
 * 동일하다는 뜻이다.
 *
 * ── 이 커밋 시점의 구현 ────────────────────────────────────────────────────
 * 지금은 `src/pages/api/analyze.ts` 가 하는 조립을 아래에 그대로 베껴 두었다.
 * 리팩터링 커밋에서 이 부분만 `buildAnalysisRequest()` 호출로 바꾼다.
 * 베낀 원본은 analyze.ts 의 다음 다섯 줄이다 (model / max_tokens / system /
 * messages / output_config) 와 deep 모드의 thinking 분기.
 *
 * ── 스냅숏을 고칠 때 ───────────────────────────────────────────────────────
 * 프롬프트를 의도적으로 바꿨다면 스냅숏이 깨지는 것이 정상이다. `npm test -- -u` 로
 * 갱신하고, **ANALYSIS_VERSION 도 함께 올려야 한다** — 올리지 않으면 이미 분석된
 * 구절은 낡은 캐시가 영구히 서빙된다. 실제로 그 일이 있었다.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  ANALYSIS_SCHEMA,
  SYSTEM_PROMPT,
  maxTokensFor,
  normalize,
  resolveModel,
  type Mode,
} from '../src/lib/analysis';
import { extractHanja } from '../src/lib/hanja';

// ── 고정 입력 ────────────────────────────────────────────────────────────────

/**
 * 짧은 구절과 긴 구절 둘을 쓴다. max_tokens 는 한자 수에 비례하므로, 하나만 쓰면
 * 길이에 따라 예산이 달라지는 부분이 고정되지 않는다.
 */
const 구절 = {
  short: '學而時習之, 不亦說乎',
  long: '學而時習之, 不亦說乎? 有朋自遠方來, 不亦樂乎? 人不知而不慍, 不亦君子乎?',
} as const;

const 모드: Mode[] = ['light', 'deep'];

// ── 리팩터링 전 조립 코드 (analyze.ts 에서 그대로 베낌) ──────────────────────

/**
 * analyze.ts:184-191 과 같은 형태로 요청 파라미터를 만든다.
 * 키 순서까지 그대로 유지한다 — 스냅숏이 키 순서 변화도 잡게 하기 위해서다.
 */
function 조립(text: string, mode: Mode, model: string): Record<string, unknown> {
  const hanjaCount = extractHanja(text).length;
  const params: Record<string, unknown> = {
    model,
    max_tokens: maxTokensFor(mode, hanjaCount),
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `[분석할 한문 구절]\n${text}` }],
    output_config: { format: { type: 'json_schema', schema: ANALYSIS_SCHEMA } },
  };
  if (mode === 'deep') params.thinking = { type: 'disabled' };
  return params;
}

// ── 직렬화 ───────────────────────────────────────────────────────────────────

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

/**
 * 사람이 읽을 수 있게 펼쳐 적는다. JSON.stringify 한 줄로 두면 diff 가 전부
 * 한 줄로 몰려 어디가 달라졌는지 보이지 않는다.
 *
 * keys 줄을 넣는 이유: 키 순서와 키 집합의 변화를 눈에 보이게 하려는 것이다.
 */
function 직렬화(params: Record<string, unknown>): string {
  const system = params.system as string;
  const messages = params.messages as { role: string; content: string }[];
  const lines = [
    `keys: ${Object.keys(params).join(', ')}`,
    `model: ${params.model}`,
    `max_tokens: ${params.max_tokens}`,
    `thinking: ${params.thinking ? JSON.stringify(params.thinking) : '(없음)'}`,
    `system.length: ${system.length}`,
    `system.sha256: ${sha256(system)}`,
    '',
    '───── system ─────',
    system,
    '',
    '───── messages ─────',
    ...messages.map((m, i) => `[${i}] role=${m.role}\n${m.content}`),
    '',
    '───── output_config ─────',
    JSON.stringify(params.output_config, null, 2),
    '',
  ];
  return lines.join('\n');
}

// ── 스냅숏 ───────────────────────────────────────────────────────────────────

describe('요청 파라미터 스냅숏', () => {
  for (const [이름, raw] of Object.entries(구절)) {
    for (const mode of 모드) {
      it(`${mode} / ${이름}`, async () => {
        // analyze.ts 와 같은 순서: 정규화 → 모델 결정 → 조립
        const text = normalize(raw);
        const model = resolveModel(mode, {});
        const dump = 직렬화(조립(text, mode, model));
        await expect(dump).toMatchFileSnapshot(`./__snapshots__/request-${mode}-${이름}.txt`);
      });
    }
  }
});

describe('스냅숏이 실제로 무언가를 고정하는지', () => {
  /**
   * 스냅숏이 4개 다 같은 내용이면 사실상 한 건만 고정하는 것이다. 모드와 길이가
   * 요청에 실제로 반영되는지 확인해 둔다.
   */
  it('모드와 길이에 따라 요청이 달라진다', () => {
    const s = normalize(구절.short);
    const l = normalize(구절.long);
    const light = 조립(s, 'light', resolveModel('light', {}));
    const deep = 조립(s, 'deep', resolveModel('deep', {}));
    const longer = 조립(l, 'light', resolveModel('light', {}));

    expect(light.model).not.toBe(deep.model);
    expect(light.thinking).toBeUndefined();
    expect(deep.thinking).toEqual({ type: 'disabled' });
    expect(longer.max_tokens).toBeGreaterThan(light.max_tokens as number);
  });
});
