# W09-D 공유판 회차 집계와 보낸 칭찬 취소 결함 수정

- 상태: DONE (2026-10-16 구현 리뷰 r3 APPROVED)
- 작성: Claude / 날짜: 2026-10-16
- 구현 브랜치: codex/W09-D-shared-count-cancel-fix
- 참조: REQ-004·REQ-007·REQ-009·REQ-012 / POL-PRAISE-001·POL-PRAISE-002 / TC-CYCLE-001·TC-CYCLE-002·TC-PRAISE-002, TC-SHARED-COUNT-001(신규) / create_peer_praise·cancel_praise / 진행표 W09-D(신규)
- 발견: W10-D 브리프 리뷰(Codex, 2026-10-16)가 지적했고, Claude가 로컬 DB의 롤백 트랜잭션으로 재현했다.

## 결함과 재현

1. **집계 오류:** 소유자 O의 공유판(목표 5)에 기여자 P1이 1건, P2가 2건을 남겼다.
   - 실제 유효 칭찬은 3건인데 `bunches.valid_count`는 **2**다. P2의 `create_peer_praise`가 `count(*)`를 셀 때 RLS 때문에 P1의 행이 보이지 않았다.
   - 이어서 P1이 자기 칭찬을 취소하자 실제 유효 칭찬은 2건인데 `valid_count`는 **0**이 됐다. `cancel_praise`의 재집계도 같은 이유로 자기 행만 셌다.
   - 완성 판정(`progress_state`, `completed_at`)과 `bunch_completed` 소식도 함께 틀어진다.
   - 원인 위치: `20261008022500_shared_praise_cycle_column_fix.sql:80`, `20261008025000_praise_tag.sql`의 `cancel_praise`. 둘 다 `chagokchan_rpc` 권한으로 실행되고, `praises`에는 FORCE RLS가 걸려 있다. 기여자는 자기가 쓴 행만 볼 수 있다.
2. **연결이 끊긴 뒤 취소 불가:** `cancel_praise`는 `for update of p, g`로 목표 행을 잠근다. 목표 행 잠금 정책(`rpc_current_contributor_goals_lock`)은 현재 기여자만 허용한다. 그래서 연결이나 판 권한이 끝난 작성자는 404(`praise_not_found`)를 받는다. POL-PRAISE-002("연결·차단·판 권한이 끝난 작성자도 보낸함 경로로 자기 기록을 취소할 수 있다")와 `list_sent_praises`의 `can_cancel=true`에 어긋난다.

## 목표

1. 기여자가 여럿이어도 공유판 회차의 `valid_count`와 완성 상태가 실제 유효 칭찬 수와 같다.
2. 연결이나 판 권한이 끝난 작성자도 자기 peer 칭찬을 취소할 수 있고, 회차 개수가 실제 값으로 다시 계산된다.
3. 취소·제외·목표 삭제가 같은 순서로 잠가 교착하지 않는다.
4. 이미 틀어진 기존 회차 값을 한 번 바로잡는다.

## 확정한 설계

### 전용 집계 역할과 헬퍼

기여자 권한으로는 다른 사람의 칭찬 행을 볼 수 없어 정확히 셀 수 없다. 연결이 끊긴 작성자는 회차·목표 행을 잠글 수도 없다.

ADR-0005의 `chagokchan_session_reader`, W10의 `chagokchan_worker`와 같은 패턴으로 해결한다. RLS를 우회하되 필요한 열 권한만 가진 NOLOGIN 역할을 두고, 그 역할이 소유한 내부 헬퍼 2개만 RPC가 호출하게 한다. RLS 정책은 새로 추가하지 않는다.

**역할 `chagokchan_counter`**

`create role chagokchan_counter nologin noinherit nosuperuser nocreatedb nocreaterole noreplication bypassrls;`

다른 역할의 멤버로 넣지 않는다. 테이블 권한은 아래 열 권한뿐이며, DELETE·INSERT와 테이블 전체 권한은 주지 않는다.

| 테이블 | select 열 | update 열 |
| --- | --- | --- |
| `public.praises` | id, board_id, bunch_id, actor_user_id, source, cancelled_at, excluded_at | 없음 |
| `public.boards` | id, goal_id, owner_user_id | 없음 |
| `public.goals` | id, owner_user_id, status | revision (행 잠금용) |
| `public.bunches` | id, board_id, target_count, valid_count, progress_state, completed_at | valid_count, progress_state, completed_at |

