#!/usr/bin/env node
/**
 * Unihan(유니코드 공식 한자 데이터)로 characters 시드를 생성한다.
 *
 *   node scripts/build-characters.mjs
 *
 * 하는 일
 *  - Unihan.zip 을 받아 kHangul(한글 음) · kRSUnicode(부수) · kTotalStrokes(총획)
 *    · kDefinition(영문 뜻) 을 뽑는다.
 *  - 한글 음이 있는 한자만 남긴다 (한국 한자 앱에서 의미 있는 범위).
 *  - 직접 작성한 큐레이션 시드(db/seed/characters.curated.sql)의 훈·메모를 덮어씌워
 *    합친다. Unihan 에는 한국어 훈(訓)이 없기 때문이다.
 *  - db/seed/characters.sql 을 덮어쓴다.
 *
 * 왜 필요한가: 손으로 만든 182자 시드로는 실제 고전 구절의 한자를 57% 밖에 찾지
 * 못했다. Unihan 을 쓰면 8,500자 이상을 정확한 부수·획수와 함께 커버한다.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const UNIHAN_URL = 'https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip';
const WORK = path.join('.cache', 'unihan');
const OUT = path.join('db', 'seed', 'characters.sql');
const CURATED = path.join('db', 'seed', 'characters.curated.sql');

// 강희부수 214개: 번호 → 부수 글자. radicals 시드의 id 와 동일한 순서다.
const RADICALS =
  '一丨丶丿乙亅二亠人儿入八冂冖冫几凵刀力勹匕匚匸十卜卩厂厶又' +
  '口囗土士夂夊夕大女子宀寸小尢尸屮山巛工己巾干幺广廴廾弋弓彐彡彳' +
  '心戈戶手支攴文斗斤方无日曰月木欠止歹殳毋比毛氏气水火爪父爻爿片牙牛犬' +
  '玄玉瓜瓦甘生用田疋疒癶白皮皿目矛矢石示禸禾穴立' +
  '竹米糸缶网羊羽老而耒耳聿肉臣自至臼舌舛舟艮色艸虍虫血行衣襾' +
  '見角言谷豆豕豸貝赤走足身車辛辰辵邑酉釆里' +
  '金長門阜隶隹雨靑非' +
  '面革韋韭音頁風飛食首香' +
  '馬骨高髟鬥鬯鬲鬼' +
  '魚鳥鹵鹿麥麻' +
  '黃黍黑黹' +
  '黽鼎鼓鼠' +
  '鼻齊' +
  '齒' +
  '龍龜' +
  '龠';

if ([...RADICALS].length !== 214) {
  console.error(`부수 목록이 214개가 아닙니다: ${[...RADICALS].length}개`);
  process.exit(1);
}

function download() {
  mkdirSync(WORK, { recursive: true });
  const zip = path.join(WORK, 'Unihan.zip');
  if (existsSync(path.join(WORK, 'Unihan_Readings.txt'))) {
    console.log('[unihan] 이미 받아둔 파일 사용');
    return;
  }
  console.log('[unihan] 내려받는 중…');
  execFileSync('curl', ['-fsSL', '-o', zip, UNIHAN_URL], { stdio: 'inherit' });
  console.log('[unihan] 압축 해제 중…');
  execFileSync(
    'powershell',
    ['-NoProfile', '-Command', `Expand-Archive -Path '${zip}' -DestinationPath '${WORK}' -Force`],
    { stdio: 'inherit' },
  );
}

/** Unihan 텍스트 파일에서 필요한 필드만 뽑는다 */
function parse() {
  const want = new Set(['kRSUnicode', 'kTotalStrokes', 'kHangul', 'kDefinition']);
  const rows = new Map();
  for (const file of ['Unihan_IRGSources.txt', 'Unihan_Readings.txt']) {
    const text = readFileSync(path.join(WORK, file), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      if (!line || line.startsWith('#')) continue;
      const tab1 = line.indexOf('\t');
      const tab2 = line.indexOf('\t', tab1 + 1);
      if (tab1 < 0 || tab2 < 0) continue;
      const key = line.slice(tab1 + 1, tab2);
      if (!want.has(key)) continue;
      const cp = line.slice(0, tab1);
      const val = line.slice(tab2 + 1);
      if (!rows.has(cp)) rows.set(cp, {});
      rows.get(cp)[key] = val;
    }
  }
  return rows;
}

