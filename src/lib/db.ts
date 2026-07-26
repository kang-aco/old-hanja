/** D1 접근 계층 — 캐시 / 검색기록 / 시드 데이터 조회 */
import type { Analysis } from './analysis';

// ── 분석 캐시 ───────────────────────────────────────────────────────────────

export async function getCachedAnalysis(
  db: D1Database,
  textHash: string,
): Promise<{ result: Analysis; model: string } | null> {
  const row = await db
    .prepare('SELECT result_json, model FROM analyses WHERE text_hash = ?')
    .bind(textHash)
    .first<{ result_json: string; model: string }>();
  if (!row) return null;
  try {
    return { result: JSON.parse(row.result_json) as Analysis, model: row.model };
  } catch {
    return null;
  }
}

export async function putCachedAnalysis(
  db: D1Database,
  textHash: string,
  originalText: string,
  result: Analysis,
  model: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO analyses (text_hash, original_text, result_json, model)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(text_hash) DO UPDATE SET
         result_json = excluded.result_json,
         model       = excluded.model,
         created_at  = datetime('now')`,
    )
    .bind(textHash, originalText, JSON.stringify(result), model)
    .run();
}

// ── 검색 기록 ───────────────────────────────────────────────────────────────

export async function logSearch(
  db: D1Database,
  textHash: string,
  originalText: string,
  cacheHit: boolean,
): Promise<void> {
  await db
    .prepare('INSERT INTO search_logs (text_hash, original_text, cache_hit) VALUES (?, ?, ?)')
    .bind(textHash, originalText, cacheHit ? 1 : 0)
    .run();
}

export async function recentSearches(db: D1Database, limit = 5) {
  // text_hash 가 아니라 원문으로 묶는다. 캐시 키에 mode 가 들어가므로 같은 구절을
  // light/deep 으로 각각 분석하면 해시가 둘이 되어 목록에 중복으로 나온다.
  const { results } = await db
    .prepare(
      `SELECT original_text, MIN(text_hash) AS text_hash, MAX(created_at) AS created_at
         FROM search_logs
        GROUP BY original_text
        ORDER BY created_at DESC
        LIMIT ?`,
    )
    .bind(limit)
    .all<{ original_text: string; text_hash: string; created_at: string }>();
  return results ?? [];
}

/** 오늘 발생한 실제 API 호출 수 (캐시 미스) — 일일 상한 계산용 */
export async function todayApiCalls(db: D1Database): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM search_logs
        WHERE cache_hit = 0 AND date(created_at) = date('now')`,
    )
    .first<{ n: number }>();
  return row?.n ?? 0;
}

// ── 시드 데이터 조회 ────────────────────────────────────────────────────────

export interface IdiomRow {
  hanja: string;
  eum: string;
  meaning: string;
  source: string | null;
  story: string | null;
}

/** 구절에 등장한 한자들로 고사성어를 찾는다 (D1 = 비용 0) */
export async function findIdioms(
  db: D1Database,
  hanjaChars: string[],
  limit = 6,
): Promise<IdiomRow[]> {
  if (hanjaChars.length === 0) return [];
  const uniq = [...new Set(hanjaChars)].slice(0, 12);
  const clauses = uniq.map(() => '(hanja LIKE ? OR keywords LIKE ?)').join(' OR ');
  const binds = uniq.flatMap((c) => [`%${c}%`, `%${c}%`]);
  const { results } = await db
    .prepare(
      `SELECT hanja, eum, meaning, source, story FROM idioms WHERE ${clauses} LIMIT ?`,
    )
    .bind(...binds, limit)
    .all<IdiomRow>();
  return results ?? [];
}

export interface PassageRow {
  passage: string;
  eum: string | null;
  source: string;
  chapter: string | null;
  modern_korean: string;
  english: string | null;
}

export async function findPassages(
  db: D1Database,
  hanjaChars: string[],
  limit = 6,
): Promise<PassageRow[]> {
  if (hanjaChars.length === 0) return [];
  const uniq = [...new Set(hanjaChars)].slice(0, 12);
  const clauses = uniq.map(() => '(passage LIKE ? OR keywords LIKE ?)').join(' OR ');
  const binds = uniq.flatMap((c) => [`%${c}%`, `%${c}%`]);
  const { results } = await db
    .prepare(
      `SELECT passage, eum, source, chapter, modern_korean, english
         FROM passages WHERE ${clauses} LIMIT ?`,
    )
    .bind(...binds, limit)
    .all<PassageRow>();
  return results ?? [];
}

