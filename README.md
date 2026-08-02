# 한문독해 (hanmun-app)

한문 구절을 **영어 구문독해처럼 단계별로 분해**해 주는 학습 앱.
`단어 분해 → 어순 재구성 → 현대어 → 영어` 4단계 풀이에, **번역 방법론**, **연관 고사성어·명구**,
**부수 기반 암기 카드**를 함께 보여 줍니다.

- 프론트엔드 · API: **Astro 5** (SSR) + **Cloudflare Pages Functions**
- 데이터베이스: **Cloudflare D1** (분석 캐시 · 고사성어 · 부수 214 · 한자 · 명구)
- 스토리지: **Cloudflare R2** (폰트 · PDF 내보내기 — Phase 4~5, 아직 미사용)
- AI: **Anthropic Claude** — 기본 `claude-haiku-4-5`, 정밀 모드 `claude-sonnet-5`

---

## 1. 빠른 시작 (로컬)

```bash
npm install

# 1) API 키 설정 — .env 하나면 됩니다 (wrangler 4 가 .env 를 읽습니다)
cp .env.example .env          # 그리고 키를 채워 넣으세요

# 2) 로컬 D1 생성 + 시드 주입
npm run db:reset:local

# 3) 개발 서버
npm run dev                   # http://localhost:4321
```

`npm run db:reset:local` 은 스키마를 다시 만들고(기존 테이블 DROP) 시드를 넣습니다.
시드 결과: **부수 214 / 고사성어 66 / 한자 182 / 명구 40**.

---

## 2. 화면

| 경로 | 내용 |
|---|---|
| `/` | 구절 입력 → 4개 탭 결과 (풀이 · 방법론 · 연관 콘텐츠 · 부수 암기) |
| `/dictionary` | 강희부수 214개 사전. 검색 + 부수별 한자 목록 |
| `/method` | 한문 번역 7단계 방법론 + 자주 나오는 허사 12자 (정적 페이지) |

결과 화면에서 **글자를 누르면** 음·훈·부수·총획과 같은 부수 한자가 팝업으로 뜹니다.
**부수 암기 탭**은 플래시카드입니다 — 카드를 누르면 뒷면(같은 부수 한자 + 암기 팁)이 보입니다.

---

## 3. API

전부 `/api/*` 아래 Pages Functions 로 동작합니다.

| 엔드포인트 | 설명 | LLM 호출 |
|---|---|---|
| `POST /api/analyze` | 구문독해 분석. `{ text, mode: "light" \| "deep" }` | 캐시 미스일 때만 |
| `GET /api/character?hanja=學` | 한자 상세 + 같은 부수 한자 | 없음 |
| `GET /api/character?eum=학` | 한글 음 → 한자 후보 (입력 자동완성용) | 없음 |
| `GET /api/idioms?keyword=學` | 한자를 포함하는 고사성어 | 없음 |
| `GET /api/radicals` / `?radical=子` | 부수 전체 / 부수 상세 + 해당 한자 | 없음 |
| `GET /api/history` | 최근 검색 5개 + 오늘 사용량·남은 한도 | 없음 |

---

## 4. 💰 API 비용 설계

> 이 앱은 **비용을 먼저 고려해** 설계했습니다. 실측 기준 수치입니다.

| 모드 | 모델 | 1건당 비용 | 비고 |
|---|---|---|---|
| **기본 (light)** | `claude-haiku-4-5` | 약 **$0.011 (≈16원)** | 사고(thinking) 토큰 없음 |
| **정밀 (deep)** | `claude-sonnet-5` | 약 **$0.039 (≈54원)** | 어려운 구절용. 체크박스로 켜기 |
| **캐시 재조회** | — | **0원** | 같은 구절은 D1 에서 꺼냄 |

적용한 절감 기법:

1. **사고 토큰 제거** — 두 모드 모두 thinking 을 쓰지 않습니다. Sonnet 은 adaptive thinking 이
   기본 ON 이라 명시적으로 껐습니다(켜면 출력 토큰이 약 1.5배).
2. **스키마 설명문 최소화** — Structured Outputs 의 `description` 은 매 요청 입력 토큰으로
   과금됩니다. 세부 규칙을 시스템 프롬프트로 한 번만 지시하도록 옮겨 고정 입력 오버헤드를
   **4,884 → 2,620 토큰 (−46%)** 으로 줄였습니다.
3. **출력 분량 못박기** — 방법론 2개, 고사성어 2개, 명구 2개, 부수 카드 2장, 설명은 45자 이내.
   `max_tokens` 로 하드 캡(light 4000 / deep 6000)까지 이중 방어.
