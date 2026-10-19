# ADR-0006 — 공유판 집계와 작성자 취소를 위한 최소 권한 역할

- 상태: 채택, 2026-10-16 로컬 DB 적용·검증 완료, 운영 미적용([검사 증거](../quality/reports/w09-d-shared-count-cancel-check-2026-10-16.json))
- 결정일: 2026-10-16 / 작업: W09-D
- 참조: REQ-004·REQ-007·REQ-009·REQ-012, POL-PRAISE-001·POL-PRAISE-002·POL-CYCLE-001, TC-SHARED-COUNT-001·TC-CYCLE-001·TC-CYCLE-002·TC-PRAISE-002
- 기준: [구현 브리프](../plans/W09-D-shared-count-cancel-fix.md), [세션 확인 역할](ADR-0005-local-auth-session-reader.md)

## 문제

`chagokchan_rpc`에는 FORCE RLS가 적용된다. 공유판 기여자는 자기 칭찬만 읽으므로 여러 작성자의 유효 칭찬을 재집계하면 실제보다 작게 저장된다. 연결이나 판 권한이 끝난 작성자는 목표·회차 행의 잠금 정책에도 막혀 자기 기록을 취소할 수 없다.

## 결정

`chagokchan_counter`는 NOLOGIN·NOINHERIT·NOSUPERUSER·NOCREATEDB·NOCREATEROLE·NOREPLICATION·BYPASSRLS 역할이다. 다른 역할의 멤버가 아니며 anon·authenticated·service_role·chagokchan_rpc도 이 역할의 멤버가 아니다. Supabase가 `supabase_admin` 명의로 자동 부여하는 postgres의 counter 멤버십은 기존 session_reader·worker 역할과 같은 플랫폼 기본값으로 허용한다. 다음 열 권한과 public/private 스키마 USAGE, `private.require_actor()` 실행 권한만 부여한다.

| 테이블 | SELECT | UPDATE |
| --- | --- | --- |
| praises | id, board_id, bunch_id, actor_user_id, source, cancelled_at, excluded_at | 없음 |
| boards | id, goal_id, owner_user_id | 없음 |
| goals | id, owner_user_id, status | revision, FOR UPDATE 잠금용이며 실제 갱신하지 않음 |
| bunches | id, board_id, target_count, valid_count, progress_state, completed_at | valid_count, progress_state, completed_at |

이 역할은 `private.lock_praise_cycle(uuid)`와 `private.recount_bunch(uuid,timestamptz)`만 소유한다. 두 함수는 SECURITY DEFINER·고정 `search_path=pg_catalog`와 스키마 한정 참조를 사용한다. 소유권 이전 뒤 `set local role chagokchan_counter`로 함수 소유자가 되어 revoke·grant를 실행하고 `reset role`로 돌아온다. 실행 권한은 소유자 외 `chagokchan_rpc`에만 부여한다. PUBLIC·anon·authenticated·service_role에는 노출하지 않는다. 마이그레이션에서 명시적으로 부여한 소유권 이전용 멤버십과 스키마 CREATE는 같은 마이그레이션에서 회수하며, 플랫폼이 별도 grantor로 부여한 postgres 멤버십은 유지될 수 있다.

잠금 헬퍼는 현재 세션의 행위자를 내부에서 확인하고 작성자 본인일 때만 goal → bunch를 잠근다. 반환값은 목표 상태·회차 ID·판 ID·목표 수 네 필드다. 공개 취소 RPC가 이어서 praise를 잠그고 목표 삭제를 replay보다 먼저 검사한다. 집계 헬퍼는 회차를 재잠그고 모든 유효 칭찬을 세어 개수·완성·완성 시각을 함께 갱신한다. 상한 초과는 PT503이다. 취소는 본문·실천일·태그를 한 UPDATE로 제거한다.

새 마이그레이션은 회차 테이블을 EXCLUSIVE로 잠근 뒤 마이그레이션 소유자 권한으로 기존 파생값을 보정한다. 상한 초과 데이터가 있으면 전체를 실패시키고 소식은 재생성하지 않는다. 운영에서는 기존 함수 호출이 모두 끝난 무트래픽 시점에 적용한다.

## 대안

- 증감 방식: 이미 틀어진 값과 제외·취소 중복 상태를 직접 해결하지 못해 채택하지 않았다.
- RLS 정책 확대: 기여자에게 다른 사람의 행 또는 권한 종료 후 목표·회차 접근을 넓혀야 하므로 채택하지 않았다.
- postgres 소유 함수: 업무에 필요한 열보다 넓은 권한으로 실행되므로 채택하지 않았다.

## 결과와 검사

일반 업무 RPC의 RLS·응답 계약은 유지한다. BYPASSRLS 함수의 결함은 허용된 열에 영향을 줄 수 있으므로 열 권한·함수 소유권·실행 ACL·임시 권한 회수를 pgTAP 016에서 검사한다. 여러 작성자 집계·완성 소식·연결/권한 종료 후 취소·제외 후 취소·재시도·타인/삭제 목표 404·기존 데이터 불일치 0행도 검사한다. SQL 작성과 DB 통과는 구분하며, 실제 실행 결과는 [검사 증거](../quality/reports/w09-d-shared-count-cancel-check-2026-10-16.json)에 기록한다.