- goals의 update(revision)은 `for update` 행 잠금에만 필요하다. 헬퍼는 goals를 갱신하지 않으며, 이 내용을 주석으로 남긴다.
- `grant usage on schema private to chagokchan_counter`와 `private.require_actor()` 실행 권한을 준다. `public` 스키마 usage도 기존 역할 패턴(20261008020700)대로 명시한다.

**헬퍼 1 `private.lock_praise_cycle(p_praise_id uuid) returns jsonb`**

- 속성: SECURITY DEFINER, owner `chagokchan_counter`, `set search_path = pg_catalog`, 스키마 한정 이름만 쓴다.
- 동작:
  1. 행위자는 함수 안에서 `private.require_actor()`로 얻는다. 인자로 받지 않는다.
  2. 칭찬을 잠금 없이 읽는다. 칭찬이 없거나 작성자가 행위자가 아니면 `PT404 praise_not_found`를 낸다.
  3. 목표 행을 `for update`로 잠근다.
  4. 회차 행을 `for update`로 잠근다.
  5. `{goal_status, bunch_id, board_id, target_count}`만 반환한다. 다른 사람의 칭찬이나 개수는 반환하지 않는다.
- 실행 권한: `revoke all … from public, anon, authenticated, service_role; grant execute … to chagokchan_rpc;`

**헬퍼 2 `private.recount_bunch(p_bunch_id uuid, p_now timestamptz) returns integer`**

- 속성과 실행 권한: 헬퍼 1과 같다.
- 동작:
  1. 회차 행을 `for update`로 잠근다. 같은 트랜잭션 안의 재잠금이다.
  2. 유효 칭찬 수(`cancelled_at is null and excluded_at is null`)를 RLS 없이 센다.
  3. 센 값이 `target_count`를 넘으면 `PT503 bunch_count_invalid`를 낸다.
  4. `valid_count`·`progress_state`·`completed_at`을 기존 규칙으로 갱신한다. 목표 수와 같으면 `coalesce(completed_at, p_now)`, 작으면 incomplete·null이다.
  5. 센 값을 반환한다. 호출자는 `chagokchan_rpc`의 RPC 코드뿐이며, 공개 RPC 응답에 계약 밖의 값을 넣지 않는다.

### RPC 변경

**`create_peer_praise`**

기존 잠금 순서(goal → board → connection → member → bunch)와 검사는 그대로 둔다. 개수를 세서 회차를 갱신하는 부분만 `v_valid_count := private.recount_bunch(cycle_uuid, now_at)`로 바꾼다. 완성 판정과 `bunch_completed` 소식은 이 값으로 판단한다.

**`cancel_praise`**

self와 peer 공통으로 잠금 순서를 **goal → bunch → praise**로 바꾼다. 제외(`private.set_peer_praise_state`: goal → board → bunch → praise), 목표 삭제(goal)와 같은 순서다.

1. `private.lock_praise_cycle(p_praise_id)`를 호출한다. 작성자가 아니면 404다.
2. 칭찬 행을 `for update`로 잠근다. 작성자 본인 행이므로 기존 update 정책으로 가능하다.
3. `goal_status = 'deleted'`이면 `PT404 praise_not_found`를 낸다. 목표 행을 잠근 뒤 판정하므로 `delete_goal`과 직렬화된다. 이 검사는 replay 판정보다 먼저 한다(취소 → 목표 삭제 → 재시도도 404).
4. 이미 취소된 칭찬이면 `replayed=true`를 돌려준다.
5. rate limit을 소비한다.
6. 칭찬을 취소한다. message·occurred_on·tag를 한 UPDATE 문에서 지운다.
7. `private.recount_bunch(bunch_id, now_at)`를 호출한다.

다른 사람의 칭찬을 취소하려 할 때 지금은 403 `praise_not_author`를 준다. 새 설계에서는 존재 여부를 숨기도록 404로 통일한다. 기존 검사 `scripts/test-local-personal-praise.mjs:159`는 외부인에게 PT404를 기대하므로 그대로 맞는다. 403을 기대하는 다른 기존 검사가 있으면 404로 맞추고 보고서에 적는다.

**바꾸지 않는 RPC**

- `private.set_peer_praise_state`(제외): 판 주인이 모든 행을 볼 수 있어 지금도 정확하다.
- `create_praise`(셀프 칭찬)

### 기존 데이터 바로잡기

