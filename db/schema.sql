-- 한문독해 (hanmun-app) — Cloudflare D1 스키마
-- 적용:  npm run db:migrate:local   /   npm run db:migrate
-- 주의: 이 파일은 멱등(idempotent)하지 않습니다. 재실행 시 테이블을 지우고 다시 만듭니다.

DROP TABLE IF EXISTS analyses;
DROP TABLE IF EXISTS search_logs;
DROP TABLE IF EXISTS idioms;
DROP TABLE IF EXISTS radicals;
DROP TABLE IF EXISTS characters;
DROP TABLE IF EXISTS passages;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. 분석 결과 캐시 (LLM 호출 절감 + 오프라인 재조회)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE analyses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  text_hash     TEXT NOT NULL UNIQUE,   -- 정규화된 원문의 SHA-256
  original_text TEXT NOT NULL,
  result_json   TEXT NOT NULL,          -- Analysis JSON 전문
  model         TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. 검색 기록 (홈 화면 "최근 검색 5개", 인기 구절 집계)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE search_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  text_hash     TEXT NOT NULL,
  original_text TEXT NOT NULL,
  cache_hit     INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_search_logs_created ON search_logs (created_at DESC);
CREATE INDEX idx_search_logs_hash    ON search_logs (text_hash);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. 고사성어
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE idioms (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  hanja    TEXT NOT NULL UNIQUE,
  eum      TEXT NOT NULL,          -- 한글 음 (예: 온고지신)
  meaning  TEXT NOT NULL,
  source   TEXT,                   -- 출전 (예: 논어 위정)
  story    TEXT,                   -- 유래 / 스토리텔링
  keywords TEXT                    -- 검색용 키워드 (공백 구분)
);
CREATE INDEX idx_idioms_eum      ON idioms (eum);
CREATE INDEX idx_idioms_keywords ON idioms (keywords);

-- ─────────────────────────────────────────────────────────────────────────
-- 4. 부수 (강희부수 214개)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE radicals (
  id           INTEGER PRIMARY KEY,   -- 강희부수 번호 1~214
  radical      TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,         -- 훈+음 (예: 아들 자)
  meaning      TEXT NOT NULL,         -- 의미 설명
  stroke_count INTEGER NOT NULL,
  variants     TEXT,                  -- 변형 부수 (예: 亻)
  mnemonic     TEXT                   -- 암기 팁
);
CREATE INDEX idx_radicals_strokes ON radicals (stroke_count);

-- ─────────────────────────────────────────────────────────────────────────
-- 5. 한자 (음→한자 변환, 한자 팝업, 같은 부수 묶기)
-- ─────────────────────────────────────────────────────────────────────────
-- Unihan(유니코드 공식 데이터)에서 생성한 8,500여 자.
-- hun(한국어 훈)은 Unihan 에 없어서 큐레이션한 182자에만 채워져 있고, 나머지는 NULL 이다.
-- 팝업에서는 hun 이 없으면 분석 결과의 훈이나 definition(영문 뜻)으로 대체한다.
CREATE TABLE characters (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  hanja        TEXT NOT NULL UNIQUE,
  eum          TEXT NOT NULL,         -- 음. 여러 독음은 쉼표 구분 (예: 구,귀,균)
  hun          TEXT,                  -- 훈 (예: 배울). 큐레이션분만 존재
  radical      TEXT,                  -- radicals.radical 참조
  stroke_count INTEGER,
  note         TEXT,                  -- 자원(字源) / 암기 메모
  definition   TEXT                   -- Unihan 영문 뜻 (훈이 없을 때 보조)
);
CREATE INDEX idx_characters_eum     ON characters (eum);
CREATE INDEX idx_characters_radical ON characters (radical);

-- ─────────────────────────────────────────────────────────────────────────
-- 6. 고전 명구 (연관 문장 추천)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE passages (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  passage        TEXT NOT NULL,
  eum            TEXT,
  source         TEXT NOT NULL,       -- 책명
  chapter        TEXT,                -- 편/장
  modern_korean  TEXT NOT NULL,
  english        TEXT,
  keywords       TEXT
);
CREATE INDEX idx_passages_keywords ON passages (keywords);
CREATE INDEX idx_passages_source   ON passages (source);
