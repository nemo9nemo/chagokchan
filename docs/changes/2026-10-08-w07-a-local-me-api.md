# W07-A 서버 local fixture adapter와 내 정보 API

- 작업 ID·제목: W07-A, 서버 전용 로컬 Auth 세션과 GET /api/v1/me
- 날짜·담당: 2026-10-08, Codex
- 변경 목적·전후 동작: DB의 `get_me` RPC는 있었지만 Next.js 서버 API에서 세션을 준비해 본인 정보를 가져올 수 없었다. 서버만 A/B/C fixture를 선택해 Auth 발급 세션을 검증한 뒤 같은 RPC/RLS를 호출하도록 연결했다.
- 관련 REQ / POL / TC / API operation: REQ-001, POL-DEV-001·POL-SEC-001, TC-API-001, `getMe` (`GET /api/v1/me`).
- 정책·데이터 영향: actor는 `LOCAL_DEV_ACTOR`의 A/B/C 허용 목록만 따른다. fixture manifest 경로는 로컬 dev runner가 런타임에 전달하며 deployed 환경은 이를 거절한다. 응답은 OpenAPI `Me` 필드를 allowlist로 제한하고 `no-store`·request ID를 적용한다. user ID·Authorization을 JSON·header·query로 제공해도 actor 선택에 쓰지 않는다.
- 구현 파일: `src/server/local-user-session.mjs`, `src/app/api/v1/me/route.ts`, `scripts/test-local-me-api.mjs`. 환경 가드·검사는 `scripts/app.mjs`, `scripts/runtime-environment.mjs`, `scripts/runtime-environment.test.mjs`에 반영했다.
- 실행 환경·도구 버전: Windows loopback Supabase, PostgreSQL 17.11, Node 24.19.0, pnpm 11.19.0, Next 16.4.0, Supabase SDK 2.117.3.
- 실행 명령: `scripts/project.ps1 -Task check`; `scripts/project.ps1 -Task build:check`; `scripts/project.ps1 -Task api:me-test`를 A/B/C로 각각 실행.
- 관찰 결과·증거 파일: [W07-A 검사 증거](../quality/reports/w07-a-local-me-api-check-2026-10-08.json).
- 통과 / 실패 / 미실행: A/B/C API 통합 각각 5/5. `check`에서 Biome 30개 파일·typecheck·단위 37/37·산출물 58 TC/691 OpenAPI refs/179 경로, `build:check` 통과. 제품 목표·칭찬 API/UI, 배포 세션 adapter, 실제 Google/OTP 로그인은 미구현·미실행이며 36개 제품 수락 TC는 계속 not_run이다.
- 다음 의존 작업: W07-B Origin/CSRF/JSON/32KB 공통 요청 경계와 API 오류 형식을 구현한다. 제품 기능 API·UI는 W08부터, 실제 배포 Auth adapter는 사용자 결정에 따라 W12에서 구현한다.