같은 마이그레이션에서 `lock table public.bunches in exclusive mode`를 잡은 뒤, 마이그레이션 소유자 권한으로 모든 회차를 다시 계산한다.

- `valid_count`: 실제 유효 칭찬 수
- `progress_state`: 목표 수와 같으면 complete, 아니면 incomplete
- `completed_at`: complete인데 null이면 `now()`, incomplete이면 null

실제 유효 수가 `target_count`를 넘는 회차가 있으면 예외를 내 마이그레이션을 실패시킨다. 소식은 다시 만들지 않는다.

**배포 메모:** 적용 시점에 이미 실행 중이던 구버전 함수 호출이 보정값을 덮어쓸 수 있다. 운영 반영은 트래픽이 없는 시점에 한다(W17 배포 절차에 기록). 지금은 로컬 전용이다.

### ADR

`docs/decisions/ADR-0006-shared-cycle-counter-role.md`를 작성한다. 담을 내용은 다음과 같다.

- 문제: RLS 아래에서는 집계할 수 없고, 연결이 끊긴 작성자는 행을 잠글 수 없다.
- 결정: 전용 BYPASSRLS 역할과 열 권한만 가진 헬퍼 2개를 둔다.
- 대안과 기각 이유: 증감 방식, RLS 정책 확대, postgres 소유 함수
- 결과: 권한 범위와 검사

## 범위

- 새 마이그레이션 `supabase/migrations/<20261008025000보다 큰 타임스탬프>_shared_count_and_sender_cancel.sql`
  - 역할과 열 권한
  - 헬퍼 2개
  - `create_peer_praise`: `20261008022500`의 정의를 기준으로 집계 부분만 바꾼다.
  - `cancel_praise`: `20261008025000`의 정의를 기준으로 바꾼다.
  - 데이터 보정
  - 소유권 이전에 필요한 임시 권한은 기존 마이그레이션 패턴대로 주고 끝에 회수한다.
- 신규 pgTAP `supabase/tests/016_business_rpc_shared_count_and_sender_cancel.test.sql`
  - 역할 속성: nologin, bypassrls, 다른 역할의 멤버 아님
  - 열 권한 범위: praises·bunches에 DELETE·INSERT 없음, goals는 update(revision)만
  - 헬퍼: 소유자, `search_path`, 실행 권한은 `chagokchan_rpc`에만 있음. `authenticated`·`anon`·`service_role`은 직접 호출할 수 없음
  - 재현 시나리오:
    - 기여자 둘이 3건을 남기면 `valid_count = 3`
    - P1이 1건을 취소하면 2
    - P1의 연결이 끊긴 뒤(connections inactive, board_members revoked) P1이 다른 칭찬을 취소하면 성공하고, 개수가 실제와 같음
    - 제외된 칭찬을 취소해도 개수는 그대로
    - 목표 수에 도달하면 complete와 `bunch_completed` 소식 1건, 취소로 내려가면 incomplete
    - 같은 취소를 다시 보내면 `replayed=true`이고 두 번 줄지 않음
    - 다른 사람의 칭찬 취소는 404
    - 삭제된 목표의 칭찬 취소는 404
  - 데이터 보정 후 `valid_count`가 실제 개수와 다른 회차 0개
- 기존 검사 수정은 오류 코드가 403에서 404로 바뀌는 경우에만 한다.
- 문서
  - ADR-0006
  - `docs/policies/product-rules.md`: 공유판 집계와 작성자 취소 규칙을 한 줄씩 추가
  - `docs/data-erd.md`: 역할·권한 목록이 있으면 추가
  - `docs/quality/test-cases.json`: `TC-SHARED-COUNT-001` 추가
  - `docs/quality/verification-plan.md`
  - `docs/development/backlog.md`: W09-D 행을 추가하고 W09 상위 행에 메모
  - `docs/development/artifact-register.json`
  - `docs/deployment-and-git.md`: 배포 메모 한 줄
  - 변경 기록, 검사 증거

## 하지 말 것

- 이미 적용된 마이그레이션을 수정하지 않는다.
- RLS 정책을 추가하거나 넓히지 않는다(goals·bunches·praises 모두).
- 새 역할에 위에 적은 것 밖의 테이블·열 권한, DELETE·INSERT, 로그인 권한, 다른 역할 멤버십을 주지 않는다.
- postgres가 소유하는 SECURITY DEFINER 함수를 만들지 않는다.
- 헬퍼를 `authenticated`·`anon`·`service_role`에 노출하지 않는다.
- 다음은 바꾸지 않는다: `create_praise`, `private.set_peer_praise_state`, `list_sent_praises`, API 서버 코드, 브라우저 코드, API 계약.

