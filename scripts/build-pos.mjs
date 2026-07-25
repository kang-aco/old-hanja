#!/usr/bin/env node
/**
 * UD Classical Chinese (Kyoto) 트리뱅크로 한문 품사 사전과 문형 패턴을 만든다.
 *
 *   node scripts/build-pos.mjs
 *
 * 출처: https://github.com/UniversalDependencies/UD_Classical_Chinese-Kyoto
 * 라이선스: CC BY-SA 4.0 — 가공 데이터도 동일 조건으로 공개해야 하고 출처를 표기해야 한다.
 *          (앱 하단과 README 에 표기함)
 *
 * 만드는 것
 *  1) pos_chars    글자별 품사. 코퍼스 빈도로 가장 흔한 품사를 대표값으로 잡고,
 *                  품사 분포(JSON)도 함께 담아 다의어(예: 之, 而)를 드러낸다.
 *  2) pos_patterns 품사 2~3연속(n-gram) 패턴과 빈도, 대표 예문.
 *                  "이 구절은 NOUN+VERB+PART 문형" 같은 설명을 런타임 비용 0 으로 만든다.
 *
 * 왜 이렇게 하나: 글자별 분해를 AI 로 만들면 한자 1자당 출력 토큰이 붙어 비용·지연의
 * 주된 원인이 된다. 트리뱅크는 사람이 검수한 품사·의존관계를 담고 있어 더 정확하고,
 * 조회는 D1 에서 일어나므로 공짜다.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const BASE =
  'https://raw.githubusercontent.com/UniversalDependencies/UD_Classical_Chinese-Kyoto/master';
const FILES = ['lzh_kyoto-ud-train.conllu', 'lzh_kyoto-ud-dev.conllu', 'lzh_kyoto-ud-test.conllu'];
const WORK = path.join('.cache', 'ud');
const OUT = path.join('db', 'seed', 'pos.sql');

/** UPOS → 한국어 품사명. 한문 문법 용어에 맞춰 옮긴다. */
const UPOS_KO = {
  NOUN: '명사',
  PROPN: '고유명사',
  VERB: '동사',
  ADJ: '형용사',
  ADV: '부사',
  PRON: '대명사',
  NUM: '수사',
  PART: '어조사',
  ADP: '전치사',
  CCONJ: '접속사',
  SCONJ: '종속접속사',
  AUX: '조동사',
  INTJ: '감탄사',
  DET: '한정사',
  SYM: '기호',
  PUNCT: '구두점',
  X: '기타',
};

const MIN_PATTERN_COUNT = 40; // 이보다 드문 패턴은 버린다 (잡음 제거)
const MAX_PATTERNS = 1200;

function download() {
  mkdirSync(WORK, { recursive: true });
  for (const f of FILES) {
    const dest = path.join(WORK, f);
    if (existsSync(dest)) continue;
    console.log(`[ud] ${f} 내려받는 중…`);
    execFileSync('curl', ['-fsSL', '-o', dest, `${BASE}/${f}`], { stdio: 'inherit' });
  }
}

/** CoNLL-U 를 문장 배열로 읽는다 */
function readSentences() {
  const sentences = [];
  for (const f of FILES) {
    const text = readFileSync(path.join(WORK, f), 'utf8');
    let tokens = [];
    for (const line of text.split(/\r?\n/)) {
      if (line === '') {
        if (tokens.length) sentences.push(tokens);
        tokens = [];
        continue;
      }
      if (line.startsWith('#')) continue;
      const c = line.split('\t');
      if (c.length < 10) continue;
      if (c[0].includes('-') || c[0].includes('.')) continue; // 복합 토큰 건너뛰기
      const gloss = /Gloss=([^|]+)/.exec(c[9])?.[1] ?? '';
      tokens.push({ form: c[1], upos: c[3], detail: c[4], deprel: c[7], gloss });
    }
    if (tokens.length) sentences.push(tokens);
  }
  return sentences;
}

const q = (v) =>
  v === null || v === undefined || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;

