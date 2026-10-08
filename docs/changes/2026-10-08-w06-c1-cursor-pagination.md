# W06-C1 관계 목록 페이지 경계 보완

- 작업 ID·제목: W06-C1 후속, 연결·초대·요청·차단 목록 cursor 경계 보완
- 날짜·담당: 2026-10-08, Codex
- 변경 목적·전후 동작: `limit+1` lookahead로 다음 페이지 존재를 확인하면서, 반환되지 않은 lookahead row 자체를 다음 cursor로 사용해 해당 row가 건너뛰어질 수 있었다. 네 관계 목록이 현재 페이지의 마지막 반환 행 뒤에서 이어지도록 수정했다.
- 관련 REQ / POL / TC / API operation: REQ-005, `POL-CONNECT-001`, `POL-CONNECT-002`, `POL-ACCESS-001`, `POL-SEC-001`; TC-DB-CONNECT-001~004; `listConnections`, `listConnectionInvites`, `listConnectionRequests`, `listBlocks`.
- 기준 소스: base commit `61e910fb6eeeab4fea167918dfd3431517a83688`; changed SQL·test source hash는 [검사 증거](../quality/reports/w06-c1-cursor-pagination-check-2026-10-08.json)에 기록했다.
- 변경 파일·마이그레이션: `20261008023000_connection_list_cursor_boundary_fix.sql`에서 네 SECURITY DEFINER 목록 함수의 반환 행 카운트와 마지막 `created_at/id`를 추적한다. `supabase/tests/005_business_rpc_connections.test.sql`에 네 함수 정의의 cursor 경계를 검사하는 assertion을 추가하고 `scripts/test-local-connection-rpc.mjs`는 네 목록을 실제 Auth 세션으로 모두 탐색한다. 기존 마이그레이션은 편집하지 않았다.
- 정책·데이터 영향: API 파라미터·권한·응답 필드는 변경하지 않는다. 기존 order `(created_at DESC,id DESC)`를 유지하면서 페이지 간 행 누락/중복을 막는다. 초대 비밀·사용자 기록·앱 fixture는 노출·변경하지 않는다.
- 실행 환경·도구 버전: Windows 로컬 Supabase loopback, Docker Engine 29.1.3, PostgreSQL 17.11, Node 24.19.0, pnpm 11.19.0, Supabase CLI 2.120.0 / SDK 2.117.3.
- 실행 명령 또는 수동 재현 단계: `scripts/project.ps1 -Task db:migrate`; `scripts/project.ps1 -Task db:connection-test`; `scripts/project.ps1 -Task db:rpc-test`; `scripts/project.ps1 -Task db:test`; `scripts/project.ps1 -Task check`. 사용자 세션은 Auth가 발급했으며 app RPC에는 service role을 사용하지 않았다.
- 관찰 결과·증거 파일: [W06-C1 커서 페이지 검사](../quality/reports/w06-c1-cursor-pagination-check-2026-10-08.json).
- 통과 / 실패 / 미실행: 초대 5개·요청 3개 이상·연결 200개 이상·차단 5개에서 전체 페이지 ID 일치, 누락/중복 0. 관계 pgTAP 20/20, DB 전체 161/161, RPC 110/110, 관계 세션 13/13. fixture/세션 정리 통과. Google/OTP 로그인 0회.
- 결함과 해결: base64 cursor의 줄바꿈 문제는 같은 관계 목록이 공통으로 사용하는 encoder를 W06-C2의 `20261008022800`에서 수정했다. 이 후속 migration은 실제 다중 페이지 탐색과 함께 적용·검증했다.
- 다음 의존 작업: W06-D 소식/요청 결과·계정 삭제/파기 RPC와 FK 정리 경계. W06-D 완료 전 W06 전체는 IN_PROGRESS다.
