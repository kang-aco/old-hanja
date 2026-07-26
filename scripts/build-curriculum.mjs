#!/usr/bin/env node
/**
 * 명구 40건에 학습 난이도(1~5)를 매겨 db/seed/curriculum.sql 을 만든다.
 *
 *   node scripts/build-curriculum.mjs           산출 + 파일 쓰기
 *   node scripts/build-curriculum.mjs --dry-run 표만 출력 (파일을 쓰지 않음)
 *
 * 왜 스크립트로 만드는가: 40건을 손으로 매기면 기준이 사람 기분에 따라 흔들린다.
 * 여기서는 이미 D1 에 있는 데이터만으로 점수를 내므로 기준이 일정하고 재현된다.
 * AI 를 쓰지 않으니 비용도 0 이다. 다만 마지막 등급 확정은 사람이 손보는 것을
 * 전제로 한다 — 산출값은 출발점이고, 보정한 결과가 db/seed/curriculum.sql 에 남는다.
 *
 * 난이도를 이루는 세 가지 (가중치)
 *  1) 길이      0.40  한자 수. 4자와 12자는 체감이 크게 다르다.
 *  2) 글자 희귀도 0.35  pos_chars.freq (UD Kyoto 코퍼스 86,239문장 출현 빈도).
 *                      기하평균으로 전반적 낯섦을, 최솟값으로 "한 글자가 발목을
 *                      잡는" 경우를 각각 잡는다. 唇亡齒寒 은 4자뿐이지만 齒·唇 이
 *                      드물어 4자 구절 중에서는 어렵다.
 *  3) 문법 부담  0.25  허사(function_words) 개수 + 정형 문형(sentence_patterns) 일치.
 *                      之·而·於 처럼 자리에 따라 뜻이 갈리는 글자가 많을수록 어렵다.
 *
 * 데이터는 db/seed/*.sql 을 메모리 SQLite 에 부어서 읽는다. wrangler 나 D1 이
 * 없어도 돌고, 앱이 실제로 쓰는 것과 같은 표를 그대로 본다.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const OUT = path.join('db', 'seed', 'curriculum.sql');
const DRY = process.argv.includes('--dry-run');

// src/lib/hanja.ts 와 같은 범위. 여기만 따로 두면 어긋나므로 주석으로 묶어 둔다.
const HANJA = /[㐀-䶿一-鿿豈-﫿]/gu;

/** pos_chars 에 없는 글자의 빈도 대용값. 코퍼스에 안 나오면 드문 글자로 본다. */
const UNKNOWN_FREQ = 3;

// ── 데이터 적재 ─────────────────────────────────────────────────────────────

const db = new DatabaseSync(':memory:');
db.exec(readFileSync(path.join('db', 'schema.sql'), 'utf8'));
for (const f of ['passages.sql', 'pos.sql', 'grammar.sql']) {
  db.exec(readFileSync(path.join('db', 'seed', f), 'utf8'));
}

const freqOf = new Map(
  db.prepare('SELECT hanja, freq FROM pos_chars').all().map((r) => [r.hanja, r.freq]),
);
const functionWords = new Set(
  db.prepare('SELECT hanja FROM function_words').all().map((r) => r.hanja),
);
const patterns = db.prepare('SELECT pattern FROM sentence_patterns').all().map((r) => r.pattern);
const passages = db
  .prepare('SELECT id, passage, eum, source, modern_korean FROM passages ORDER BY id')
  .all();

// ── 신호 계산 ───────────────────────────────────────────────────────────────

/**
 * 정형 문형이 몇 개나 걸리는지 센다.
 * …… 자리표 처리는 src/pages/api/pos.ts 의 매칭과 같아야 한다. 게으른 수량자를
 * 쓰지 않으면 不……不…… 같은 패턴이 문장 끝까지 삼켜 과다 집계된다.
 */
function countPatterns(hanjaOnly) {
  let n = 0;
  for (const pat of patterns) {
    const parts = pat.split('……').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const source = parts.join('[\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF]{0,8}?');
    try {
      if (new RegExp(source).test(hanjaOnly)) n++;
    } catch {
      /* 잘못된 패턴은 건너뛴다 */
    }
  }
  return n;
}

const clamp01 = (x) => Math.max(0, Math.min(1, x));
/** 로그 구간 정규화. 빈도는 배수로 체감되므로 선형이 아니라 로그로 눕힌다. */
const logNorm = (v, lo, hi) => clamp01((Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo)));