// ── 커리큘럼 ────────────────────────────────────────────────────────────────

export interface CurriculumRow {
  id: number;
  passage: string;
  eum: string | null;
  source: string;
  chapter: string | null;
  difficulty: number;
  hanja_count: number | null;
  curriculum_order: number | null;
}

/**
 * 난이도순 연습 구절 목록.
 *
 * ※ modern_korean(정답 해석)을 일부러 빼고 읽는다.
 * 이 목록은 커리큘럼 페이지에서 서버 렌더링되므로, 넣으면 정답이 HTML 소스에
 * 그대로 실려 나간다. "먼저 스스로 풀어본다"는 기능의 전제가 깨진다.
 * 정답은 사용자가 답을 제출한 뒤 /api/analyze 응답으로 받는다.
 *
 * difficulty 가 NULL 인 행은 아직 등급이 없는 구절이므로 목록에서 제외한다.
 * 정렬은 idx_passages_difficulty (difficulty, curriculum_order) 를 그대로 탄다.
 */
export async function listCurriculum(
  db: D1Database,
  difficulty?: number,
): Promise<CurriculumRow[]> {
  const cols = `id, passage, eum, source, chapter, difficulty, hanja_count, curriculum_order`;
  const stmt =
    difficulty === undefined
      ? db
          .prepare(
            `SELECT ${cols} FROM passages
              WHERE difficulty IS NOT NULL
              ORDER BY difficulty ASC, curriculum_order ASC, id ASC`,
          )
      : db
          .prepare(
            `SELECT ${cols} FROM passages
              WHERE difficulty = ?
              ORDER BY curriculum_order ASC, id ASC`,
          )
          .bind(difficulty);
  const { results } = await stmt.all<CurriculumRow>();
  return results ?? [];
}

export interface CharacterRow {
  hanja: string;
  eum: string;
  hun: string;
  radical: string | null;
  stroke_count: number | null;
  note: string | null;
}

export async function getCharacter(db: D1Database, hanja: string): Promise<CharacterRow | null> {
  return await db
    .prepare('SELECT hanja, eum, hun, radical, stroke_count, note FROM characters WHERE hanja = ?')
    .bind(hanja)
    .first<CharacterRow>();
}

/** 한글 음 → 한자 후보 (입력 보조 자동완성) */
export async function charactersByEum(
  db: D1Database,
  eum: string,
  limit = 12,
): Promise<CharacterRow[]> {
  const { results } = await db
    .prepare(
      `SELECT hanja, eum, hun, radical, stroke_count, note
         FROM characters
        WHERE eum = ? OR eum LIKE ? OR eum LIKE ? OR eum LIKE ?
        ORDER BY (eum = ?) DESC, stroke_count ASC
        LIMIT ?`,
    )
    .bind(eum, `${eum},%`, `%,${eum}`, `%,${eum},%`, eum, limit)
    .all<CharacterRow>();
  return results ?? [];
}

export interface RadicalRow {
  id: number;
  radical: string;
  name: string;
  meaning: string;
  stroke_count: number;
  variants: string | null;
  mnemonic: string | null;
}

export async function getRadical(db: D1Database, radical: string): Promise<RadicalRow | null> {
  return await db
    .prepare(
      `SELECT id, radical, name, meaning, stroke_count, variants, mnemonic
         FROM radicals WHERE radical = ? OR variants LIKE ?`,
    )
    .bind(radical, `%${radical}%`)
    .first<RadicalRow>();
}

export async function listRadicals(db: D1Database): Promise<RadicalRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, radical, name, meaning, stroke_count, variants, mnemonic
         FROM radicals ORDER BY stroke_count ASC, id ASC`,
    )
    .all<RadicalRow>();
  return results ?? [];
}

export async function charactersByRadical(
  db: D1Database,
  radical: string,
  limit = 20,
): Promise<CharacterRow[]> {
  const { results } = await db
    .prepare(
      `SELECT hanja, eum, hun, radical, stroke_count, note
         FROM characters WHERE radical = ? ORDER BY stroke_count ASC LIMIT ?`,
    )
    .bind(radical, limit)
    .all<CharacterRow>();
  return results ?? [];
}
