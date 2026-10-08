# W06-D1 소식·휴지통·목표 파기 RPC

- 작업 ID·제목: W06-D1, 수신자 소식·보낸 peer 칭찬·목표 휴지통·복구·기한 파기
- 날짜·담당: 2026-10-08, Codex
- 변경 목적·전후 동작: 소식/보낸함과 목표 삭제가 설계에만 있었다. 수신자·현재 판 접근을 매번 확인하는 최소 목록, 반복 가능한 읽음 표시, 복구 가능한 30일 목표 휴지통, 권한 회수 및 독립 삭제 원장 gate를 갖춘 DB RPC를 구현했다.
- 관련 REQ / POL / TC / API operation: REQ-002·008·009·010, POL-DELETE-001·POL-ACCESS-001·POL-PRAISE-002·POL-API-001, TC-DB-NEWS-001~002·TC-DB-DELETE-001~002; `listNotifications`, `markNotificationRead`, `listSentPraises`, `deleteGoal`, `restoreGoal`, `listTrashGoals`.
- 기준 소스: base commit `730b96745ee916b991f116e145f077d6140a9e32`; 파일별 SHA-256은 [검사 증거](../quality/reports/w06-d1-news-and-purge-check-2026-10-08.json)에 있다.
- 변경 파일·마이그레이션: `20261008023100`~`20261008023400`, `supabase/tests/007_business_rpc_lifecycle.test.sql`, 기존 RPC 회귀 SQL, `scripts/test-local-lifecycle-rpc.mjs`, `package.json`, `scripts/project.ps1`, OpenAPI 상태, TC·개발 진행표.
- 정책·데이터 영향: 소식 응답은 대상 포인터를 포함한 최소 데이터이며 알림·목표 접근은 수신자/현재 권한으로 다시 검사한다. 보낸 peer 기록은 관계가 끝나도 목록에 남되 삭제된 목표의 기록은 숨긴다. 목표 삭제는 30일 휴지통으로 이동하고 활성 grant를 회수하며, 복구는 archived로 돌아가고 권한을 자동 복원하지 않는다. 만료 후 복구를 거절한다. purge worker는 독립 삭제 원장 설정과 UUID 참조가 없으면 실행되지 않는다. 외부 원장은 아직 설정하지 않았다.
- 실행 환경·도구 버전: Windows loopback Supabase, PostgreSQL 17.11, Node 24.19.0, pnpm 11.19.0, Supabase CLI 2.120.0 / SDK 2.117.3.
- 실행 명령 또는 수동 재현 단계: `scripts/project.ps1 -Task db:migrate`; `scripts/project.ps1 -Task db:test`; `scripts/project.ps1 -Task db:rpc-test`; `scripts/project.ps1 -Task db:lifecycle-test`.
- 관찰 결과·증거 파일: [W06-D1 검사 증거](../quality/reports/w06-d1-news-and-purge-check-2026-10-08.json).
- 통과 / 실패 / 미실행: W06-D1 pgTAP 20/20, Auth 발급 세션 통합 4/4 통과. 기존 fixture 보존·probe 계정/세션 정리 통과. 외부 원장 설정, Google/OTP 로그인, BFF/API·UI는 미실행. 로컬 DB에서만 합성 gate를 열어 FK purge 동작을 검사했다.
- 결함과 해결: lookahead 행으로 다음 cursor를 만들어 항목을 건너뛰던 점과 연결 해제 뒤 관계 검사를 요구해 보낸함이 빈 목록이 되던 점을 순서 있는 후속 마이그레이션으로 수정했다. worker의 JWT 판독과 `FOR UPDATE`에 필요한 권한도 비로그인 전용 역할/한정된 권한으로 정리했다. 적용된 마이그레이션은 수정하지 않았다.
- 다음 의존 작업: W06-D2 계정 탈퇴/작성자·수신자 파기와 재시도를 완료하고 W06 전체 회귀를 갱신한다. 독립 삭제 원장이 구성되기 전 운영 purge gate는 닫힌다.