## 구현 단계

1. 마이그레이션을 작성한다. 검증: `db:migrate`
2. pgTAP `016`을 작성한다. 검증: `db:test`(전체 회귀 포함)
3. 기존 회귀를 확인한다. 검증: `db:shared-test`, `db:praise-test`, `db:praise-result-test`, `db:connection-test`, `db:deletion-test`, `db:lifecycle-test`, `api:board-test`, `api:praise-tag-test`
4. ADR·문서·TC·진행표·변경 기록·검사 증거를 작성한다. 검증: `node scripts/verify-artifacts.mjs`

## 완료 기준

- [ ] 기여자 여럿이 생성·취소한 뒤에도 `valid_count`가 실제 유효 칭찬 수와 같다(pgTAP).
- [ ] 연결이나 판 권한이 끝난 작성자의 취소가 성공하고, 개수가 실제와 같다.
- [ ] 취소는 goal → bunch → praise 순서로 잠근다. 목표가 삭제된 뒤의 취소는 404다.
- [ ] 제외된 칭찬의 취소, 재시도, 다른 사람의 시도가 기준대로 처리된다.
- [ ] 새 역할과 헬퍼의 권한이 위 범위로 한정되고, RLS 정책은 늘지 않는다.
- [ ] 마이그레이션 뒤 모든 회차의 `valid_count`가 실제 개수와 같다(불일치 0행).
- [ ] 기존 DB·API 회귀 검사가 모두 통과한다.

## 검증 명령

```
.\scripts\project.ps1 -Task check
.\scripts\project.ps1 -Task db:migrate
.\scripts\project.ps1 -Task db:test
.\scripts\project.ps1 -Task db:shared-test
.\scripts\project.ps1 -Task db:praise-test
.\scripts\project.ps1 -Task db:praise-result-test
.\scripts\project.ps1 -Task db:connection-test
.\scripts\project.ps1 -Task db:deletion-test
.\scripts\project.ps1 -Task db:lifecycle-test
.\scripts\project.ps1 -Task api:board-test
.\scripts\project.ps1 -Task api:praise-tag-test
```

Codex 샌드박스에서는 lint·typecheck·unit(`--test-isolation=none`)·`verify-artifacts`만 실행한다. DB·API 검사는 리뷰 단계에서 Claude가 샌드박스 밖에서 실행한다.

## Codex 구현 보고

구현일: 2026-10-16 / 브랜치: `codex/W09-D-shared-count-cancel-fix` / 기준 HEAD: `9d68e2f51f97156c56070d3c897c4048f9b1e49a`. 사용자 지시에 따라 커밋·push하지 않았다. 아래는 최초 구현 당시 결과이며, 구현 리뷰 r1 이후 변경은 이 절 끝의 'r2 수정'에 기록한다.

### 변경 파일과 구현 범위

- `supabase/migrations/20261008025100_shared_count_and_sender_cancel.sql`: NOLOGIN 전용 역할·지정 열 권한·헬퍼 2개, create_peer_praise 집계 블록 교체, cancel_praise의 goal → bunch → praise 잠금·삭제 선검사·404·내용 동시 제거·재집계, 기존 회차 보정. 임시 멤버십/CREATE 회수 포함.
- `supabase/tests/016_business_rpc_shared_count_and_sender_cancel.test.sql`: 역할 속성·멤버십/열 권한/ACL·RLS 유지·다중 작성자 집계·완성 소식·연결/판 권한 종료 후 취소·제외/재시도·self 내용 제거·타인/삭제 목표 404·보정 후 불일치 0행의 pgTAP 39개 작성. **DB 미실행**.
- `docs/decisions/ADR-0006-shared-cycle-counter-role.md`: 최소 권한 역할·헬퍼·대안·검사·적용 제한.
- `docs/policies/product-rules.md`, `docs/deployment-and-git.md`: 전체 유효 수 집계·작성자 취소·무트래픽 적용 규칙.
- `docs/quality/test-cases.json`, `docs/quality/verification-plan.md`: TC-SHARED-COUNT-001 추가, 전체 계획 77개, 신규 TC는 `not_run` 유지.
- `docs/development/backlog.md`, `docs/development/artifact-register.json`: W09-D 및 W09 상위 `IN_PROGRESS`, DB 적용·회귀와 Claude 리뷰 대기 상태 반영.
- `docs/changes/2026-10-16-w09-d-shared-count-cancel.md`, `docs/quality/reports/w09-d-shared-count-cancel-check-2026-10-16.json`: 변경·명령별 증거·환경·소스 해시.
- 이 브리프: Codex 구현 보고 작성. W10-D 브리프와 기존 마이그레이션·RLS 정책·금지된 RPC/서버/브라우저/계약 파일은 수정하지 않았다.

