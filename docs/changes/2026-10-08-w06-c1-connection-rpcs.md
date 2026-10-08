# W06-C1 초대·연결 관계 RPC

- 작업 ID·제목: W06-C1, 일회 초대·연결 요청·관계 수명주기
- 날짜·담당: 2026-10-08, Codex
- 변경 목적·전후 동작: 정식 product schema에 남아 있던 연결·초대·요청·차단 테이블을 세션 검증 RPC로만 사용한다. 승인된 연결만 활성화하고 해제·차단 뒤 재연결 때 새 generation을 부여한다.
- 관련 REQ / POL / TC / API operation: REQ-005, `POL-CONNECT-001`, `POL-CONNECT-002`, `POL-LIMIT-001`, `POL-API-001`; TC-DB-CONNECT-001~004; `listConnections`, `createConnectionInvite`, `revokeConnectionInvite`, `previewConnectionInvite`, `createConnectionRequest`, `listConnectionRequests`, `acceptConnectionRequest`, `rejectConnectionRequest`, `cancelConnectionRequest`, `disconnect`, `createBlock`, `revokeBlock`, `listConnectionInvites`, `listBlocks`.
- 기준 소스: base commit `f9127974fab3dc52d8c41a2058fe7247fc09e79e`; 구현과 보고서는 이 변경을 포함한 Git 이력으로 식별한다.
- 변경 파일·마이그레이션: `20261008021800_connection_invite_request_rpcs.sql`에 14개 관계 RPC와 역할별 열 권한/RLS를 추가했다. 적용 뒤 발견한 결함은 `20261008021900_connection_secret_validation_fix.sql`, `20261008022000_connection_notification_conflict_select.sql`, `20261008022100_acceptance_notification_target.sql`로 수정했다. 적용한 앞선 SQL은 편집하지 않았다. 실제 발급 세션 통합은 `scripts/test-local-connection-rpc.mjs`, 관계 RPC 권한은 `supabase/tests/005_business_rpc_connections.test.sql`로 검사한다.
- 정책·데이터 영향: 링크 token 32자와 Crockford code 12자는 SHA-256만 저장하고, preview는 소비하지 않는다. 요청 생성만 초대를 원자적으로 소비한다. 사용자 쌍별 advisory lock과 pending unique index, 활성 관계 용량 lock으로 중복/경합을 직렬화한다. 수락 시 generation을 올리고 알림은 스키마 단일 target 제약에 맞춰 connection ID만 기록한다. block/disconnect는 연결을 닫고 grant 세대는 복구하지 않는다. 공유판 권한/칭찬은 W06-C2에 남아 있다.
- 실행 환경·도구 버전: Windows 로컬 Supabase loopback, Docker Engine 29.1.3, PostgreSQL 17.11, Node 24.19.0, pnpm 11.19.0, Supabase CLI 2.120.0 / SDK 2.117.3.
- 실행 명령 또는 수동 재현 단계: `node scripts/database-task.mjs migrate`; `node scripts/database-task.mjs test`; `node scripts/database-task.mjs rpc-test`; `node scripts/test-local-connection-rpc.mjs`; `node scripts/test-local-rpc.mjs`; `node scripts/test-local-goal-rpc.mjs`; `node scripts/test-local-personal-praise.mjs`. 각 로컬 DB 명령은 고정 런타임·loopback 검사로 실행했다.
- 관찰 결과·증거 파일: [W06-C1 검사 증거](../quality/reports/w06-c1-connection-rpc-check-2026-10-08.json).
- 통과 / 실패 / 미실행: DB 135/135, RPC 전용 84/84, 관계 RPC RLS 19/19, 연결 Auth 세션 통합 13/13, W06-A 회귀 27/27, 목표 12/12, 개인 칭찬 12/12 통과. 제품 수락 UI/API와 Google/OTP 로그인을 실행하지 않았다.
- 결함과 해결: 적용 전 `create_block`의 SQL 행 변수 대상 오류를 수정했다. 통합 검사에서 PostgreSQL의 `jsonb_object_length` 부재, ON CONFLICT 대상 SELECT RLS, 수락 알림 typed-target 불일치를 발견해 후속 migration 219~221로 고쳤다. 이 과정에서 임시 함수 생성 테스트의 PostgREST schema reload와 쿼터 사전 사용량 경계도 검사 코드에 반영했다.
- 다음 의존 작업: W06-C2 공유판 grant/revoke·최소 projection·공유 칭찬·연결/차단·권한 회수 동시성. W06-C/D 완료 전 W06 전체는 IN_PROGRESS다.