4. **D1 영구 캐시** — 구절을 정규화해 SHA-256 으로 키를 만들어 저장합니다. 재조회는 0원.
5. **연관 콘텐츠는 D1 우선** — 고사성어·명구는 시드 DB 에서도 가져와 LLM 출력을 늘리지 않고
   내용을 보강합니다.
6. **호출 전 입력 검증** — 한자가 없거나 200자를 넘는 입력은 API 를 부르기 전에 400 으로 막습니다.
7. **일일 상한** — `MAX_DAILY_ANALYSES`(기본 **50**)를 넘으면 429. 최악의 경우 하루 약 800원.
   상한에 걸려도 **이미 분석한 구절은 계속 무료로 조회**됩니다.

결과 화면 하단에 매번 `모델 / 토큰 수 / 예상 비용`이 표시되고, 캐시 히트면
`저장된 결과 · 추가 비용 0원` 배지가 붙습니다.

### 환경변수로 조절

| 변수 | 기본값 | 설명 |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | **필수** |
| `ANTHROPIC_MODEL` | `claude-haiku-4-5` | 기본 모드 모델 |
| `ANTHROPIC_MODEL_DEEP` | `claude-sonnet-5` | 정밀 모드 모델 |
| `MAX_DAILY_ANALYSES` | `50` | 하루 최대 실제 API 호출 수 (캐시 미스만 계산) |
| `DEBUG_KEY` | — | 디버그 화면 열쇠. **16자 이상**. 미설정이면 디버그 화면은 완전히 꺼짐 |

더 아끼려면 `ANTHROPIC_MODEL_DEEP=claude-haiku-4-5` 로 두어 정밀 모드를 사실상 끌 수 있습니다.

### 디버그 화면

분석이 이상할 때 **코드를 고치지 않고** 어느 층에서 틀렸는지 좁히는 화면입니다.
`?debug=<DEBUG_KEY>` 를 주소에 붙이면 결과 아래에 층별 관측이 열립니다.

| 층 | 보이는 것 |
|---|---|
| 1층 입력 | 원문 · 정규화 결과 · **보이지 않는 문자의 코드포인트**(`U+FEFF@3`) |
| 캐시 | 히트 여부 · `text_hash` · `ANALYSIS_VERSION` · mode |
| 2층 힌트 | `/api/pos` 의 허사·문형 (※ 프롬프트에 들어가지 않는 화면 표시용) |
| 3층 요청 | 실제로 전송된 `model` · `max_tokens` · `thinking` · 실린 키 · system/user 전문 |
| 4층 AI | `stop_reason` · 파싱 성공 여부 · **파싱 전 원본 응답** |
| 6층 검증 | 이탈도 · 글자별 어긋남(교정 전/후) · 교정 호출의 요청과 원본 응답 |

분석이 **실패했을 때도** 열립니다. AI 원본이 JSON 이 아니었던 경우 그 원본을 볼 수
있는 곳이 여기뿐입니다.

**보안**

- 시스템 프롬프트 전문과 AI 원본이 그대로 실립니다. Pages 에서 **Secret** 으로 넣으십시오.
- `DEBUG_KEY` 가 없으면 응답에 `debug` 필드가 **아예 생기지 않습니다.** 기본이 완전 차단입니다.
- **16자 미만인 키는 미설정으로 취급해 무시합니다.** `DEBUG_KEY=1` 처럼 짧게 두면
  `?debug=1` 같은 추측값이 우연히 맞기 때문입니다. 짧게 설정해 놓고 "왜 안 열리지"로
  헤매지 않도록 여기에 적어 둡니다 — **열리지 않으면 먼저 키 길이를 확인하십시오.**
- 화면은 주소의 `?debug=` 값을 읽어 API 요청에 `x-debug-key` **헤더**로 옮겨 붙입니다.
  키를 API 의 쿼리스트링에 실으면 액세스 로그와 리퍼러에 그대로 남기 때문입니다.

---

## 5. 배포 (Cloudflare Pages)

현재 배포 상태: **https://old-hanja.pages.dev** — GitHub `main` 브랜치 푸시 시 자동 배포.

| Pages 설정 | 값 |
|---|---|
| Build command | `npm run build` |
| Build output directory | `dist` |
| Production branch | `main` |
| `NODE_VERSION` (환경변수) | `22` — Astro 5 는 Node 18.20.8+ / 20.3+ / 22+ 필요 |

D1 바인딩은 이 저장소의 `wrangler.toml` 이 소스입니다. 대시보드에서 따로 설정하지 않아도
`binding = "DB"` 가 적용됩니다 (배포 후 `/api/radicals` 가 214를 반환하면 정상).