/** 큐레이션 시드에서 훈·메모를 읽는다 (Unihan 에는 한국어 훈이 없다) */
function readCurated() {
  const map = new Map();
  if (!existsSync(CURATED)) {
    console.log('[curated] 파일이 없어 건너뜁니다');
    return map;
  }
  const text = readFileSync(CURATED, 'utf8');
  // ('學','학','배울','子',16,'메모') 형태의 행을 읽는다
  const re = /\('([^']+)','([^']*)','([^']*)','?([^',]*)'?,(\d+|NULL),(NULL|'(?:[^']|'')*')\)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const [, hanja, eum, hun, , , note] = m;
    map.set(hanja, { eum, hun, note: note === 'NULL' ? null : note.slice(1, -1) });
  }
  console.log(`[curated] 훈이 있는 한자 ${map.size}자`);
  return map;
}

const q = (v) => (v === null || v === undefined || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

function main() {
  download();
  const rows = parse();
  const curated = readCurated();

  const out = [];
  let skippedNoHangul = 0;
  let skippedBadRadical = 0;

  for (const [cp, d] of rows) {
    if (!d.kHangul) {
      skippedNoHangul++;
      continue;
    }
    const code = parseInt(cp.replace('U+', ''), 16);
    const hanja = String.fromCodePoint(code);

    // kHangul: "온:N 은:N" → 첫 독음만, :N 접미사 제거
    const eumList = d.kHangul
      .split(/\s+/)
      .map((s) => s.split(':')[0])
      .filter(Boolean);
    const eum = [...new Set(eumList)].join(',');

    // kRSUnicode: "1.4" / "182'.6" → 부수 번호 1~214
    const radNum = parseInt(String(d.kRSUnicode).split('.')[0].replace(/'/g, ''), 10);
    if (!Number.isFinite(radNum) || radNum < 1 || radNum > 214) {
      skippedBadRadical++;
      continue;
    }
    const radical = [...RADICALS][radNum - 1];

    const strokes = parseInt(String(d.kTotalStrokes).split(/\s+/)[0], 10);
    const cur = curated.get(hanja);

    // 훈: 큐레이션 시드에 있으면 그것을, 없으면 NULL (팝업에서 분석 결과로 보완)
    const hun = cur?.hun ?? null;
    // 음: 큐레이션 쪽이 문맥 독음을 반영하므로 우선
    const finalEum = cur?.eum ?? eum;
    const note = cur?.note ?? null;
    const definition = d.kDefinition ? d.kDefinition.slice(0, 180) : null;

    out.push(
      `(${q(hanja)},${q(finalEum)},${q(hun)},${q(radical)},` +
        `${Number.isFinite(strokes) ? strokes : 'NULL'},${q(note)},${q(definition)})`,
    );
  }

  out.sort();
  const header = `-- 자동 생성 — 직접 수정하지 마십시오. 다시 만들려면: node scripts/build-characters.mjs
-- 출처: Unicode Unihan Database (${UNIHAN_URL})
--   음 kHangul · 부수 kRSUnicode · 총획 kTotalStrokes · 영문뜻 kDefinition
-- 훈(訓)은 Unihan 에 없어 db/seed/characters.curated.sql 의 값을 병합했습니다.
-- 총 ${out.length}자
`;

  // D1 은 한 문장이 너무 길면 거부하므로 500행 단위로 INSERT 를 나눈다.
  const chunks = [];
  for (let i = 0; i < out.length; i += 500) {
    chunks.push(
      'INSERT INTO characters (hanja, eum, hun, radical, stroke_count, note, definition) VALUES\n' +
        out.slice(i, i + 500).join(',\n') +
        ';',
    );
  }

  writeFileSync(OUT, header + chunks.join('\n\n') + '\n', 'utf8');
  console.log(`[out] ${OUT} — ${out.length}자, ${chunks.length}개 INSERT 문`);
  console.log(`[skip] 한글음 없음 ${skippedNoHangul}자 · 부수 이상 ${skippedBadRadical}자`);
}

main();
