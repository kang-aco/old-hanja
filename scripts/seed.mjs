#!/usr/bin/env node
// D1 시드 데이터 주입 스크립트
//   npm run db:seed:local   (로컬 miniflare D1)
//   npm run db:seed         (원격 Cloudflare D1)
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const DB_NAME = 'hanmun-db';
const FILES = [
  'radicals.sql',
  'idioms.sql',
  'characters.sql',
  'passages.sql',
  'pos.sql',
  'grammar.sql',
];

const remote = process.argv.includes('--remote');
const target = remote ? '--remote' : '--local';

console.log(`\n[seed] ${DB_NAME} (${remote ? 'remote' : 'local'})`);

for (const file of FILES) {
  const rel = path.join('db', 'seed', file);
  if (!existsSync(rel)) {
    console.error(`[seed] 파일을 찾을 수 없습니다: ${rel}`);
    process.exit(1);
  }

  process.stdout.write(`[seed] ${file} ... `);
  const res = spawnSync(
    'npx',
    ['wrangler', 'd1', 'execute', DB_NAME, target, `--file=${rel}`, '--yes'],
    { stdio: ['ignore', 'pipe', 'pipe'], shell: true, encoding: 'utf8' },
  );

  if (res.status !== 0) {
    console.log('실패');
    console.error(res.stdout ?? '');
    console.error(res.stderr ?? '');
    process.exit(res.status ?? 1);
  }
  console.log('완료');
}

console.log('[seed] 모든 시드 데이터 주입 완료\n');