### API 키 (필수 · 대시보드에서만)

Pages 대시보드 → **old-hanja** → Settings → Environment variables → Production →
`ANTHROPIC_API_KEY` 를 **Secret** 타입으로 추가한 뒤 재배포하세요.

> `npx wrangler pages secret put` 은 이 프로젝트에서 `Project "old-hanja" does not exist` 로
> 실패합니다(토큰에 `pages (write)` 권한이 있어도 발생). 대시보드를 사용하세요.

키가 없어도 **부수 사전 · 한자 조회 · 번역 7단계 · 이미 분석한 구절**은 정상 동작하고,
새 구절 분석만 503 으로 막힙니다.

### 새 Cloudflare 계정에서 처음부터 세팅할 때

```bash
npm run db:create         # 출력된 database_id 를 wrangler.toml 에 붙여넣기
npm run db:migrate        # 원격 D1 에 스키마
npm run db:seed           # 원격 D1 에 시드
```

`wrangler.toml` 의 `name` 은 **Pages 프로젝트 이름과 반드시 같아야** 합니다.
다르면 `npm run deploy` 가 그 이름으로 프로젝트를 새로 만들어 버립니다.

R2 를 쓸 때(폰트 호스팅 · PDF 내보내기)는 버킷을 만든 뒤 `wrangler.toml` 의 `[[r2_buckets]]`
주석을 해제하세요:

```bash
npx wrangler r2 bucket create hanmun-assets
```

---

## 6. 구조

```
db/
  schema.sql            D1 스키마 (analyses, search_logs, idioms, radicals, characters, passages)
  seed/                 시드 SQL 4개
scripts/seed.mjs        시드 주입 스크립트
src/
  lib/
    analysis.ts         프롬프트 · JSON 스키마 · 타입 · 모델/비용 정책
    db.ts               D1 접근 계층
    hash.ts             SHA-256 · 한자 추출
  pages/
    index.astro         메인 (입력 + 4탭 결과)
    dictionary.astro    부수 사전
    method.astro        번역 7단계 (정적)
    api/                analyze · character · idioms · radicals · history
  layouts/Base.astro
  styles/global.css
```

---

## 7. PRD 5단계 대비 현재 상태

| Phase | 목표 | 상태 |
|---|---|---|
| 1 | 인프라 · D1 스키마 · R2 구조 · 배포 파이프라인 | ✅ 스키마/시드/배포 스크립트 완료. R2 는 주석 처리(미사용) |
| 2 | 구문독해 MVP (입력 → AI → 결과) | ✅ 완료 |
| 3 | 고사성어 · 방법론 · 부수 암기 4개 탭 + 시드 데이터 | ✅ 완료 |
| 4 | 입력 보조 · 오프라인 캐싱 · 반응형 | ⚠️ 부분 — 반응형·한자 팝업·최근검색·D1 캐시는 됨. **한글→한자 자동완성 UI**(API 는 있음), **Service Worker 오프라인 캐싱**, 클립보드 자동 감지는 미구현 |
| 5 | 최적화 · 커스텀 도메인 · 프로덕션 | ⚠️ 부분 — 비용 최적화·에러 핸들링·일일 상한은 됨. 폰트 서브셋팅·R2 CDN·Web Analytics·도메인 연결은 미구현 |

미구현으로 남긴 것(PRD 기준): 한자 필기 인식(OCR), 음성 입력, 학습 이력·오답노트, 커뮤니티,
부수 네트워크 그래프(D3/Cytoscape), PDF 내보내기, 프리미엄 구독·B2B 대시보드.

---

## 8. 데이터 정확도에 대해

- **시드 데이터**(부수 214 · 고사성어 66 · 한자 182 · 명구 40)는 직접 작성한 **스타터 세트**입니다.
  PRD 의 목표치(고사성어 5,000 · 상용한자 3,500)에는 못 미치므로, 확장 시 공개 자료를 확인해
  `db/seed/*.sql` 에 추가하세요.
- **AI 풀이는 검수되지 않았습니다.** 기본 모드(Haiku)는 어순 재구성에서 괄호가 어긋나거나,
  드물게 없는 명구를 만들어 낼 수 있습니다. 중요한 구절은 **정밀 분석**을 켜고, 시험·논문
  인용은 원전을 확인하세요.
- 연관 고사성어·명구는 AI 결과와 D1 시드를 합쳐 보여 주며, **시드에서 온 항목은 출전이
  검증된 것**입니다.