function measure(row) {
  const chars = [...(row.passage.match(HANJA) ?? [])];
  const freqs = chars.map((c) => freqOf.get(c) ?? UNKNOWN_FREQ);
  const hanjaOnly = chars.join('');

  // 기하평균 — 산술평균을 쓰면 之(수천 회) 하나가 드문 글자들을 덮어 버린다.
  const geoFreq = Math.exp(freqs.reduce((s, f) => s + Math.log(f), 0) / freqs.length);
  const minFreq = Math.min(...freqs);
  const fwCount = chars.filter((c) => functionWords.has(c)).length;
  const patCount = countPatterns(hanjaOnly);

  // 관측 범위(한자수 4~12, 기하평균 55~3400, 최솟값 2~1240)에 맞춰 눈금을 잡는다.
  const lenScore = clamp01((chars.length - 4) / (12 - 4));
  const rarityScore =
    0.6 * (1 - logNorm(geoFreq, 50, 3500)) + 0.4 * (1 - logNorm(Math.max(minFreq, 2), 2, 1300));
  const grammarScore = 0.65 * clamp01(fwCount / 3) + 0.35 * clamp01(patCount / 2);

  const score = 0.4 * lenScore + 0.35 * rarityScore + 0.25 * grammarScore;

  return {
    ...row,
    hanja_count: chars.length,
    geoFreq: Math.round(geoFreq),
    minFreq,
    fwCount,
    patCount,
    lenScore,
    rarityScore,
    grammarScore,
    score,
  };
}

const scored = passages.map(measure);

// ── 등급 매기기 ─────────────────────────────────────────────────────────────
//
// 고정 임계값으로 자른다. 5분위로 강제하면 40건이 8건씩 정확히 나뉘어 보기에는
// 좋지만, 실제로 비슷한 난이도인 구절이 등급 경계로 갈라진다. 점수 자체를 기준
// 삼는 편이 정직하고, 치우친 분포는 사람이 보고 판단할 몫으로 남긴다.
const THRESHOLDS = [0.24, 0.36, 0.48, 0.62]; // 미만이면 1 / 2 / 3 / 4, 그 이상 5

function gradeOf(score) {
  for (let i = 0; i < THRESHOLDS.length; i++) if (score < THRESHOLDS[i]) return i + 1;
  return 5;
}

/**
 * 사람이 확정한 보정. 산식이 놓치는 것을 여기서 바로잡는다.
 *
 * 산식의 알려진 한계는 반복을 못 읽는다는 것이다. 길이를 선형으로 세기 때문에,
 * 같은 구조가 되풀이돼 실제로는 쉬운 구절이 과대평가된다. 아래 세 건이 그 경우다.
 * 규칙으로 만들려면(중복 글자 비율만큼 길이 점수 감점 등) 산식이 복잡해지는 데 비해
 * 해당하는 구절이 몇 건뿐이라, 예외를 명시하는 쪽을 택했다.
 *
 * order 를 주면 그 등급 안에서 순서를 고정한다. 주지 않으면 점수순으로 놓인다.
 */
const OVERRIDES = {
  // 허사 4개가 전부 如 하나의 반복이다. 자동 5단계는 과대평가.
  '如切如磋, 如琢如磨': { difficulty: 3 },
  // 40건 중 글자가 가장 쉽다(기하빈도 3396·최소빈도 1237). 대구 반복이라 길어 보였을 뿐.
  '知之爲知之, 不知爲不知': { difficulty: 2 },
  // 9자지만 허사가 없고 동사+목적어가 네 번 반복되는 단순 구조.
  '修身齊家治國平天下': { difficulty: 2 },
  // 논어 첫 구절이자 앱의 첫 예시 칩. 커리큘럼 도입부로 쓰므로 1단계 맨 앞에 고정한다.
  // 점수(0.564)만 보면 1단계 안에서 가장 뒤에 놓이는데, 그러면 도입부라는 의도와 어긋난다.
  '學而時習之, 不亦說乎': { difficulty: 1, order: 1 },
  // 글자는 쉽지만 유래를 모르면 뜻이 잡히지 않는 고사성어. 자동 1단계(0.239)는 경계선이었다.
  '結草報恩': { difficulty: 2 },
};

for (const s of scored) {
  const o = OVERRIDES[s.passage];
  s.autoDifficulty = gradeOf(s.score);
  s.difficulty = o?.difficulty ?? s.autoDifficulty;
  s.pin = o?.order ?? null;
  s.overridden = Boolean(o);
}