### 실행 명령과 결과

환경은 Windows PowerShell 샌드박스, Node v24.19.0, Biome 2.5.15, TypeScript 5.9.3이다.

| 실행 명령 | 결과 |
| --- | --- |
| `.\node_modules\.bin\biome.cmd lint --error-on-warnings .` | 통과, 102파일, 경고·오류 없음 |
| `.\node_modules\.bin\tsc.cmd --noEmit` | 통과, exit 0 |
| `node --test --test-isolation=none <package.json test의 전체 13개 파일>` | 126/126 통과, 실패·건너뜀 0. 확장된 명령 원문은 검사 증거의 commands에 기록 |
| `node scripts/verify-artifacts.mjs` | 통과, 계획 TC 77개·JSON/로컬 링크/REQ·POL·API·등록부 일치 |
| `git diff --check` | 통과 |
| `docker version --format '{{.Server.Version}}'` | exit 1, 엔진 연결 실패 |
| `node scripts/database-task.mjs migrate` | exit 1, DB 사전 조건 실패 |
| `node scripts/database-task.mjs test` | exit 1, DB 사전 조건 실패 |
| `node scripts/test-local-shared-board-rpc.mjs` | exit 1, local_environment 실패 |
| `node scripts/test-local-personal-praise.mjs` | exit 1, local_environment 실패 |
| `node scripts/test-local-personal-praise-result-rpc.mjs` | exit 1, local_environment 실패 |
| `node scripts/test-local-connection-rpc.mjs` | exit 1, local_environment 실패 |
| `node scripts/test-local-account-deletion.mjs` | exit 1, local_environment 실패 |
| `node scripts/test-local-lifecycle-rpc.mjs` | exit 1, local_environment 실패 |
| `node scripts/test-local-board-api.mjs` | exit 1, 로컬 앱 기동 실패 |
| `node scripts/test-local-praise-tag-api.mjs` | exit 1, local_environment 실패 |

### 실행하지 못한 검사와 이유

명령은 위와 같이 시도했지만 마이그레이션 적용·새 pgTAP 39개·기존 DB/API 업무 회귀·실제 잠금 경합에는 진입하지 못했다. 모두 미실행이며 실패한 환경 확인을 업무 검사 실행/통과 수에 넣지 않았다. Claude가 샌드박스 밖에서 적용·전체 회귀·구현 리뷰를 이어가야 한다.

- Docker 오류 첫 줄: `permission denied while trying to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine`
- db:migrate 오류 첫 줄: `Local database migrate failed. Check the local setup and SQL assertion output; raw command output is withheld.`
- db:test 오류 첫 줄: `Local database test failed. Check the local setup and SQL assertion output; raw command output is withheld.`
- 공유·개인·개인 결과·연결·탈퇴·생명주기 및 tag API 사전 확인 오류: `Local database command failed (EPERM).` 공유·탈퇴·생명주기 출력에는 `local_environment:` 접두사가 있다.
- board API 오류 첫 줄: `Error: Local app exited before board API checks completed.`
- 실제 Google/OTP 로그인과 운영 배포는 이번 작업 범위가 아니며 실행하지 않았다.

### 브리프와 다르게 한 부분

- 기능·권한·파일 범위의 변경은 없다. 검증 진입 방식은 사용자의 이번 지시에 따라 `check` 래퍼 대신 `.bin`의 biome/tsc와 단위 테스트 격리 해제·산출물 검사를 직접 실행했다. DB/API도 package.json의 해당 node 스크립트를 직접 실행했다.
- `docs/data-erd.md`에는 DB 역할·권한 목록이 없어 조건부 수정 대상에 해당하지 않아 수정하지 않았다.
- 기존 검사에서 cancel_praise의 `praise_not_author`/403 기대를 찾지 못해 기존 검사 수정은 없었다.
- DB 검사 완료 기준은 충족으로 표시하지 않았다. 현재 진행표는 W09-A~C 기존 완료, W09-D와 상위 W09 `IN_PROGRESS`다.

