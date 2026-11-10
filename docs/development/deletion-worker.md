# 계정 삭제 작업자

2026-11-10 / W14-C1 / REQ-010·NFR-001·NFR-004 / POL-DELETE-002·003

일반 웹 서버는 사용자 세션으로 탈퇴를 접수하고 즉시 접근을 차단한다. 실제 파기는 별도의 권한을 가진 작업자가 처리한다. `src/operations/account-deletion-worker.mjs`는 일반 route에서 불러오지 않으며 관리 키를 웹 환경이나 브라우저에 추가하지 않는다.

## 처리 순서와 실패

1. service-only RPC에서 삭제 작업의 대상 UUID·최소 상태를 다시 읽는다. 이메일이나 브라우저가 보낸 UUID를 Auth 삭제 대상으로 사용하지 않는다.
2. 원본 DB 밖의 원장에 요청 ID·대상 UUID·종류·접수 시각을 기록하고 같은 대상에 묶인 내구성 있는 영수증을 확인한다. 실패하거나 다른 대상을 가리키면 실제 파기를 중단한다.
3. 기존 `process_account_deletion` RPC의 원장 gate·트랜잭션·권한을 거쳐 앱 데이터를 파기한다.
4. Auth Admin으로 해당 UUID를 삭제하고 조회가 실제 404인지 확인한다. 장애·503은 삭제 완료로 취급하지 않는다.
5. 기존 완료 RPC가 DB에서 Auth 부재를 확인한 뒤 완료 시각을 기록한다.
6. 독립 원장에 완료 시각과 완료 후 최소 37일 보관을 확정하고 DB에 원장 완료 확인을 기록한다. 실패하면 재시도 대상으로 남긴다. 완료된 Auth 삭제를 다시 요구하지 않는다.

미완료 원장 기록에는 만료가 없다. 원장 장애로 완료 확인을 남기지 못한 작업은 DB가 completed여도 다시 조회한다. 작업 결과는 건수만 반환하고 원본 오류·본문·이메일·대상 UUID를 로그에 출력하지 않는다. 완료된 작업의 확인 여부만으로 복원 안전성을 주장하지 않는다. 복원 전에 독립 최신 원장의 실제 재적용이 필요하다.

## 내부 DB 계약

신규 SQL `20261110000100_deletion_worker_dispatch.sql`은 private 스키마에 두 테이블을 추가한다. 기존 18개 제품 테이블과 브라우저 API 계약은 유지한다.

| 테이블 | 열·관계 | 용도 |
| --- | --- | --- |
| private.deletion_work_leases | request_id PK/FK → account_deletion_requests.id, lease_until, last_attempted_at | 최대 25건을 SKIP LOCKED로 예약하고 5분 뒤 장애 재시도 허용 |
| private.deletion_ledger_completion_acks | request_id PK/FK → account_deletion_requests.id, ledger_reference, acknowledged_at | 완료 원장의 내구성 확인 이후에만 dispatch에서 제외 |

두 FK는 작업 정리 시 CASCADE다. 두 테이블 모두 RLS를 강제하며 anon·authenticated·service_role의 직접 테이블 권한을 제거한다. 함수 소유자는 기존 NOLOGIN 작업자 역할 `chagokchan_worker`이며 고정 `pg_catalog` search_path·스키마 한정·`require_service_worker` 검사를 유지한다. EXECUTE는 service_role에만 부여한다.

| RPC | 입력 | 반환 |
| --- | --- | --- |
| get_account_deletion_work | p_request_id uuid | request_id, subject_id, status, checkpoint, ledger_reference, requested_at, completed_at, ledger_acknowledged |
| list_account_deletion_work | p_limit integer, 1~25, 기본 10 | items의 request_id만 |
| ack_account_deletion_ledger | p_request_id, p_ledger_reference | id, ledger_acknowledged=true |

ACK는 completed/auth_removed·동일 원장 참조일 때만 가능하다. lease는 중복 dispatch를 줄이며 DB의 멱등 처리·대상 확인을 대신하지 않는다. 모든 실행 경로가 정확히 한 번만 실행된다고 보장하지 않는다.

## 로컬 검증용 원장

`LocalEncryptedDeletionLedger`는 격리 검사·복원 도구를 위한 파일 어댑터다. AES-256-GCM·레코드별 난수 IV·목적/출처/요청에 묶인 AAD를 적용하고, 임시 파일 fsync·원자적 rename·읽기 검증 후 응답한다. 키는 실행 시 난수로 주입하며 Git에 저장하지 않는다. 값 변조·다른 키/출처·대상 불일치·짧은 보관 기한을 거절한다. 인스턴스 안의 쓰기만 직렬화한다. 여러 프로세스가 공유하는 운영 저장소로 선택하지 않았다.

실행은 고정 런타임에서 `./scripts/project.ps1 -Task db:deletion-worker-test`다. loopback·프로젝트·로컬 DB 검사를 통과한 뒤 실행별 합성 사용자만 생성/정리한다. 기존 제품 데이터·Auth 사용자/세션·검증 키·gate·내부 작업 상태 보존을 검사한다. 완료 확인 행만 되돌리는 재실행 검사는 전체 DB 백업 복원 검사가 아니다.

호스팅 원장·스케줄·백업/복원·삭제 지연 알림은 아직 구성하지 않았다. 실제 배포의 gate는 계속 false다. TC-DELETE-WORKER-LOCAL-001과 전체 TC-DELETE-003/004를 구분하며, 이 로컬 기반 통과만으로 공개하지 않는다. [진행표](backlog.md)
