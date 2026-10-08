# W09-C 연결·공유판 UI06~UI08

- 작업 ID·제목: W09-C 연결 센터·공유판별 권한·기여자 공유판 UI
- 날짜·담당: 2026-10-08 / Codex
- 변경 목적·전후 동작: UI06~UI08을 연결 API와 공유판 API에 연결했다. 기존에 기여자가 허용된 공유판을 발견할 API가 없어 `list_my_shared_boards` DB RPC와 GET `/api/v1/shared-boards`를 추가했다. UI는 초대/연결 흐름, 판별 grant/revoke, 현재 유효 grant 공유판과 기여자 본인의 peer 칭찬을 제공한다.
- 관련 REQ / POL / TC / API operation: REQ-004·REQ-006·REQ-007 / POL-CONNECT-002·POL-ACCESS-001·POL-PRAISE-002·POL-SEC-001 / TC-API-009 / `listMySharedBoards`, UI06~UI08
- 기준 소스: W09-B 기준 commit `3da5e916526e5cff607e66831df14629a0c31424`; 최종 변경 소스별 SHA-256은 [검사 증거](../quality/reports/w09-c-shared-board-ui-check-2026-10-08.json)에 기록한다.
- 변경 파일·마이그레이션: `src/app/client-app.tsx`, `src/app/globals.css`, `src/server/board-api.mjs`, `src/app/api/v1/shared-boards/route.ts`, `supabase/migrations/20261008024800_list_my_shared_boards_rpc.sql`, `supabase/tests/013_business_rpc_shared_board_directory.test.sql`, 관련 API/RPC 검사, OpenAPI, TC, 진행표·인계·화면·검증 문서.
- 정책·데이터 영향: 연결은 공유판 권한을 부여하지 않는다. owner가 명시적으로 부여한 grant와 현재 연결 generation만 유효하며 연결 해제·차단·재연결 후 과거 grant는 되살아나지 않는다. 기여자 응답은 제목·owner의 최소 공개 정보·현재 회차 요약으로 제한하고 개인 목표 원본과 다른 peer의 칭찬 기록은 반환하지 않는다.
- 실행 환경·도구 버전: Windows 로컬, Node 24.19.0, pnpm 11.19.0, Next.js 16.4.0, Supabase CLI 2.120.0, PostgreSQL 17.11; 로컬 DB loopback `127.0.0.1`, synthetic Auth-issued session.
- 실행 명령 또는 수동 재현 단계: `scripts/project.ps1 -Task db:migrate`; `scripts/project.ps1 -Task db:test`; `scripts/project.ps1 -Task db:shared-test`; `scripts/project.ps1 -Task api:board-test`; `pnpm run check`; `pnpm run build:check`; UI06 invalid synthetic invite token local-render smoke.
- 관찰 결과·증거 파일: pgTAP 013 5/5·전체 DB 252/252, Auth 세션 8/8, A/B/C API 각각 14/14, unit 100/100, Biome·typecheck·artifact check·build:check 통과. [W09-C 검사 증거](../quality/reports/w09-c-shared-board-ui-check-2026-10-08.json)
- 통과 / 실패 / 미실행: 위 기재한 DB/API/unit/build 및 UI06 읽기 smoke 통과. 브라우저의 실제 mutation submit·제품 수락 E2E·기기/스크린리더·실제 Google/OTP 로그인은 미실행으로 유지한다.
- 결함과 해결: 공유판 접근 화면이 소비할 수 있는 현재 권한 목록 route가 없었다. generation·grant·block·삭제 상태를 서버에서 재검사하는 제한 projection RPC/API를 추가하고 UI 목록 cursor를 연결했다.
- 다음 의존 작업: W10 소식·보낸함·목표 휴지통·계정 정리 API/UI. 제품 수락·기기/접근성·실제 로그인 검사는 W13/W15에서 수행한다.
