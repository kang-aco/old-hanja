-- 001 · 커리큘럼 — passages 에 난이도 정보를 붙인다
--
-- 적용:
--   로컬  npx wrangler d1 execute hanmun-db --local  --file=./db/migrations/001-curriculum.sql
--   원격  npx wrangler d1 execute hanmun-db --remote --file=./db/migrations/001-curriculum.sql
--
-- 왜 schema.sql 을 고치지 않고 별도 파일로 두는가:
-- schema.sql 은 DROP TABLE 로 시작하는 재생성 스크립트다. 컬럼을 추가하려고 그것을
-- 다시 돌리면 analyses(분석 캐시)와 search_logs(검색 기록)까지 함께 지워진다.
-- 캐시가 비면 이미 분석된 구절도 다음 조회 때 실제 API 호출이 일어나 비용이 든다.
-- 그래서 기존 데이터를 건드리지 않는 ALTER 만으로 바꾼다.
--
-- ※ 한 번만 실행하십시오.
--   D1(SQLite)의 ALTER TABLE ADD COLUMN 에는 IF NOT EXISTS 가 없습니다. 두 번째
--   실행은 "duplicate column name: difficulty" 로 실패합니다. 실패해도 앞서 적용된
--   변경이 되돌아가지는 않으니, 그 오류가 보이면 이미 적용된 것으로 보면 됩니다.
--
-- ※ 새로 만드는 DB 에는 실행하지 마십시오.
--   db/schema.sql 의 passages 정의에 아래 세 컬럼이 이미 들어 있습니다.
--   npm run db:reset:local 로 만든 DB 는 이 마이그레이션이 필요 없습니다.

-- 난이도 1~5. NULL 은 아직 등급이 매겨지지 않은 구절을 뜻하며, 커리큘럼 목록에서 빠진다.
ALTER TABLE passages ADD COLUMN difficulty INTEGER;

-- 구절에 담긴 한자 수. 목록 표시와 정렬에 쓰므로 조회 때마다 세지 않고 미리 넣어 둔다.
ALTER TABLE passages ADD COLUMN hanja_count INTEGER;

-- 같은 난이도 안에서의 학습 순서. 작을수록 먼저 푼다.
ALTER TABLE passages ADD COLUMN curriculum_order INTEGER;

-- 커리큘럼 목록은 "난이도순 → 같은 난이도 안에서는 지정 순서" 로만 읽는다.
-- 이 복합 인덱스 하나로 그 정렬이 그대로 처리된다.
CREATE INDEX IF NOT EXISTS idx_passages_difficulty ON passages (difficulty, curriculum_order);
