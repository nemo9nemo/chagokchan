# W10-A 소식·보낸 peer 칭찬 API

- 작업 ID·제목: W10-A 내 소식·보낸 peer 칭찬 읽기 API
- 날짜·담당: 2026-10-08 / Codex
- 변경 목적·전후 동작: W06-D1에 구현된 `list_notifications`, `mark_notification_read`, `list_sent_praises`를 Next.js 서버 route에 연결했다. cursor/limit, 응답 allowlist, no-store, CSRF와 idempotent 읽음 결과 검사를 추가했다.
- 관련 REQ / POL / TC / API operation: REQ-008·REQ-009 / POL-ACCESS-001·POL-PRAISE-002·POL-SEC-001 / TC-API-010 / `listNotifications`, `markNotificationRead`, `listSentPraises`
- 기준 소스: W09-C commit `32f645238a04daeda13565c43eafdbc40a44f7ed`; 최종 파일별 SHA-256은 [검사 증거](../quality/reports/w10-a-news-sent-api-check-2026-10-08.json)에 기록한다.
- 변경 파일·마이그레이션: `src/server/news-api.mjs`, notifications/sent-praises route, `scripts/news-api.test.mjs`, `scripts/test-local-news-api.mjs`, `package.json`, `scripts/project.ps1`, OpenAPI·TC·진행표·인계·데이터 수명주기·검증/변경 기록. DB 스키마·마이그레이션 변경은 없다.
- 정책·데이터 영향: 현재 Auth 세션의 수신 소식·본인이 보낸 peer 기록만 DB 업무 RPC로 읽는다. 소식은 type·시각·읽음·허용 대상 ID만, 보낸함은 본인 본문/기록 시각/취소 상태만 반환한다. 수신자 숨김/제외와 상대의 목표·개수는 보낸함에 노출하지 않는다. 읽음 변경은 CSRF 보호된 고정 RPC를 사용한다.
- 실행 환경·도구 버전: Windows 로컬, Node 24.19.0, pnpm 11.19.0, Next.js 16.4.0, Supabase CLI 2.120.0, PostgreSQL 17.11, `127.0.0.1` local fixture Auth sessions.
- 실행 명령 또는 수동 재현 단계: `node --test scripts/news-api.test.mjs`; `scripts/project.ps1 -Task api:news-test`; `scripts/project.ps1 -Task db:lifecycle-test`; `scripts/project.ps1 -Task db:test`; `scripts/project.ps1 -Task check`; `scripts/project.ps1 -Task build:check`.
- 관찰 결과·증거 파일: W06-D1 Auth session lifecycle regression 4/4, W10-A A/B/C API 각 11/11, pgTAP 회귀 252/252, 전체 unit/lint/typecheck/static/build 결과를 [검사 증거](../quality/reports/w10-a-news-sent-api-check-2026-10-08.json)에 기록한다. local API 스모크 중 기존 product fixture 쓰기 0건, lifecycle probe 정리·fixture 보존을 확인한다.
- 통과 / 실패 / 미실행: API 읽기·경계·기존 RPC 재시도/권한 회귀를 기록한다. UI09 연결 및 제품 UI submit E2E는 미실행이며 W10 후속 화면 작업으로 남긴다. 실제 Google/OTP 로그인은 사용자 결정대로 W12/W13이다.
- 결함과 해결: DB RPC는 있었으나 OpenAPI route가 아직 없어 앱에서 안전한 소식·보낸함 조회가 불가능했다. 서버 전용 route와 strict allowlist를 추가했고 private target/body·moderation fields를 응답에서 거절한다.
- 다음 의존 작업: W10-B 본인 목표 휴지통·복구 API/UI. 계정 탈퇴 route의 실제 재인증·세션 폐기 orchestration은 W12/W13에서 구현한다.
