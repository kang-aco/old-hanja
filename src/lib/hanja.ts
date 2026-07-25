/**
 * 한자 판별 — 프로젝트 전체에서 이 파일의 정의만 쓴다.
 *
 * ※ 반드시 \u 이스케이프로 쓸 것.
 *   예전에 범위를 리터럴 한자로 적다가 CJK 호환 한자의 시작을 U+F900 이 아니라
 *   豈(U+8C48) 로 잘못 써서, 잘못된 범위 U+8C48–U+FAFF 안에 한글 음절
 *   (U+AC00–U+D7A3)이 통째로 들어가 한글까지 한자로 판정되는 버그가 있었다.
 *   그 결과 어순 재구성의 한국어 풀이("배우고")까지 한자로 감싸져 사전 팝업이 열렸다.
 *
 * 범위
 *   U+3400–U+4DBF  CJK 통합 한자 확장 A
 *   U+4E00–U+9FFF  CJK 통합 한자
 *   U+F900–U+FAFF  CJK 호환 한자
 *
 * 확장 B 이상(U+20000~)은 서로게이트 쌍이라 별도 처리가 필요하고, 고전 구절에서는
 * 거의 쓰이지 않으므로 포함하지 않는다.
 */
export const HANJA_CLASS = '[\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF]';

const ONE = new RegExp(HANJA_CLASS);
const ALL = new RegExp(HANJA_CLASS, 'g');

/** 한자가 한 글자라도 들어 있는지 */
export function hasHanja(text: string): boolean {
  return ONE.test(text);
}

/** 한자만 원문 순서대로 뽑아낸다 (중복 제거하지 않음) */
export function extractHanja(text: string): string[] {
  return text.match(ALL) ?? [];
}

/** 한자 한 글자인지 */
export function isSingleHanja(text: string): boolean {
  return new RegExp(`^${HANJA_CLASS}$`).test(text);
}
