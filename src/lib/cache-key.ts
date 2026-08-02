/**
 * 분석 캐시 키 — 결과를 결정하는 요소를 한 곳에 모은다.
 *
 * 이 프로젝트는 캐시 키로 두 번 사고를 냈고, 두 번 다 원인이 같았다.
 * 결과를 결정하는 요소가 여러 곳에 흩어져 있어 사람이 기억해야 했다는 것이다.
 *
 *  (1) mode 가 키에 빠져 있었다. light 로 한 번 분석한 구절은 "정밀 분석"을 켜도
 *      캐시된 Haiku 결과가 그대로 반환되어 토글이 아무 효과가 없었다.
 *  (2) ANALYSIS_VERSION 이 키에 없었다. 교정 로직을 고쳐 배포했는데도 이미 분석된
 *      구절은 낡은 결과가 영구히 서빙되어 프로덕션 검증 자체가 막혔다.
 *
 * 그래서 키를 만드는 코드는 이 파일의 이 함수 하나뿐이어야 한다.
 * 새 요소가 결과를 가르게 되면(예: 프롬프트 언어 옵션) 여기에 넣는다.
 *
 * ※ analysis.ts 는 이 파일을 import 하지 않는다. 이 파일이 analysis.ts 를
 *   참조하므로(ANALYSIS_VERSION, normalize, Mode), 반대 방향이 생기면 순환이 된다.
 */
import { ANALYSIS_VERSION, normalize, type Mode } from './analysis';
import { sha256 } from './hash';

/**
 * 캐시 키(SHA-256 16진 64자).
 *
 * 해시로 두는 이유: D1 의 `analyses.text_hash` 는 UNIQUE 인덱스가 걸린 컬럼이고
 * 스키마 주석이 "정규화된 원문의 SHA-256" 이라고 못박고 있다. 조립 문자열을 그대로
 * 키로 쓰면 원문이 키 컬럼에 실려 컬럼의 의미가 깨진다.
 *
 * 구분자는 공백 한 칸이다. 앞의 두 필드(버전·mode)는 우리가 통제하는 공백 없는
 * 값이고 자유 입력인 text 가 맨 뒤라, 이 형식에는 파싱 애매성이 생길 수 없다.
 * 구분자를 바꾸면 그 자체로 전 캐시가 무효가 되므로 함부로 손대지 않는다.
 * (과거 이 자리에 널 문자 U+0000 이 들어가 정규식 교체가 세 번 실패한 이력이 있다.)
 *
 * normalize 를 함수 안에서 부르는 이유: 호출자가 정규화를 잊으면 눈에 똑같은 구절이
 * 다른 키를 받아 두 번 과금된다 — 정확히 이 파일이 막으려는 종류의 사고다.
 * normalize 는 멱등이므로 이미 정규화된 값을 넘겨도 결과가 같다
 * (tests/cache-key.test.ts 가 그 멱등성을 직접 검사한다).
 */
export async function cacheKey(text: string, mode: Mode): Promise<string> {
  return sha256(`${ANALYSIS_VERSION} ${mode} ${normalize(text)}`);
}
