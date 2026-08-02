/**
 * 프롬프트 조립 — 입력을 받아 문자열과 요청 파라미터만 반환한다.
 *
 * 이 파일 안에서 네트워크·DB·시계를 건드리지 않는다. 매번 결과가 달라지는 구간(AI 호출)을
 * 한 칸으로 격리하기 위한 층 분리다. 덕분에 프롬프트와 요청 파라미터를 API 호출 없이
 * 테스트로 고정할 수 있다.
 *
 * 실제로 사고가 났던 곳은 프롬프트 내용보다 요청 파라미터였다.
 *  - max_tokens 를 4000 으로 고정해 두어 긴 구절의 JSON 이 잘렸다.
 *  - 교정 호출의 max_tokens 가 700 이라 sonnet 의 사고 토큰이 예산을 다 먹고
 *    JSON 이 나오지 않았다 (교정 3/3 무효).
 *  - sonnet-5 는 adaptive thinking 이 기본 ON 인데 끄지 않아 출력이 약 2배가 됐다.
 * 그래서 buildAnalysisRequest 로 요청 파라미터까지 함께 순수 함수로 감싼다.
 *
 * ※ SYSTEM_PROMPT 와 ANALYSIS_SCHEMA 는 analysis.ts 에서 내용 변경 없이 그대로 옮겨왔다.
 *   옮긴 것이 바이트 단위로 같음은 tests/__snapshots__/request-*.txt 가 증명한다.
 */
import { maxTokensFor, type Mode } from './analysis';
import { extractHanja } from './hanja';

// ── 시스템 프롬프트 ─────────────────────────────────────────────────────────
// 짧게 유지한다 = 매 호출 입력 토큰이 줄어든다.

export const SYSTEM_PROMPT = `당신은 한문 고전 번역 전문가입니다. 한문 구절을 영어 구문독해처럼 단계별로 분해해 설명합니다.

[각 필드]
- eum: 원문 전체의 한글 독음. 예) 학이시습지 불역열호
  ※ 不의 독음은 뒤 글자의 초성으로 갈립니다. 양쪽을 모두 지키십시오.
    초성이 ㄷ 또는 ㅈ 이면 "부" — 不知(부지) 不正(부정) 不動(부동) 不足(부족) 不當(부당)
    그 밖의 초성이면 "불" — 不亦(불역) 不可(불가) 不仁(불인) 不學(불학) 不能(불능)
  ※ 說은 기쁘다는 뜻일 때 "열"로 읽는다. 不亦說乎 = 불역열호.
- source_guess: 확실할 때만 book/chapter 를 채웁니다. 모르면 confidence="unknown", book="미상", chapter="". note 는 이체자·판본 메모(없으면 "").
- word_order_reconstruction: 이 분석의 핵심입니다. 한국어 어순으로 재배열하되 한자를 괄호와 함께 남겨 어느 글자가 어디로 갔는지 보이게 씁니다. 허사(之 而 於 以 者 所 則 乎 也 矣 焉)의 기능을 괄호 안에 드러내십시오. 빈 괄호를 남기지 마십시오.
  예) 學而時習之, 不亦說乎
   → [學(배우)而(고) 時(때때로) 之(그것을) 習(익히면)] 不亦(어찌 ~않으랴) 說(기쁘)乎(겠는가)
  이 예시처럼 원문의 모든 글자가 빠짐없이 나타나야 합니다. 한국어는 목적어가 동사 앞에
  오므로 목적어 之가 習 앞으로 옮겨진 것을 보십시오.
  구절이 길면 문장 단위로 줄을 나눕니다.
  ※ 반드시 "한자(풀이)" 순서로 쓰십시오. "풀이(한자)"처럼 뒤집으면 안 됩니다.
    바름) 習(익히면)   틀림) 익히면(習)
  ※ 부정사 不·未·非·勿는 뒤 글자와 반드시 붙여서 한 덩어리로 묶으십시오.
    바름) 不思(생각하지 않으면)  不學(배우지 않으면)  不同(같지 않고)
    틀림) 不(생각하지) 思(않으면)   ← 두 글자의 뜻이 서로 뒤바뀜
    틀림) 不(~지) 同(같지 않으며)   ← 不의 괄호에 부정의 뜻이 없음
  ※ 대구(對句)로 짝을 이루는 구절은 짝마다 대괄호를 따로 씌우십시오.
    예) 學而不思則罔, 思而不學則殆
     → [學(배우)而(고) 不思(생각하지 않으면) 則(곧) 罔(막연하다)]
        [思(생각하)而(고) 不學(배우지 않으면) 則(곧) 殆(위태롭다)]
    다만 대칭은 원문에 있는 글자만으로 드러내십시오. 두 절의 모양을 맞추려고
    원문에 없는 글자를 넣거나 있는 글자를 빼면 안 됩니다.
    원문 충실이 대칭보다 언제나 우선입니다.
    짝을 이루는 두 절이라도 글자 수와 구성은 서로 다를 수 있습니다.
    앞 절에 있는 글자가 뒤 절에 없으면 없는 채로 두십시오.
    예) 知之爲知之, 不知爲不知 — 앞 절에는 之가 두 번 있지만 뒤 절에는 之가
        하나도 없습니다. 뒤 절에 之를 만들어 넣으면 틀립니다.
    쓰기 전에 원문의 글자를 하나씩 세어 보고, 재구성한 결과의 글자와
    개수가 정확히 같은지 확인하십시오.
  ※ 대괄호는 절(節) 단위로만 씌우십시오. 글자마다 [ ]를 씌우면 읽기 어렵습니다.
  ※ 之가 동사 뒤 목적어일 때는 반드시 "그것을"처럼 대명사로 푸십시오.
    習之 = 習(익히)之(그것을). 之(할)·之(도록 한다)·之(~을)처럼 어미로 풀면 틀립니다.
    之가 명사와 명사 사이에 있을 때만 관형격 "~의"로 풉니다.
- methodology: 이 구절에 실제로 적용된 기법만 정확히 2개. 일반론 나열 금지. example 은 구절 안의 짧은 예.
- related_idioms 2개, related_passages 2개. connection/context 에 왜 연관되는지 밝힙니다.

[금지]
- 원문의 글자를 고치지 마십시오.
- 없는 출전·없는 명구를 지어내지 마십시오. 확실하지 않으면 널리 알려진 것만 쓰십시오.

[분량 — 반드시 지킬 것]
- 설명 필드(explanation, connection, context, note)는 한 문장, 45자 이내.
- meaning 은 단어나 짧은 구.
- 같은 내용을 여러 필드에서 되풀이하지 마십시오.
- 지정된 개수를 초과하지 마십시오. 많이 쓰는 것보다 정확한 것이 좋은 답입니다.

[문체] 한국어. 고등학생이 읽을 수 있는 평이한 문장.

[한문이 아닌 입력] modern_korean 에 분석할 수 없는 이유를 한 문장으로 적고, 배열 필드는 모두 빈 배열로 두십시오.`;