### r2 수정

수정일: 2026-10-16 / 대상: 구현 리뷰 r1의 BLOCKED 2건·WARNING 1건 / 기준 HEAD·브랜치는 위와 같다. 리뷰의 처리 방법과 사용자 지시에 따라 미커밋 `20261008025100`을 같은 파일에서 수정했다. 커밋·push하지 않았다.

변경 파일:

- `supabase/migrations/20261008025100_shared_count_and_sender_cancel.sql`: 헬퍼 2개 각각 소유권 이전 → `set local role chagokchan_counter` → revoke·grant → `reset role` 순서로 수정했다. `20261008020700`·`20261008023300`의 기존 패턴을 따랐으며, 플랫폼이 별도로 부여하는 postgres 멤버십에 대한 주석을 추가했다.
- `supabase/tests/016_business_rpc_shared_count_and_sender_cancel.test.sql`: counter가 다른 역할의 멤버가 아님과 API 역할 4개가 counter의 멤버가 아님을 한 assertion에서 검사한다. Supabase 기본 postgres 멤버십은 허용한다는 주석을 추가했다. jsonb 비교 4곳은 양쪽 모두 `::text`로 맞춰 pgTAP의 지원 타입을 사용한다. 계획·소스상 assertion 수는 39개를 유지하며 DB 실행 통과를 뜻하지 않는다.
- `docs/decisions/ADR-0006-shared-cycle-counter-role.md`: 소유자로 전환한 ACL 설정과 플랫폼 기본 postgres 멤버십 허용을 리뷰 기준에 맞췄다.
- `docs/development/backlog.md`: W09-D r2 수정과 DB 재검증·재리뷰 대기를 반영했다. W09와 W09-D의 `IN_PROGRESS`는 유지해 등록부의 상위 단계와 일치시켰다.
- `docs/quality/reports/w09-d-shared-count-cancel-check-2026-10-16.json`: 최초 구현 증거를 보존하고 r2 변경 소스 해시·실행 결과·미실행 DB/API 검사를 추가했다.
- 이 브리프: 이 'r2 수정' 보고를 추가했다. 기존 적용 마이그레이션 `20261008020700`·`20261008023300`, W10-D 및 범위 밖 파일은 수정하지 않았다.

실행 환경: Windows PowerShell workspace-write 샌드박스, Node v24.19.0, Biome 2.5.15, TypeScript 5.9.3.

| 실제 실행 명령 | r2 결과 |
| --- | --- |
| `.\node_modules\.bin\biome.cmd lint --error-on-warnings .` | 통과, exit 0, 102파일, 경고·오류 없음 |
| `.\node_modules\.bin\tsc.cmd --noEmit` | 통과, exit 0 |
| `node --test --test-isolation=none scripts/runtime-environment.test.mjs scripts/docker-loopback-proxy.test.mjs scripts/local-fixture-manifest.test.mjs scripts/local-user-session.test.mjs scripts/api-security.test.mjs scripts/goal-api.test.mjs scripts/praise-api.test.mjs scripts/board-api.test.mjs scripts/connection-api.test.mjs scripts/news-api.test.mjs scripts/idempotent-request.test.mjs scripts/service-worker.test.mjs scripts/grape-layout.test.mjs` | package.json test의 전체 13파일, 126/126 통과, exit 0, 실패·취소·건너뜀 0 |
| `node scripts/verify-artifacts.mjs` | 통과, exit 0, 계획 TC 77개·JSON 43개·로컬 링크 545개 및 REQ·POL·API·등록부 일치 |
| `git diff --check` | 통과, exit 0 |

DB/API 미실행: 이번 r2에서는 사용자 지시에 따라 샌드박스에서 불가한 `db:migrate`, `db:test`(pgTAP 016의 39개 포함), `db:shared-test`, `db:praise-test`, `db:praise-result-test`, `db:connection-test`, `db:deletion-test`, `db:lifecycle-test`, `api:board-test`, `api:praise-tag-test`를 실행하지 않았다. 수정 SQL의 ACL·업무 동작·경합과 39개 assertion의 실제 실행 결과는 확인하지 못했다. Claude가 리뷰 기록의 처리 방법대로 폐기 가능한 로컬 DB를 초기화하고 시드를 다시 넣은 뒤 적용·전체 회귀·재리뷰해야 한다. 구현 리뷰 r1의 BLOCKED 판정을 임의로 해제하거나 기능 완료로 표시하지 않았다.