const unknownOverride = Object.keys(OVERRIDES).filter(
  (p) => !scored.some((s) => s.passage === p),
);
if (unknownOverride.length) {
  console.error(`[build-curriculum] 보정 대상 구절을 찾지 못했습니다: ${unknownOverride.join(', ')}`);
  process.exit(1);
}

// 같은 등급 안에서는 쉬운 것부터 푼다. 순서를 고정한 구절이 먼저 오고, 나머지는
// 점수순이다. 점수가 같으면 id 순으로 고정해 매번 같은 결과가 나오게 한다.
const byGrade = new Map();
for (const s of [...scored].sort(
  (a, b) => (a.pin ?? Infinity) - (b.pin ?? Infinity) || a.score - b.score || a.id - b.id,
)) {
  const list = byGrade.get(s.difficulty) ?? [];
  list.push(s);
  byGrade.set(s.difficulty, list);
}
for (const list of byGrade.values()) list.forEach((s, i) => (s.curriculum_order = i + 1));

// ── 출력 ────────────────────────────────────────────────────────────────────

const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - [...String(s)].reduce((w, c) => w + (c.charCodeAt(0) > 0x2000 ? 2 : 1), 0)));

console.log('\n난이도  순서  한자  기하빈도  최소빈도  허사  문형  점수   보정      구절');
console.log('─'.repeat(100));
for (const s of [...scored].sort((a, b) => a.difficulty - b.difficulty || a.curriculum_order - b.curriculum_order)) {
  const mark = s.overridden ? `${s.autoDifficulty}→${s.difficulty}` : '';
  console.log(
    `  ${s.difficulty}   ${pad(s.curriculum_order, 5)} ${pad(s.hanja_count, 5)} ${pad(s.geoFreq, 9)} ${pad(s.minFreq, 9)} ${pad(s.fwCount, 5)} ${pad(s.patCount, 5)} ${s.score.toFixed(3)}  ${pad(mark, 9)} ${s.passage}`,
  );
}

const fmt = (get) => [1, 2, 3, 4, 5].map((g) => `${g}단계 ${get(g)}건`).join(' · ');
console.log('─'.repeat(100));
console.log(`자동 산출 분포: ${fmt((g) => scored.filter((s) => s.autoDifficulty === g).length)}`);
console.log(`보정 후   분포: ${fmt((g) => (byGrade.get(g) ?? []).length)}`);
console.log(`보정 건수: ${scored.filter((s) => s.overridden).length}건 / 전체 ${scored.length}건\n`);

if (DRY) {
  console.log('[--dry-run] 파일을 쓰지 않았습니다.\n');
  process.exit(0);
}

// ── SQL 쓰기 ────────────────────────────────────────────────────────────────
//
// UPDATE 로 쓴다. passages 행은 passages.sql 이 이미 넣었고, 여기서는 난이도만
// 덧칠하기 때문이다. passage 문자열로 찾으므로 passages.sql 을 고쳐 문구가 바뀌면
// 이 스크립트를 다시 돌려야 한다.
const esc = (s) => String(s).replace(/'/g, "''");
const overrideCount = scored.filter((s) => s.overridden).length;
const lines = [
  '-- 커리큘럼 난이도 — scripts/build-curriculum.mjs 가 생성합니다. 직접 고치지 마십시오.',
  '--',
  `-- 자동 산출 ${scored.length}건 중 ${overrideCount}건은 사람이 확정한 보정값입니다.`,
  '-- 등급을 바꾸려면 이 파일이 아니라 스크립트의 OVERRIDES 를 고치고 다시 돌리십시오.',
  '-- 보정 이유가 그 자리에 주석으로 남아 있어야 나중에 근거를 다시 찾을 수 있습니다.',
  '--',
  '-- 기준: 한자 수 0.40 · 글자 희귀도 0.35 · 문법 부담 0.25 (자세한 설명은 스크립트 주석)',
  '',
];
for (const s of [...scored].sort((a, b) => a.difficulty - b.difficulty || a.curriculum_order - b.curriculum_order)) {
  lines.push(
    `UPDATE passages SET difficulty = ${s.difficulty}, hanja_count = ${s.hanja_count}, ` +
      `curriculum_order = ${s.curriculum_order} WHERE passage = '${esc(s.passage)}';`,
  );
}
lines.push('');
writeFileSync(OUT, lines.join('\n'), 'utf8');
console.log(`[build-curriculum] ${OUT} · ${scored.length}건 기록\n`);
