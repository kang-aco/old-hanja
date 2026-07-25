-- 한문독해 (hanmun-app) — Cloudflare D1 스키마
-- 적용:  npm run db:migrate:local   /   npm run db:migrate
-- 주의: 이 파일은 멱등(idempotent)하지 않습니다. 재실행 시 테이블을 지우고 다시 만듭니다.

DROP TABLE IF EXISTS pos_chars;
DROP TABLE IF EXISTS pos_patterns;
DROP TABLE IF EXISTS function_words;
DROP TABLE IF EXISTS sentence_patterns;
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
-- 6-1. 한문 품사 (UD Classical Chinese · Kyoto 트리뱅크에서 생성)
--      출처 표기 필수 · CC BY-SA 4.0. scripts/build-pos.mjs 로 생성한다.
--      AI 없이 글자별 품사를 붙이기 위한 표. 조회 비용이 0 이다.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE pos_chars (
  hanja     TEXT PRIMARY KEY,
  upos      TEXT NOT NULL,   -- 코퍼스에서 가장 흔한 품사 (NOUN/VERB/PART …)
  pos_ko    TEXT NOT NULL,   -- 한국어 품사명 (명사/동사/어조사 …)
  detail    TEXT,            -- 트리뱅크 세부 분류 (예: p,助詞,接続,属格)
  gloss     TEXT,            -- 대표 뜻 (영문)
  freq      INTEGER NOT NULL,-- 코퍼스 출현 횟수
  dist_json TEXT             -- 품사 분포 JSON. 之·而 처럼 다의적인 글자를 드러낸다
);
CREATE INDEX idx_pos_chars_freq ON pos_chars (freq DESC);

-- 6-2. 문형 패턴 (품사 2~3연속 n-gram)
CREATE TABLE pos_patterns (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern       TEXT NOT NULL UNIQUE,  -- 예: "NOUN VERB NOUN"
  pattern_ko    TEXT NOT NULL,         -- 예: "명사+동사+명사"
  n             INTEGER NOT NULL,      -- 2 또는 3
  freq          INTEGER NOT NULL,
  example       TEXT,                  -- 코퍼스 예시 구절
  example_gloss TEXT                   -- 예시의 글자별 뜻
);
CREATE INDEX idx_pos_patterns_lookup ON pos_patterns (pattern);

-- ─────────────────────────────────────────────────────────────────────────
-- 6-3. 허사(虛辭) 사전 — 직접 작성한 문법 지식
--      pos_chars(코퍼스 통계)와 상호 보완한다. 통계는 "之가 속격 57% / 대명사 41%"
--      까지만 알려 주지만, 여기에는 "어느 자리에 오면 무엇인지" 판별 규칙을 담는다.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE function_words (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  hanja         TEXT NOT NULL UNIQUE,
  role          TEXT NOT NULL,   -- 관형격조사 / 종결어기사 / 의문어기사 …
  position_hint TEXT NOT NULL,   -- 위치에 따라 기능이 어떻게 갈리는지
  example       TEXT,            -- 대표 예구
  example_ko    TEXT             -- 예구의 풀이
);

-- 6-4. 정형 문형(定型 文型) — 是……也, 不亦……乎, 爲……所…… 같은 굳은 구문
--      ……(U+2026 두 개)는 임의의 글자를 뜻하는 자리표다. 조회 시 정규식으로 바꿔 맞춘다.
--      품사 n-gram 은 통계적 근사이지만 이쪽은 문자열이 정확히 일치해야 잡히므로
--      오탐이 없다.
CREATE TABLE sentence_patterns (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern        TEXT NOT NULL UNIQUE,  -- 예: 不亦……乎
  pattern_type   TEXT NOT NULL,         -- 판단문 / 의문문 / 피동문 / 사역문 …
  explanation    TEXT NOT NULL,
  example_hanja  TEXT,
  example_korean TEXT,
  priority       INTEGER NOT NULL DEFAULT 0  -- 클수록 먼저 보여 준다
);
CREATE INDEX idx_sentence_patterns_priority ON sentence_patterns (priority DESC);

-- ─────────────────────────────────────────────────────────────────────────
-- 7. 고전 명구 (연관 문장 추천)
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