// ── Structured Outputs 스키마 ──────────────────────────────────────────────
// 제약: 모든 object 는 additionalProperties:false + 전 속성 required.
//       minLength / maxItems 등 수치 제약은 미지원 → 프롬프트로 통제한다.

// 스키마 설명문(description)은 매 요청의 입력 토큰으로 과금되므로 최소한만 남긴다.
// 세부 규칙은 위 SYSTEM_PROMPT 에서 한 번만 지시한다.

const obj = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

const S = { type: 'string' };
const arr = (items: unknown) => ({ type: 'array', items });

export const ANALYSIS_SCHEMA = obj({
  original: S,
  eum: S,
  source_guess: obj({
    book: S,
    chapter: S,
    confidence: { type: 'string', enum: ['high', 'medium', 'low', 'unknown'] },
    note: S,
  }),
  word_order_reconstruction: S,
  modern_korean: S,
  english_translation: S,
  methodology: arr(obj({ technique: S, explanation: S, example: S })),
  related_idioms: arr(obj({ idiom: S, eum: S, meaning: S, source: S, connection: S })),
  related_passages: arr(obj({ passage: S, eum: S, source: S, modern_korean: S, context: S })),
});

// ── 조립 ───────────────────────────────────────────────────────────────────

export interface PromptInput {
  /** 정규화된(normalize 를 거친) 한문 구절 */
  text: string;
  mode: Mode;
}

export interface Prompt {
  system: string;
  user: string;
}

/**
 * 프롬프트 문자열만 만든다.
 *
 * mode 는 system 프롬프트를 바꾸지 않는다. 정밀 모드는 프롬프트를 늘리는 것이 아니라
 * 모델을 바꾸는 방식이다(resolveModel). 그래서 두 모드의 system 은 동일하다.
 * 나중에 모드별로 지침을 달리하게 되면 이 함수가 그 자리다.
 */
export function buildPrompt(input: PromptInput): Prompt {
  return {
    system: SYSTEM_PROMPT,
    user: `[분석할 한문 구절]\n${input.text}`,
  };
}

/**
 * SDK 에 그대로 넘길 요청 파라미터.
 *
 * 한자 수는 text 에서 직접 구한다. 인자로 받으면 잘못된 값을 넘길 수 있고,
 * max_tokens 가 실제 입력과 어긋나면 응답이 잘린다 — 그 사고가 실제로 있었다.
 *
 * thinking 을 deep 에만 붙이는 이유:
 *  - haiku-4-5 는 thinking 파라미터 자체를 지원하지 않으므로 보내지 않는다.
 *  - sonnet-5 는 adaptive thinking 이 기본 ON 이라 명시적으로 끈다. 켜면 출력 토큰이
 *    약 2배가 된다. 구조화된 추출 작업이라 사고를 끄더라도 정확도 이득은 남는다.
 */
export function buildAnalysisRequest(
  input: PromptInput,
  model: string,
): Record<string, unknown> {
  const { system, user } = buildPrompt(input);
  const params: Record<string, unknown> = {
    model,
    max_tokens: maxTokensFor(input.mode, extractHanja(input.text).length),
    system,
    messages: [{ role: 'user', content: user }],
    output_config: { format: { type: 'json_schema', schema: ANALYSIS_SCHEMA } },
  };
  if (input.mode === 'deep') params.thinking = { type: 'disabled' };
  return params;
}