### r3 수정

수정일: 2026-10-16 / 대상: 구현 리뷰 r2의 BLOCKED 1건. 코드 변경은 `supabase/tests/016_business_rpc_shared_count_and_sender_cancel.test.sql`만이며, 마이그레이션과 기존 변경 파일은 수정하지 않았다. 커밋·push하지 않았다.

- `authenticated`·`chagokchan_rpc` 역할에서는 RPC 결과를 `\gset`으로 저장하고, pgTAP 단언은 `reset role` 뒤에 실행하도록 옮겼다. 업무 예외는 015처럼 현재 claims로 SECURITY DEFINER RPC를 호출하며 기존 SQLSTATE·메시지 기대를 유지한다. 헬퍼 직접 호출 거부는 실제 `authenticated` 역할의 DO 블록에서 성공 시 `00000`, 예외 시 SQLSTATE를 저장한 뒤 `42501`을 단언한다.
- `plan(39)`·assertion 39개와 각 설명·기대값을 유지했다. 정적 대조에서 역할 전환 중 pgTAP 호출 0건을 확인했으며 DB 통과를 뜻하지 않는다.
- 검증 환경: Windows PowerShell 샌드박스, Node v24.19.0·Biome 2.5.15·TypeScript 5.9.3. `.\node_modules\.bin\biome.cmd lint --error-on-warnings .` 통과(exit 0, 102파일), `.\node_modules\.bin\tsc.cmd --noEmit` 통과(exit 0), `node scripts/verify-artifacts.mjs` 통과(exit 0, 계획 TC 77개·JSON 43개·로컬 링크 545개). `git diff --check`도 통과했다.
- DB 검사는 샌드박스에서 불가하여 미실행이며, pgTAP 39개 실제 실행·DB/API 회귀·경합은 확인하지 않았다. W09·W09-D는 `IN_PROGRESS`, Claude DB 재검증·리뷰 대기를 유지한다. 보고 추가 외 브리프의 기존 내용과 리뷰 판정은 바꾸지 않았다.

## 리뷰 기록

- 브리프 리뷰 r1 (2026-10-16, Codex read-only) 지적을 반영했다.
  - P1: 연결이 끊긴 작성자는 bunches SELECT 정책에 막혀 행을 잠글 수 없다.
  - P1: 취소와 제외의 잠금 순서가 반대라 교착이 생긴다.
  - P2: 목표 삭제와의 경합.
  - P2: 마이그레이션 중 실행되던 구버전 함수가 보정값을 덮어쓸 수 있다.
  - 대응: 증감 방식과 RLS 정책 추가안을 버리고, 전용 집계 역할과 헬퍼 2개로 바꿨다.
- 브리프 리뷰 r2 (2026-10-16, Codex read-only) 지적을 반영했다.
  - P1: 새 역할에 `private` 스키마 USAGE가 없다.
  - P2: 삭제 검사가 replay 판정보다 뒤에 있다.
