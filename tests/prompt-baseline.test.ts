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
 * ── 분리 전후 ──────────────────────────────────────────────────────────────
 * 기준선을 뜬 커밋(e10bd71)에서는 `analyze.ts` 의 조립 다섯 줄(model / max_tokens /
 * system / messages / output_config)과 deep 모드의 thinking 분기를 이 파일에 그대로
 * 베껴 두었다. 지금은 그 자리에 `buildAnalysisRequest()` 호출만 있다.
 * 스냅숏이 그대로라는 것이 곧 요청이 바뀌지 않았다는 증명이다.
 *
 * ── 스냅숏을 고칠 때 ───────────────────────────────────────────────────────
 * 프롬프트를 의도적으로 바꿨다면 스냅숏이 깨지는 것이 정상이다. `npm test -- -u` 로
 * 갱신하고, **ANALYSIS_VERSION 도 함께 올려야 한다** — 올리지 않으면 이미 분석된
 * 구절은 낡은 캐시가 영구히 서빙된다. 실제로 그 일이 있었다.
 */
import { describe, it, expect } from 'vitest';
import { normalize, resolveModel, type Mode } from '../src/lib/analysis';
import { buildAnalysisRequest } from '../src/lib/prompt';
// 해시는 제품 코드와 같은 구현을 쓴다. node:crypto 를 쓰면 tsconfig 의 types 에
// @types/node 가 없어 astro check 가 실패한다 (Workers 런타임에도 없는 모듈이다).
import { sha256 } from '../src/lib/hash';

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

// ── 조립 ─────────────────────────────────────────────────────────────────────

/** 분리 후에는 제품 코드와 완전히 같은 경로를 쓴다. analyze.ts 도 이 함수만 부른다. */
const 조립 = (text: string, mode: Mode, model: string) =>
  buildAnalysisRequest({ text, mode }, model);

// ── 직렬화 ───────────────────────────────────────────────────────────────────

/**
 * 사람이 읽을 수 있게 펼쳐 적는다. JSON.stringify 한 줄로 두면 diff 가 전부
 * 한 줄로 몰려 어디가 달라졌는지 보이지 않는다.
 *
 * keys 줄을 넣는 이유: 키 순서와 키 집합의 변화를 눈에 보이게 하려는 것이다.
 */
async function 직렬화(params: Record<string, unknown>): Promise<string> {
  const system = params.system as string;
  const messages = params.messages as { role: string; content: string }[];
  const lines = [
    `keys: ${Object.keys(params).join(', ')}`,
    `model: ${params.model}`,
    `max_tokens: ${params.max_tokens}`,
    `thinking: ${params.thinking ? JSON.stringify(params.thinking) : '(없음)'}`,
    `system.length: ${system.length}`,
    `system.sha256: ${await sha256(system)}`,
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
        const dump = await 직렬화(조립(text, mode, model));
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
