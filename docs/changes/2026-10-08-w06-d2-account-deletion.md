# W06-D2 계정 탈퇴·계정/상대 기록 파기 RPC

- 작업 ID·제목: W06-D2, 현재 세션 재인증·즉시 접근 중단·작성자/수신자 데이터 파기·Auth 최종 삭제
- 날짜·담당: 2026-10-08, Codex
- 변경 목적·전후 동작: 계정 탈퇴는 정책·계약에만 있었다. 현재 발급 Auth 세션과 재인증 grant를 검증해 탈퇴를 원자 접수하고, checkpoint가 있는 최소 권한 worker로 앱 자료를 파기한 뒤 Auth Admin 삭제를 마지막에 처리한다.
- 관련 REQ / POL / TC / API operation: REQ-010·NFR-001·NFR-004, POL-ACCOUNT-002·POL-DELETE-002·POL-DELETE-003·POL-ACCESS-001·POL-SEC-001·POL-API-001; TC-DB-DELETE-003~004; `requestAccountDeletion`의 DB RPC `request_account_deletion(uuid,uuid,boolean)`.
- 기준 소스: base commit `b5290ad80b64e5f7952c2a2a9de425be3e82ef3f`; 변경 파일별 SHA-256은 [검사 증거](../quality/reports/w06-d2-account-deletion-check-2026-10-08.json)에 기록한다.
- 변경 파일·마이그레이션: `20261008023500`~`20261008024200`, `supabase/tests/008_business_rpc_account_deletion.test.sql`, `scripts/test-local-account-deletion.mjs`, `package.json`, `scripts/project.ps1`, OpenAPI RPC 상태, 테스트 케이스·생명주기 정책 설명·인계·진행표.
- 정책·데이터 영향: 같은 Auth UUID·현재 session_id·10분 이내 `account.delete` grant만 한번 소비한다. 접수 트랜잭션이 app account를 deleting으로 바꾸고 request checkpoint를 생성해 즉시 접근을 차단한다. 작성자 탈퇴는 다른 사람 판의 유효 peer 이벤트 수를 유지하면서 작성자·본문·날짜·receipt 입력을 제거한다. 수신자 탈퇴는 본인 소유 목표·받은 칭찬·소식·관계·프로필을 제거한다. 앱 자료 실패는 전부 rollback하며 같은 ledger reference로 재시도한다. 앱 자료 파기 완료 뒤 Auth Admin 사용자를 지우고 최종 완료를 기록하며 삭제 marker가 UUID 재가입을 막는다. 외부 독립 삭제 원장 `OPS-INPUT-02`는 미설정이고 worker gate는 기본 차단이다.
- 실행 환경·도구 버전: Windows loopback Supabase, PostgreSQL 17.11, Node 24.19.0, pnpm 11.19.0, Supabase CLI 2.120.0 / SDK 2.117.3.
- 실행 명령 또는 수동 재현 단계: `scripts/project.ps1 -Task db:migrate`; `scripts/project.ps1 -Task db:test`; `scripts/project.ps1 -Task db:rpc-test`; `scripts/project.ps1 -Task db:lifecycle-test`; `scripts/project.ps1 -Task db:deletion-test`; `scripts/project.ps1 -Task check`.
- 관찰 결과·증거 파일: [W06-D2 검사 증거](../quality/reports/w06-d2-account-deletion-check-2026-10-08.json).
- 통과 / 실패 / 미실행: 전체 DB 213/213(물리 51·RPC 경계 21·업무 RPC 141), RPC 전용 162/162, D2 pgTAP 32/32, D2 발급 Auth 세션/Auth Admin 통합 6/6, D1 통합 4/4, lint·typecheck·단위 32/32·정적 산출물 검사 통과. 기존 fixture 보존·합성 probe 사용자/세션 정리 통과. BFF/API·UI·외부 원장·백업 복원·Google/OTP 로그인은 미실행/미설정.
- 결함과 해결: 첫 통합 실행에서 restricted RPC 소유자가 호출할 수 있는 현재 세션 guard wrapper가 부족했고 앱 계정 업데이트 CHECK·요청 생성에 필요한 최소 열/제약 함수 권한이 누락됐다. 고정 경로 guard wrapper와 개별 컬럼/검증 함수 실행 권한을 후속 migration으로 추가했으며 직접 RLS/DML 접근은 열지 않았다. 적용된 마이그레이션은 수정하지 않았다.
- 다음 의존 작업: W06 완료 후 W07에서 서버 측 로컬 사용자 adapter와 BFF API를 만든다. 실제 provider 재인증·로그인, 원장 구성·복원 검증은 W12/W13·W14/W15에서 실행한다.