- 구현 리뷰 r1 (2026-10-16, Claude): **BLOCKED**
  - 실행: Docker 29.1.3에서 `db:migrate`로 `20261008025100`까지 적용했다. `db:test`는 실패했다. 016을 psql로 직접 돌려 확인한 결과는 아래와 같다.
  1. BLOCKED `supabase/migrations/20261008025100_shared_count_and_sender_cancel.sql`(헬퍼 2개의 revoke·grant)
     - 문제: 헬퍼 실행 권한의 revoke·grant가 적용되지 않았다.
     - 근거: 적용 후 실제 ACL이 `private.lock_praise_cycle`·`private.recount_bunch` 모두 `{=X/chagokchan_counter,chagokchan_counter=X/chagokchan_counter}`다. 즉 PUBLIC이 실행할 수 있고 `chagokchan_rpc`는 실행할 수 없다.
     - 원인: Supabase의 `postgres`는 슈퍼유저가 아니어서, 다른 역할이 소유한 함수에 대한 grant·revoke가 경고만 남기고 무시된다. 기존 패턴(`20261008020700:15,21`, `20261008023300:9`)은 `set local role <소유자>;`로 바꾼 뒤 grant·revoke를 하고 `reset role;`로 돌아온다.
     - 기대: 소유권을 옮긴 뒤 `set local role chagokchan_counter;`, `revoke all … from public, anon, authenticated, service_role; grant execute … to chagokchan_rpc;`, `reset role;` 순서로 실행한다.
     - 영향: PUBLIC이 헬퍼를 직접 부를 수 있고, `cancel_praise`·`create_peer_praise`는 권한 오류로 실패한다.
  2. WARNING `supabase/tests/016_business_rpc_shared_count_and_sender_cancel.test.sql:10-12`
     - 문제: "counter has no memberships in either direction"이 실패한다.
     - 근거: Supabase가 새 역할을 만들면 `supabase_admin` 명의로 `postgres → 역할` 멤버십을 자동으로 만든다. 기존 `chagokchan_session_reader`·`chagokchan_worker`도 같은 상태다. 마이그레이션 끝의 `revoke chagokchan_counter from postgres`는 grantor가 달라 효과가 없다.
     - 기대: counter가 다른 역할의 멤버가 아님(counter → 다른 역할 0건)과 API 역할(anon·authenticated·service_role·chagokchan_rpc)이 counter의 멤버가 아님을 검사한다. postgres 멤버십은 기존 역할과 같은 플랫폼 기본값으로 허용하고 주석을 단다.
  3. BLOCKED `016` 실행 오류
     - 문제: `ERROR: function is(jsonb, jsonb, unknown) does not exist`로 스크립트가 중단된다.
     - 기대: jsonb 비교는 `is(…::text, …::text, …)`처럼 pgTAP이 지원하는 타입으로 맞춘다. 수정 후 39개 assertion이 모두 실행되게 한다.
  - 처리 방법: `20261008025100`은 커밋하지 않았고 폐기 가능한 로컬 DB에만 적용됐다. 그래서 같은 파일을 고친다. 재검증 때 Claude가 로컬 DB를 초기화하고 시드를 다시 넣은 뒤 적용한다.
- 구현 리뷰 r2 (2026-10-16, Claude) — 판정: **BLOCKED**(테스트 1건)
  - 처리: 로컬 DB를 초기화하고(`supabase db reset --local --no-seed`, 기존 fixture 매니페스트는 스크래치패드로 백업) loopback 바인딩으로 다시 띄운 뒤 시드를 넣었다. 마이그레이션 48개를 처음부터 적용했다.
  - 확인: 헬퍼 ACL이 `{chagokchan_counter=X, chagokchan_rpc=X}`다. `authenticated`는 실행할 수 없고, counter는 `require_actor`를 실행할 수 있다. 001~015 pgTAP은 모두 통과했다.
  1. BLOCKED `supabase/tests/016_business_rpc_shared_count_and_sender_cancel.test.sql`
     - 문제: 36개 통과 후 `ERROR: function is(text, text, unknown) does not exist`로 중단된다.
     - 원인: `set local role authenticated` 블록 안에서 pgTAP `is()`·`ok()`·`throws_ok()`를 부른다. `authenticated`는 `extensions` 스키마 usage가 없어 pgTAP 함수를 찾지 못한다.
     - 기대: 역할을 바꾼 블록 안에서는 RPC 결과만 `\gset` 변수에 담는다. `reset role` 뒤에 단언한다. 예외를 기대하는 경우는 `reset role` 뒤 `throws_ok(format('set local role authenticated; select …'))` 대신 SECURITY DEFINER RPC를 claims만으로 호출하는 기존 015 방식(역할 전환 없이 `request.jwt.claims`)을 쓰거나, `DO` 블록에서 예외를 잡아 결과를 변수에 담는다. `plan(39)`의 39개가 모두 실행돼야 한다.
- 구현 리뷰 r3 (2026-10-16, Claude) — 판정: **APPROVED**. 016이 39/39로 끝까지 실행된다. Claude 재검증(2026-10-16, Docker 29.1.3, Node 24.19.0): 로컬 DB를 초기화(fixture 매니페스트 백업)한 뒤 loopback으로 다시 띄우고 시드를 넣었다. 마이그레이션 48개를 처음부터 적용했고, 헬퍼 ACL은 chagokchan_rpc만 실행 가능하다. pgTAP 336/336(016 39/39), db:shared·praise·praise-result·connection·lifecycle·deletion 통과, api:board-test A/B/C 각 14/14, api:praise-tag-test 통과, lint·typecheck·unit 126/126·build:check 통과. 초기화 직후 Auth 기동 중에 돌린 첫 회차에서는 db:praise-test·db:deletion-test가 실패했고, 다시 돌리자 같은 순서로 전부 통과했다.