function main() {
  download();
  const sentences = readSentences();
  const tokenCount = sentences.reduce((n, s) => n + s.length, 0);
  console.log(`[ud] 문장 ${sentences.length} / 토큰 ${tokenCount}`);

  // ── 1) 글자별 품사 ────────────────────────────────────────────────────
  const chars = new Map(); // form → { total, upos:Map, detail:Map, gloss:Map }
  for (const s of sentences) {
    for (const t of s) {
      if (!/^[㐀-䶿一-鿿豈-﫿]$/.test(t.form)) continue; // 한자 1자만
      let e = chars.get(t.form);
      if (!e) {
        e = { total: 0, upos: new Map(), detail: new Map(), gloss: new Map() };
        chars.set(t.form, e);
      }
      e.total++;
      e.upos.set(t.upos, (e.upos.get(t.upos) ?? 0) + 1);
      if (t.detail) e.detail.set(t.detail, (e.detail.get(t.detail) ?? 0) + 1);
      if (t.gloss) e.gloss.set(t.gloss, (e.gloss.get(t.gloss) ?? 0) + 1);
    }
  }

  const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const charRows = [];
  for (const [form, e] of chars) {
    // 품사 분포: 2회 이상 나온 것만, 빈도 내림차순
    const dist = [...e.upos.entries()]
      .filter(([, n]) => n >= 2)
      .sort((a, b) => b[1] - a[1])
      .map(([u, n]) => ({ pos: UPOS_KO[u] ?? u, upos: u, n }));
    const mainUpos = top(e.upos);
    charRows.push(
      `(${q(form)},${q(mainUpos)},${q(UPOS_KO[mainUpos] ?? mainUpos)},` +
        `${q(top(e.detail))},${q(top(e.gloss))},${e.total},${q(JSON.stringify(dist))})`,
    );
  }
  console.log(`[pos_chars] ${charRows.length}자`);

  // ── 2) 품사 n-gram 문형 패턴 ──────────────────────────────────────────
  const pats = new Map(); // "NOUN VERB" → { n, count, exForm, exGloss }
  for (const s of sentences) {
    for (const n of [2, 3]) {
      for (let i = 0; i + n <= s.length; i++) {
        const win = s.slice(i, i + n);
        if (win.some((t) => !/^[㐀-䶿一-鿿豈-﫿]$/.test(t.form))) continue;
        const key = win.map((t) => t.upos).join(' ');
        let e = pats.get(key);
        if (!e) {
          e = {
            n,
            count: 0,
            exForm: win.map((t) => t.form).join(''),
            exGloss: win.map((t) => t.gloss || '?').join(' · '),
          };
          pats.set(key, e);
        }
        e.count++;
      }
    }
  }

  const patRows = [...pats.entries()]
    .filter(([, e]) => e.count >= MIN_PATTERN_COUNT)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, MAX_PATTERNS)
    .map(([key, e]) => {
      const ko = key
        .split(' ')
        .map((u) => UPOS_KO[u] ?? u)
        .join('+');
      return `(${q(key)},${q(ko)},${e.n},${e.count},${q(e.exForm)},${q(e.exGloss)})`;
    });
  console.log(`[pos_patterns] ${patRows.length}개 (${MIN_PATTERN_COUNT}회 이상)`);

  // ── 출력 ──────────────────────────────────────────────────────────────
  const chunk = (rows, stmt, size = 500) => {
    const out = [];
    for (let i = 0; i < rows.length; i += size) {
      out.push(stmt + '\n' + rows.slice(i, i + size).join(',\n') + ';');
    }
    return out.join('\n\n');
  };

  const header = `-- 자동 생성 — 직접 수정하지 마십시오. 다시 만들려면: node scripts/build-pos.mjs
-- 출처: UD Classical Chinese (Kyoto) 트리뱅크
--   ${BASE}
-- 라이선스: CC BY-SA 4.0 (가공 데이터도 동일 조건 · 출처 표기 필요)
-- 코퍼스 규모: 문장 ${sentences.length} / 토큰 ${tokenCount}
-- pos_chars ${charRows.length}자 · pos_patterns ${patRows.length}개
`;

  writeFileSync(
    OUT,
    header +
      chunk(
        charRows,
        'INSERT INTO pos_chars (hanja, upos, pos_ko, detail, gloss, freq, dist_json) VALUES',
      ) +
      '\n\n' +
      chunk(
        patRows,
        'INSERT INTO pos_patterns (pattern, pattern_ko, n, freq, example, example_gloss) VALUES',
      ) +
      '\n',
    'utf8',
  );
  console.log(`[out] ${OUT}`);
}

main();
