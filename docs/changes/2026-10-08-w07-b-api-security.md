# W07-B API 공통 CSRF·출처·본문 guard

- 작업 ID·제목: W07-B, signed CSRF 토큰과 변경 요청 공통 검증 기반
- 날짜·담당: 2026-10-08, Codex
- 변경 목적·전후 동작: 서버 API 기반에서 CSRF/Origin/Fetch Metadata/JSON 형식/본문 바이트 상한 검사가 없었다. 로컬 fixture 모드에 한해 토큰 발급 route를 만들고 mutation route가 재사용할 단일 guard를 제공한다.
- 관련 REQ / POL / TC / API operation: NFR-001, POL-API-001·POL-SEC-001, TC-API-002, `getCsrf` (`GET /api/v1/auth/csrf`).
- 정책·데이터 영향: HMAC-SHA256 signed nonce는 30분 만료, HttpOnly·SameSite=Lax·Path=/api/v1 cookie로 이중 제출한다. CSRF cookie 외 인증 token은 브라우저에 반환하지 않는다. exact Origin과 `Sec-Fetch-Site=same-origin`(헤더가 제공된 경우)을 확인하고 JSON object 본문을 정책의 실제 32KB 이하로 읽는다. 배포에는 환경별 32바이트 이상 `CSRF_SIGNING_SECRET`이 필수이고 local manifest/key 설정은 거절한다. 현재 배포 flow/session binding이 없어 CSRF 발급 route는 503으로 닫힌다.
- 구현 파일: `src/server/api-security.mjs`, `src/app/api/v1/auth/csrf/route.ts`, `scripts/api-security.test.mjs`, `scripts/test-local-me-api.mjs`; runtime key 생성·배포 차단은 `scripts/app.mjs`, `scripts/runtime-environment.mjs`.
- 실행 환경·도구 버전: Windows loopback Supabase, PostgreSQL 17.11, Node 24.19.0, pnpm 11.19.0, Next 16.4.0.
- 실행 명령: `scripts/project.ps1 -Task api:security-test`; `scripts/project.ps1 -Task api:me-test`를 A/B/C 각각 실행; `scripts/project.ps1 -Task build:check`; `scripts/project.ps1 -Task check`.
- 관찰 결과·증거 파일: [W07-B 검사 증거](../quality/reports/w07-b-api-security-check-2026-10-08.json).
- 통과 / 실패 / 미실행: security unit 14/14, A/B/C API 통합 각 15/15, build:check 통과. 최종 전체 check 결과를 evidence JSON에 기록한다. API guard는 공통 기반이며 mutation 업무 route는 없어서 제품 mutation의 E2E 검사는 미실행이다. 실제 Google/OTP 로그인과 배포 CSRF flow/session binding도 미실행이다.
- 다음 의존 작업: W07 기반을 사용해 W08 개인 목표·칭찬 API와 UI를 구현한다. 실제 배포 인증·session-bound CSRF는 사용자 결정에 따라 W12/W13에서 진행한다.
