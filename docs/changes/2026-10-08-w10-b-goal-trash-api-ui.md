# W10-B 목표 휴지통·복구 API/UI

- 작업 ID·제목: W10-B 본인 목표 휴지통·복구 API/UI
- 날짜·담당: 2026-10-08 / Codex
- 변경 목적·전후 동작: W06-D1 DB RPC가 제공하던 목표 소프트 삭제·휴지통·복구를 Next.js 서버 API와 UI10에 연결했다. 같은 revision 삭제 재요청의 안전성을 위해 적용 migration을 수정하지 않고 `20261008024900_goal_delete_retry_is_idempotent.sql` 후속 migration을 추가했다.
- 관련 REQ / POL / TC / API operation: REQ-002·REQ-010 / POL-DELETE-001·POL-GOAL-002·POL-ACCESS-001·POL-SEC-001 / TC-API-011 / `deleteGoal`, `restoreGoal`, `listTrashGoals`
- 기준 소스: W10-A commit `f21a4dc0849ad9342ab4ea5b32552f0a32b695bc`; 최종 파일별 SHA-256은 [검사 증거](../quality/reports/w10-b-goal-trash-api-ui-check-2026-10-08.json)에 기록한다.
- 변경 파일·마이그레이션: `src/server/goal-api.mjs`, goal delete/restore·trash routes, `src/app/client-app.tsx`, `src/app/globals.css`, goal API unit/local API 검사, `20261008024900_goal_delete_retry_is_idempotent.sql`, pgTAP 014, OpenAPI·TC·진행표·인계·수명주기·검증·증거 파일.
- 정책·데이터 영향: 본인 목표만 서버 업무 RPC로 삭제·조회·복구한다. 목록 projection은 제목·삭제 시각·기한·revision으로 제한한다. 최초 삭제에서 판 contributor 권한을 즉시 회수하고 복구 시 권한을 되살리지 않는다. 동일 revision 삭제 retry는 기존 deleted_at·purge_after·revision을 재사용한다. 브라우저는 사용자 데이터·세션을 저장하지 않는다.
- 실행 환경·도구 버전: Windows 로컬, Node 24.19.0, pnpm 11.19.0, Next.js 16.4.0, Supabase CLI 2.120.0, PostgreSQL 17.11, `127.0.0.1` local fixture Auth sessions.
- 실행 명령 또는 수동 재현 단계: `scripts/project.ps1 -Task db:migrate`; `scripts/project.ps1 -Task db:test`; `scripts/project.ps1 -Task db:lifecycle-test`; `scripts/project.ps1 -Task api:trash-test`; `scripts/project.ps1 -Task check`; `scripts/project.ps1 -Task build:check`; UI10 로컬 읽기 smoke.
- 관찰 결과·증거 파일: migration `20261008024900` 적용. pgTAP 신규 5/5·전체 DB 257/257, D1 Auth lifecycle 4/4, A/B/C API 각 11/11, 전체 unit 109/109, lint/typecheck/산출물 검사 및 build:check 통과. API smoke 중 제품 fixture 쓰기 0건.
- 통과 / 실패 / 미실행: 기술 검사 통과. 실제 browser DELETE→DB 및 restore→DB mutation E2E는 제품 fixture 변경을 피하기 위해 미실행했다. 독립 삭제 원장 운영 설정·백업 복원·Google/OTP 로그인·실제 배포 세션은 미검증이다.
- 결함과 해결: 적용된 `delete_goal` RPC는 revision mismatch를 deleted 상태 replay보다 먼저 검사하므로 응답 손실 뒤 원 요청 revision으로 안전하게 재시도할 수 없었다. 후속 migration에서 deleted-state check를 먼저 수행하도록 순서를 바꿨고 새 pgTAP와 실제 Auth lifecycle 검사에서 기존 삭제 기한 유지까지 확인했다.
- 다음 의존 작업: W11 테마·오류 UX·접근성·PWA. W10-C 탈퇴 재인증 HTTP orchestration은 W12/W13에 구현한다.
