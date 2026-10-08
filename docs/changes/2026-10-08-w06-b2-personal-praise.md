# W06-B2 개인 칭찬·회차 업무 RPC

- 작업 ID·제목: W06-B2 — 개인 셀프 칭찬·회차 snapshot·집계·완성 알림·쿼터
- 날짜·담당: 2026-10-08 / Codex
- 변경 목적·전후 동작: 개인 칭찬과 회차 업무 경계가 없었다. 이제 목표 주인이 실제 발급 세션으로 개인판에 칭찬을 만들고 수정·취소할 수 있다. 회차 snapshot, 개수, 완료 시각, 재시도 영수증, 제한 카운터 및 회차당 한 번의 완성 알림을 RPC 트랜잭션으로 처리한다.
- 관련 REQ / POL / TC / API operation: REQ-002/003/007/008, POL-GOAL-002, POL-CYCLE-001, POL-PRAISE-001/002, POL-API-001, POL-LIMIT-001, TC-DB-PRAISE-001, TC-DB-CYCLE-001, TC-DB-RATE-001. 계약 기준은 `createPraise`, `editSelfPraise`, `cancelPraise`, `updateBoard`다.
- 기준 소스: 부모 commit `ec709aecc04a4892ecef17e271af1a3a57539367`; 변경 코드·정책/진행 문서의 SHA-256은 [검사 증거](../quality/reports/w06-b2-personal-praise-check-2026-10-08.json)에 기록한다.
- 변경 파일·마이그레이션: `20261008021400` 개인 칭찬·회차 RPC/RLS/열 권한, `20261008021500` 회차 번호 변수 한정, `20261008021600` 검증된 actor를 이용한 완성 알림 경로, `20261008021700` 충돌 검사에 필요한 수신자 한정 notifications SELECT RLS. pgTAP 권한 검사, 발급 세션 통합 검사, 기술 TC·진행표·등록부·인계·검사 증거를 갱신했다. 앞선 적용 migration을 수정하지 않았다.
- 정책·데이터 영향: 개인판은 주인만 기록한다. 목표가 active가 아니면 새 칭찬을 거절한다. UTC 분당 20건·일 300건 제한을 원자적으로 차감한다. 취소는 작성자만 가능하고 본문/실천일을 지우며 해당 회차 집계만 감소시킨다. 회차 target은 생성 시 고정해 이후 설정 변경을 다음 회차부터 적용한다. 과거 회차 취소는 현재 포인터를 이동하지 않는다. 완성 처리·알림은 같은 트랜잭션이다.
- 보안 메모: 알림의 `(recipient_user_id, dedupe_key)` 충돌 처리는 PostgreSQL에서 제안된 INSERT 행의 SELECT 정책도 평가한다([CREATE POLICY](https://www.postgresql.org/docs/current/sql-createpolicy.html)). 알림 조회 정책과 열 SELECT 권한은 `chagokchan_rpc`에만 주고 수신자를 현재 검증된 세션 사용자로 한정했다. `authenticated`의 직접 SELECT/DML 권한은 계속 거절된다.
- 실행 환경·도구 버전: Node 24.19.0, pnpm 11.19.0, Supabase CLI 2.120.0, Supabase SDK 2.117.3, PostgreSQL 17.11, loopback 전용 로컬 Supabase.
- 실행 명령 또는 재현 단계: `scripts/project.ps1 -Task db:migrate`, `db:test`, `db:rpc-test`, `db:praise-test`, `db:goal-test`, `db:session-test`, `check`, `build:check`.
- 관찰 결과·증거: 전체 DB 116/116(물리 51, RPC 경계 21, 업무 권한/RLS 44), RPC 전용 65/65, 실제 발급 로컬 세션 개인 칭찬 통합 12/12, 목표 통합 회귀 12/12, A/B/C 세션 회귀 27/27. 칭찬 마지막 단위의 서로 다른 요청 경합, 회차 이동, 다음 회차 설정, 완성 알림 dedupe/RLS, UTC 제한, 실패 주입 후 칭찬·회차·영수증·쿼터 롤백과 같은 요청 재시도를 확인했다. 정리와 기존 fixture 보존도 통과했다. `check`(lint 22개·typecheck·단위 32/32·구조 검사)와 offline Next 16.4.0 빌드가 통과했다. [세부 검사 증거](../quality/reports/w06-b2-personal-praise-check-2026-10-08.json)
- 통과 / 실패 / 미실행: TC-DB-PRAISE-001·TC-DB-CYCLE-001·TC-DB-RATE-001 통과. 업무 UI/BFF 및 제품 수락 36개, 실제 Google/OTP 검증은 미실행이다. 이 로컬 Auth 검사는 제공자 로그인 완료로 집계하지 않는다.
- 결함과 해결: 최초 로컬 실행에서 `cycle_no` 열/PLpgSQL 변수 이름이 충돌해 회차 번호 변수를 후속 migration에서 `v_cycle_no`로 한정했다. 실제 완료 알림 테스트에서 알림 INSERT 정책은 통과하지만 `ON CONFLICT`가 충돌 대상의 SELECT RLS도 요구함을 확인해 현재 수신자만 보는 SELECT 정책을 추가했다. rate-limit 테스트는 선행 테스트가 남긴 사용량을 초기화해 롤백 경로를 독립 검증하도록 조정했다.
- 다음 의존 작업: W06-C 연결·초대·요청·판 grant·공유 칭찬 및 연결 해제/차단/권한 회수 경합. W06 전체는 IN_PROGRESS.
