# W06-C2 공유판 권한·공유 칭찬 RPC

- 작업 ID·제목: W06-C2, 공유판 grant/revoke·안전 projection·공유 칭찬·권한 회수 경합
- 날짜·담당: 2026-10-08, Codex
- 변경 목적·전후 동작: 연결만으로 열리지 않는 오너 관리형 공유판 접근과 지인 칭찬 기록을 구현한다. 공유판 칭찬은 개인 칭찬/목표 개수에 합산하지 않으며, 관계가 끊기거나 차단되면 현재 연결 세대와 권한을 다시 검사한다.
- 관련 REQ / POL / TC / API operation: REQ-003~REQ-008, `POL-PRAISE-001`, `POL-CYCLE-001`, `POL-LIMIT-001`, `POL-CONNECT-002`, `POL-ACCESS-001`, `POL-API-001`, `POL-SEC-001`; TC-DB-SHARED-001~004; `getBoard`, `listBoardPraises`, `createPraise`, `listBoardMembers`, `grantBoardMember`, `revokeBoardMember`.
- 기준 소스: base commit `c2097c26226704bf7204fca4a9a5848d3336b038`; 구현과 보고서는 이 변경을 포함한 Git 이력으로 식별한다.
- 변경 파일·마이그레이션: `20261008022200`~`20261008022900`에서 owner grant/revoke, generation-bound membership, 역할별 응답, peer-praise 원자 쓰기, 회차·쿼터·알림, RLS/열 권한을 추가했다. 후속 마이그레이션으로 UPDATE RLS 잠금 경로, receipt shape, projection 열 권한, base64 및 페이지 커서 경계를 수정했다. `scripts/test-local-shared-board-rpc.mjs`는 실제 Auth 발급 세션 통합을, `supabase/tests/006_business_rpc_shared_board.test.sql`은 DB 권한/RLS를 검사한다.
- 정책·데이터 영향: owner만 활성 연결 상대에게 최대 50개 grant를 관리한다. grant는 `connection_id`와 generation을 고정하고, revoke/disconnect/block 이후 기존 권한을 재활성화하지 않는다. owner와 contributor는 역할에 맞는 최소 projection을 받는다. peer praise는 receipt·기록·회차 snapshot/집계·알림·rate usage를 한 트랜잭션에 저장한다. 개인판과 공유판 개수는 독립적으로 유지한다.
- 실행 환경·도구 버전: Windows 로컬 Supabase loopback, Docker Engine 29.1.3, PostgreSQL 17.11, Node 24.19.0, pnpm 11.19.0, Supabase CLI 2.120.0 / SDK 2.117.3.
- 실행 명령 또는 수동 재현 단계: `scripts/project.ps1 -Task db:migrate`; `scripts/project.ps1 -Task db:test`; `scripts/project.ps1 -Task db:rpc-test`; `scripts/project.ps1 -Task db:shared-test`. DB는 모두 local loopback target이며 앱 RPC에는 실제 Auth 발급 세션을 사용했다.
- 관찰 결과·증거 파일: [W06-C2 검사 증거](../quality/reports/w06-c2-shared-board-rpc-check-2026-10-08.json).
- 통과 / 실패 / 미실행: 전체 DB 160/160(물리 51, RPC 경계 21, 업무 RPC 88), RPC 전용 109/109, 공유판 pgTAP 25/25, 공유판 발급 세션 6/6 통과. 테스트 계정/세션 제거와 기존 fixture 보존 통과. 제품 API/UI·Google/OTP 로그인은 미실행.
- 결함과 해결: 실제 RLS 행 잠금·쓰기 경로에서 필요한 최소 정책/열 권한을 후속 마이그레이션으로 추가했다. PostgreSQL 함수 변수 이름, receipt validator의 두 업무 shape, owner projection의 hidden 상태 열, base64 line wrap 및 lookahead 기반 cursor skip을 각각 실제 DB 검사로 재현한 뒤 순서 있는 후속 마이그레이션으로 해결했다. 적용한 이전 마이그레이션은 수정하지 않았다.
- 다음 의존 작업: W06-D 소식/요청 결과·계정 삭제/파기 RPC와 FK 경계 검증. W06-D가 끝나기 전 W06 전체는 IN_PROGRESS다.
