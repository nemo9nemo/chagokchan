# 차곡찬 프로젝트 개발 인계

기준일: 2026-10-08. 사용자가 Git 연결 후 Codex의 프로젝트에서 남은 작업을 이어가기로 했다. 이 문서는 확인한 상태와 다음 절차를 보존한다. 실제 작업 상태의 기준은 [진행표](backlog.md)이며 이후 완료 때 함께 갱신한다.

## 작업 공간과 원격

- 프로젝트 폴더: `C:\Users\love0\nemo9Dev\chagokchan`
- GitHub: [nemo9nemo/chagokchan](https://github.com/nemo9nemo/chagokchan), 공개(public)
- 로컬 기본 브랜치: `main`, 원격: `origin`, 업스트림: `origin/main`
- 인계 작성 전 검증된 로컬·원격 HEAD: `229056f66a1534e479584b626af6e4bcff783076`
- 원격 연결·이력 보존·업스트림·비밀 제외 검사는 [연결 증거](../quality/reports/git-remote-connection-2026-10-08.json)에 기록했다. 이 문서의 커밋도 별도로 업로드한다.
- CI·브랜치 보호·클라우드 서비스·공개 배포는 미설정이다.

2026-10-08 조회 시 이 폴더는 Codex의 저장된 프로젝트 목록에 없었다. 현재 도구에는 로컬 프로젝트 등록과 이 대화의 작업 경로 변경 기능이 없다. 앱에서 로컬 프로젝트를 추가하고 위 폴더를 기본 폴더로 지정한 뒤 프로젝트 대화에서 이어간다. 프로젝트·대화의 이동 완료로 기록하지 않는다. 폴더가 준비되어 있으므로 해당 폴더를 그대로 사용한다.

프로젝트의 기본 폴더가 새 대화의 작업 경로와 Git·AGENTS.md 탐색 기준이 된다는 설명은 [OpenAI 공식 문서](https://learn.chatgpt.com/docs/projects#use-local-projects-for-folders-and-codebases)를 확인했다. 현재 대화의 기록된 작업 경로는 `C:\Users\love0\Documents\Codex\2026-10-07\new-chat`이다. 이 이전 폴더는 임시 작업 도구에만 사용했다.

## 새 프로젝트 대화에서 읽을 순서

1. [작업 규칙](../../AGENTS.md)
2. 이 인계 문서와 [진행표](backlog.md), [등록부](artifact-register.json)
3. [요구사항](../requirements/mvp-requirements.md), [제품 정책](../../policies/app-policy.json), [개발 정책](../../policies/development-policy.json)
4. [ERD](../data-erd.md), [API 계약](../../contracts/openapi.json), [물리 DB 실행 방법](database-foundation.md)
5. [기능 단위 커밋 규칙](git-workflow.md), [검증 계획](../quality/verification-plan.md)

한국어로 소통하고 이미 정한 요구를 유지한다. 성인 개인 사용자 중심, 만 19세 이상 자기 확인, 목표별 개인판과 선택 공유판의 독립 집계, 연결과 판 권한의 분리가 기준이다. 지인이 내 목표의 공유판에 칭찬을 준다. 차곡찬/Chagokchan은 포도 표현 테마와 독립적이며 테마 교체로 기록·개수·권한을 변경하지 않는다.

개발 중 사용자는 로그인 화면 없이 이용한다. 서버가 준비하는 로컬 A/B/C의 실제 Auth 세션으로 같은 RPC·RLS를 검사한다. JWT를 만들거나 일반 요청에 service role을 사용해 권한을 우회하지 않는다. 실제 Google·이메일 OTP 연동과 제공자 로그인·실사용 검사는 W12/W13, 오픈 준비 시점에 진행하며 공개 전 필수다. 로컬 세션 검사로 실제 로그인 완료를 대체하지 않는다.

## 확인한 완료 범위

| 작업 | 상태 | 근거 |
| --- | --- | --- |
| W00~W03 | DONE | 작업 공간 이전·요구·정책·논리 설계·개발 무로그인 정책 |
| W04 | DONE | 앱 기반·로컬 DB·소스 27개·빌드·loopback HTTP. [증거](../quality/reports/foundation-check-2026-10-08.json) |
| W05 | DONE | 18테이블·38FK·68인덱스·RLS·합성 A/B/C. 물리 DB 51개·소스 단위 32개·빌드. [증거](../quality/reports/physical-database-check-2026-10-08.json) |
| W06 | DONE | **W06-A~D2 완료**. 전체 DB 213/213·RPC 162/162, D1 세션 통합 4/4·D2 세션/Auth Admin 통합 6/6. 외부 원장·BFF/API·실제 로그인·제품 수락은 미완료. [D1 증거](../quality/reports/w06-d1-news-and-purge-check-2026-10-08.json), [D2 증거](../quality/reports/w06-d2-account-deletion-check-2026-10-08.json) |
| W07 | DONE | local Auth session·GET /me·CSRF/Origin/JSON/32KB guard 기반 구현. A/B/C 통합·보안 단위·배포 빌드 경계 검사 완료 |
| W08 | DONE | W08-A/B1/B2/C API와 W08-D 기본 UI 완료. unit 82/82·build-check·조회 전용 브라우저 smoke 통과. 실제 UI mutation submit E2E·제품 수락은 미실행으로 남김. [W08-D 증거](../quality/reports/w08-d-goal-record-ui-check-2026-10-08.json) |
| W09 | IN_PROGRESS | W09-A 연결 API와 W09-B 공유 권한/칭찬 API를 완료했다. 연결·공유 UI06~UI08은 W09-C에 남았다. 다음 W10 소식/삭제, W11 테마/접근성/PWA |
| W12/W13 | DEFERRED | 오픈 준비 시 실제 로그인 구현·검증 |
| W14/W15 | TODO | 운영 입력·별도 스테이징·통합/보안/복원/부하 |
| W16-A/W16-B | DONE | 기능별 로컬 커밋·원격 이력 업로드 |
| W16-C | TODO | CI·브랜치 보호 |
| W17 | TODO | 공개 배포·관찰 |

화면은 준비 화면이다. W07-A/B에서 GET /api/v1/me, 개발용 GET /api/v1/auth/csrf와 변경 요청 guard 기반을 구현했고, W08-A에서 목표 생성·상세·설명 수정 API를 연결했다. W08-A는 unit 8/8, A/B/C 비파괴 API 각 3/3, 전체 check 61/61, build:check 통과다. 실제 mutation의 route→DB 성공 통합 검사는 아직 하지 않았고 기존 DB RPC 검증은 W06 결과를 유지한다. 배포 CSRF flow/session binding 및 실제 Google/OTP 로그인은 W12/W13에서 검증한다. 36개 제품 수락 TC는 계속 미실행이다.

## 현재 런타임과 DB

Node `24.19.0`, pnpm `11.19.0`, Next `16.4.0`, React `19.3.0`, TypeScript `5.9.3`, Biome `2.5.15`, Supabase CLI `2.120.0`, SDK `2.117.3`를 고정했다. PATH 기본 Node는 `22.14.0`이라 그대로 쓰면 환경 검사가 실패한다. 저장소의 `scripts/project.ps1 -Task ...`가 고정 Node를 선택한다. [환경 실행 방법](runtime-setup.md)을 따른다.

Docker 엔진 `29.1.3`, 실제 로컬 PostgreSQL `17.11`이다. 프로젝트 서비스 7개를 사용한다. DB 컨테이너는 `supabase_db_chagokchan`, API 게이트웨이는 `supabase_kong_chagokchan`이다. API 54321·DB 54322·Studio 54323·메일함 54324는 127.0.0.1에 바인딩한다. 프로젝트의 loopback 프록시를 포함한 `db:start` 실행 경로를 유지한다.

적용 완료 SQL은 `20261008013000_product_schema.sql`, W06-A `20261008020500`~`20261008020900`, W06-B1 `20261008021000`~`20261008021300`, W06-B2 `20261008021400`~`20261008021700`, W06-C1 `20261008021800`~`20261008022100`, W06-C2 `20261008022200`~`20261008022900`, C1 페이지 보완 `20261008023000`, W06-D1 `20261008023100`~`20261008023400`, W06-D2 `20261008023500`~`20261008024200`, W08 API 보완 `20261008024300`~`20261008024600`, W09-B peer moderation `20261008024700`이다. **적용한 SQL은 수정하지 않는다.** Auth 테이블은 Supabase 관리 영역이고 스키마 변경은 하지 않는다. 기존 합성 계정·앱 데이터를 자동으로 초기화하거나 삭제 작업 중인 계정을 재활성화하지 않는다.

`.env.development.local`, `private-data/local-fixtures.json`은 현재 폴더에 존재하며 Git에서 제외한다. 인증 값은 읽어 출력하거나 문서·로그에 기록하지 않는다. 로컬 fixture 파일은 현재 사용자와 SYSTEM만 접근하도록 제한했다. `db:seed`는 명시적으로 준비하며 재실행 시 기존 제품 데이터를 덮어쓰지 않는다. 서버 실행·빌드에서 자동 seed를 하지 않는다.

원격 첫 업로드는 GitHub CLI의 기존 인증을 프로세스 한정 credential helper로 사용했다. 글로벌 Git 설정은 바꾸지 않았다. 후속 push가 로컬 인증 설정 때문에 실패하면 `gh auth status`로 상태를 확인하고 토큰을 출력하지 않는 GitHub CLI credential helper를 사용한다. 강제 push로 원격 이력을 덮어쓰지 않는다.

## W06-A~W06-D2와 W07-A/B 완료 범위

`tmp/w06-draft/source/`와 `tmp/w06-draft/manifest.json`은 초안 복사 당시 상태를 보존하는 Git 제외 자료다. manifest의 `draft_unapplied_untested`는 복사 당시 사실이며 현재 적용 상태가 아니다. 기능 소스는 저장소의 정식 경로에서 후속 검토·수정했다.

| 초안에서 시작한 정식 산출물 | 현재 상태 |
| --- | --- |
| `supabase/migrations/20261008020500_session_rpc_boundary.sql` | 적용. NOLOGIN 역할·현재 Auth 세션/앱 계정 확인·본인 get_me·참조 종류/정체성 트리거 |
| `supabase/migrations/20261008020600_grant_auth_schema_usage.sql` | 적용 이력 보존. 프로젝트 마이그레이션 역할은 관리 `auth` 스키마 사용 권한을 부여할 수 없어 실효 권한을 만들지 못했음 |
| `supabase/migrations/20261008020700_isolate_auth_session_reader.sql` | 적용. Auth 메타데이터 전용 비로그인 역할과 고정 경로 세션 함수 추가 |
| `supabase/migrations/20261008020800_revoke_auth_columns_from_guard.sql` | 적용. 앱 상태 guard의 불필요한 Auth 열 권한 회수 |
| `supabase/migrations/20261008020900_revoke_auth_schema_from_guard.sql` | 적용. 다른 마이그레이션 소유권 구성에서도 앱 상태 guard가 Auth 스키마에 접근하지 않도록 회수 |
| `supabase/tests/001_physical_integrity.test.sql`, `supabase/tests/002_rpc_boundary.test.sql` | 물리 회귀 51/51·W06-A 경계 21/21 통과 |
| `scripts/test-local-rpc.mjs` | Auth가 발급한 A/B/C 세션, 최소 본인 응답, 직접 접근/세션 폐기/계정 상태, 관리 스키마 비노출과 정리 27/27 통과 |
| `supabase/migrations/20261008021000_goal_rpc.sql`~`20261008021300_receipt_retry_lock_privilege.sql` | 적용. 목표·개인판·명시 공유 프로필 원자 생성, 상세 조회, revision 수정·완료/보관/재개, 중복 영수증·사용자별 상한 경합 |
| `supabase/tests/003_business_rpc.test.sql`·`scripts/test-local-goal-rpc.mjs` | 권한/RLS 18/18·실제 발급 소유자/타인 세션 목표 통합·10개 중복 병렬·20개 상한 경합 12/12. 앱 fixture 보존·probe 계정/세션 정리 |
| `supabase/migrations/20261008021400_personal_praise_cycle_rpcs.sql`~`20261008021700_notification_conflict_select_policy.sql` | 적용. 개인 칭찬·메모 수정/취소·회차 snapshot·집계·완성 알림·쿼터와 ON CONFLICT 충돌 키에 필요한 수신자 한정 SELECT RLS. 앞서 적용된 migration은 수정하지 않음 |
| `supabase/tests/004_business_rpc_praise.test.sql`·`scripts/test-local-personal-praise.mjs` | 업무 RPC 권한/RLS 26/26·실제 Auth 발급 소유자/타인 세션 통합 12/12. 회차 경계 병렬 부여·20/분·300/일·실패 롤백·fixture 보존·계정/세션 정리 |
| `supabase/migrations/20261008021800_connection_invite_request_rpcs.sql`~`20261008022100_acceptance_notification_target.sql` | 적용. 해시형 링크/코드 초대·미리보기·요청 멱등성·승인/거절/취소·연결 세대·해제·차단/해제와 200 연결 상한을 구현. 미적용 파일을 수정한 것이 아니라 후속 219/220/221을 순서 적용 |
| `supabase/tests/005_business_rpc_connections.test.sql`·`scripts/test-local-connection-rpc.mjs` | 관계 RPC 권한/RLS 19/19·실제 Auth 발급 세션 통합 13/13. 일회 초대 소비·역방향/동일 초대 병렬 요청·상한 200 경합·블록·재연결·기존 fixture 보존·합성 계정/세션 정리 |
| C1 페이지 보완 `supabase/migrations/20261008023000_connection_list_cursor_boundary_fix.sql` | 네 관계 목록이 lookahead 행을 건너뛰지 않고 마지막 반환 행 뒤부터 이어지도록 고쳤다. pgTAP 20/20·전체 DB 161/161·RPC 110/110·실제 Auth 발급 세션 통합 13/13. 1/50행 페이지 탐색에서 초대·요청·연결·차단 ID의 중복/누락 없음. [증거](../quality/reports/w06-c1-cursor-pagination-check-2026-10-08.json) |
| `supabase/migrations/20261008022200_shared_board_access_and_peer_praise.sql`~`supabase/migrations/20261008022900_shared_list_cursor_boundary_fix.sql` | 적용. owner grant/revoke·관계 세대 검증·역할별 safe projection·공유 칭찬/영수증/회차/알림·판/일일/분당 quota·50명 상한·revoke/disconnect/block 경합을 구현. cursor 인코딩 줄바꿈과 공유 목록 경계를 후속 migration으로 수정 |
| `supabase/tests/006_business_rpc_shared_board.test.sql`·`scripts/test-local-shared-board-rpc.mjs` | 공유판 pgTAP 25/25·실제 Auth 발급 세션 통합 6/6. grant/projection·독립 집계·멱등/롤백·상한 경합·권한 회수 경합·재연결 시 재 grant 확인, 기존 fixture 보존·probe 세션/계정 정리 |
| W06-D1 `20261008023100`~`20261008023400`, `supabase/tests/007_business_rpc_lifecycle.test.sql`, `scripts/test-local-lifecycle-rpc.mjs` | 적용. 수신자 최소 소식 목록/읽음·마지막 반환행 커서, 연결 해제 뒤 보낸 peer praise, 목표 soft-trash/복구·grant 미복원·만료 후 복구 거절, 전용 worker의 FK 순서 purge를 추가했다. DB 권한 검사 20/20·실제 발급 Auth 세션 통합 4/4, 기존 fixture 보존·probe 정리 통과. purge gate는 독립 삭제 원장이 설정될 때만 열리며 로컬 검사에서만 합성 참조를 사용했다. [증거](../quality/reports/w06-d1-news-and-purge-check-2026-10-08.json) |
| W06-D2 `20261008023500`~`20261008024200`, `supabase/tests/008_business_rpc_account_deletion.test.sql`, `scripts/test-local-account-deletion.mjs` | 적용. 현재 발급 세션의 10분 reauth를 한번 소비하고 deleting/요청을 원자 처리한다. worker는 원장 reference로 재시도를 고정하며 작성자 탈퇴에서 다른 판의 유효 칭찬 이벤트를 보존하고 actor·본문·날짜·receipt 입력을 제거한다. 수신자 탈퇴는 목표/받은 칭찬/소식/연결/프로필을 정리한다. DB pgTAP 32/32·발급 Auth 세션/Auth Admin 통합 6/6, 강제 실패 전체 rollback·Auth 삭제 checkpoint 재시도·UUID 재가입 차단·기존 fixture 보존 통과. 외부 원장 미설정으로 gate는 기본 차단, 로컬에서만 합성 reference로 동작을 검증했다. [증거](../quality/reports/w06-d2-account-deletion-check-2026-10-08.json) |
| W07-A `src/server/local-user-session.mjs`, `src/app/api/v1/me/route.ts`, `scripts/test-local-me-api.mjs` | 구현. 서버 환경 actor만 허용하고 private fixture로 실제 Auth 세션을 발급·검증한 뒤 `get_me` RPC/RLS를 호출한다. OpenAPI Me allowlist·no-store·request ID를 적용하고 client actor/Authorization 입력은 무시한다. local API integration은 A/B/C 각각 5개 확인 통과. [증거](../quality/reports/w07-a-local-me-api-check-2026-10-08.json) |
| W07-B `src/server/api-security.mjs`, `src/app/api/v1/auth/csrf/route.ts`, `scripts/api-security.test.mjs` | 구현. 로컬 전용 signed CSRF 이중 제출과 HttpOnly/SameSite 쿠키 발급, Origin·Fetch Metadata·JSON object·실제 32KB body guard를 제공한다. deployed mode는 CSRF secret 32바이트 이상을 요구하고 local manifest/key를 거절한다. 보안 unit 14/14·A/B/C CSRF API 확인 통과. 배포 session-bound flow는 W12로 유예. [증거](../quality/reports/w07-b-api-security-check-2026-10-08.json) |
| W08-A `src/server/goal-api.mjs`, `src/app/api/v1/goals/`, `scripts/goal-api.test.mjs`, `scripts/test-local-goal-api.mjs` | 구현. create/get/update goal RPC 연결, 입력·응답 allowlist, 멱등 키·CSRF·no-store를 적용했다. 단위 8/8, 실제 A/B/C 세션으로 비소유 404·malformed ID·CSRF 거절 각 3/3. API handler의 실제 성공 DB 쓰기/수정은 미실행이며 검사 중 DB 쓰기가 없었다. [증거](../quality/reports/w08-a-goal-api-check-2026-10-08.json) |

당시 인계의 다음 작업은 W08-B2였으며 현재 W08-B2는 완료됐다. 이어서 진행표의 W08-C 개인 칭찬 생성·수정·취소 및 회차 API를 구현한다. 새 변경 route는 `validateMutationRequest`를 업무 검증 전에 사용한다. 배포 session-bound auth/CSRF flow는 사용자 결정에 따라 W12에서 진행한다.

Auth 관리 테이블은 RLS가 켜져 있고 앱 정책이 없다. 그 때문에 전용 reader만 `BYPASSRLS`를 가지며 조회 가능한 Auth 열을 제한했다. 이 역할은 `NOLOGIN`, 제품 테이블 권한 없음, API 역할이 assume 불가이고, 고정 `search_path`를 가진 세션 검사 함수만 소유한다. 결정 근거와 제한은 [ADR-0005](../decisions/ADR-0005-local-auth-session-reader.md)에 있다. 일반 get_me 호출은 publishable key와 실제 발급된 사용자 세션을 사용한다. 관리 API 키는 검사용 임시 계정 생성·삭제에만 쓴다.

1. W06 전체 DB 213/213·RPC 162/162, W06-D1 발급 세션 통합 4/4·W06-D2 발급 세션/Auth Admin 통합 6/6을 통과했다. 기존 fixture 보존·probe 계정/세션 정리도 통과했다. 실제 Google/OTP 로그인과 BFF/API는 실행하지 않았다.
2. W07-A/B 기반과 W08-A/B1/B2 목표 생성·조회·수정·상태·판·회차 API를 구현했다. 다음은 W08-C 개인 칭찬 API와 W08-D 화면이며 실제 Google/OTP 로그인을 W12/W13까지 미룬다.
3. `OPS-INPUT-02` 독립 삭제 원장 저장소는 미설정이다. 이를 구성하기 전 스테이징/운영 purge 및 계정 erasure worker gate는 닫아 둔다.

## 프로젝트에서 사용할 재개 메시지

## 2026-10-08 이어서 진행한 W08

기존 W08 인계 초안은 당시 W08-A까지만 실제 완료라고 구분했으며, 미적용 W06 초안은 적용 이력으로 간주하지 않았다. 이번 작업은 새 순서형 목표 목록인 W08-B1을 추가로 구현했다. 마이그레이션 `20261008024300`을 로컬 DB에 적용한 뒤 PostgreSQL base64 줄바꿈 문제를 발견해 적용 SQL은 수정하지 않고 후속 `20261008024400`으로 cursor 인코딩을 보완했다.

`list_goals`는 실제 Auth 세션의 소유자만 볼 수 있고 삭제되지 않은 목표 요약 allowlist만 반환한다. 기본 20·최대 50개, created_at/ID 역순 keyset 페이지, status 필터에 묶인 cursor를 사용한다. GET `/api/v1/goals`와 OpenAPI·TC-API-004를 연결하고 전체 DB 222/222, RPC 경계/업무 171/171, `009_business_rpc_goal_list.test.sql` 9/9, 실제 로컬 Auth 세션 페이지/권한 통합 5/5, A/B/C API 각 3/3을 통과했다. 전체 unit/build/산출물 확인도 커밋 시점에 기록한다. 검사는 synthetic probe를 사용하고 기존 fixture 데이터는 보존했다. [W08-B1 검사 증거](../quality/reports/w08-b1-goal-list-check-2026-10-08.json)

해당 W08-B1 시점에는 W08-B2·W08-C·W08-D가 남아 있었다. 목표 상태 전이·판 설정·회차 API를 추가한 현재 결과는 아래 후속 기록을 따른다.

## W08-B2 후속 완료 기록

`20261008024500_bunch_list_rpc.sql`을 순서대로 로컬 DB에 적용했다. `list_bunches`는 본인 판 또는 현재 유효한 공유판 구성원에게만 판 소속 회차 요약을 반환하며, cycle_no/ID keyset cursor는 board ID에 결합된다. cursor 형식 오류·다른 판 cursor·직접 table read를 거절한다. 적용 migration은 수정하지 않는다.

완료·보관·재개 POST, 판 설정 PATCH, 회차 목록 GET route를 기존 `complete_goal`/`archive_goal`/`resume_goal`/`update_board`와 새 `list_bunches` RPC에 연결했다. pgTAP 9/9·전체 DB 231/231·RPC 180/180·실제 Auth 세션 lifecycle/history 통합 6/6·A/B/C API 각 8/8·unit 69/69·build:check가 통과했다. probe 사용자/세션 정리 및 기존 fixture 데이터 보존을 확인했다. 최종 `check`와 소스 해시는 [검사 증거](../quality/reports/w08-b2-goal-lifecycle-api-check-2026-10-08.json)에 기록한다.

당시 W08-A/B1/B2가 완료됐고 W08-C 개인 칭찬 API와 W08-D 화면이 남아 있었다. 이후 결과는 아래 W08-C/D 후속 기록을 따른다. 실제 Google/OTP 로그인과 제품 수락 TC는 별도 단계에 둔다.

## W08-C 후속 완료 기록

칭찬 API는 GET/POST `/api/v1/boards/{board_id}/praises`, PATCH `/api/v1/praises/{praise_id}`, POST `/api/v1/praises/{praise_id}/cancel`이다. 요청은 공통 CSRF/Origin/JSON 검사를 먼저 거치고 개인 메모·실천일 입력 및 응답 allowlist를 적용한다. 조회는 owner/contributor projection을 구분해 개인정보와 moderation state를 한정한다. 개인판 생성·수정·취소는 기존 업무 RPC를 사용하며 shared peer create·hide·unhide·exclude는 W09 범위로 둔다.

기존 `create_praise`가 id/replayed만 반환해 API 계약의 bunch_id를 채우지 못하므로 기존 적용 migration을 수정하지 않고 `20261008024600_personal_praise_result_rpc.sql`에 wrapper를 추가했다. 기존 트랜잭션을 호출한 뒤 같은 인증 actor·board·self praise 행에서 정확한 bunch_id를 조회해 응답한다. 새 pgTAP 6/6·전체 DB 237/237·RPC 186/186, 실제 Auth session probe 3/3, A/B/C API 각 10/10, unit 79/79, build:check 통과. probe 계정·세션 정리와 기존 fixture 보존을 확인했다. 세부 명령·source hashes는 [W08-C 검사 증거](../quality/reports/w08-c-personal-praise-api-check-2026-10-08.json)에 있다.

이 문단은 W08-C 완료 당시의 다음 작업 기록이다. 이후 W08-D 기본 화면은 아래 후속 기록을 따른다. 공유 칭찬 생성 및 숨김/제외 UI는 W09가 연결될 때 진행한다.

## W08-D 목표·개인 기록 기본 UI 후속 기록

UI02~UI05 기본 화면을 `src/app/client-app.tsx`에 구현했다. 목표 목록·생성·설명 수정, 개인/공유판 회차 목표 설정, 완료·보관·재개, 현재/과거 회차 조회, 개인 칭찬 생성·수정·취소, 받은 공유 칭찬 읽기를 서버 API에 연결했다. 개인/공유판의 개수와 기록은 화면에서도 분리한다. 공유 칭찬 생성·숨김·제외 UI는 W09 이후다.

응답 성공 전에 진행 개수를 바꾸지 않는다. 네트워크/서버에서 결과를 확인할 수 없으면 입력 본문과 Idempotency-Key를 보존해 같은 요청으로 재확인한다. 첫 회차가 아직 생성되지 않은 목표도 개인 칭찬을 입력할 수 있도록 폼을 노출하고, 첫 성공 뒤 서버가 반환한 bunch ID로 새 회차를 읽는다. 로컬 Auth A 세션 브라우저 smoke에서 목표 목록·상세·회차/기록 조회, 개인/받은 칭찬 전환, 빈 회차 폼, 선택 공유판 입력, 목표 설정 폼을 확인했다. 제품 fixture 변경 제출은 수행하지 않았다.

`check`의 unit 82/82, Biome, typecheck, 정적 산출물 검사 및 `build:check`가 통과했다. `TC-UI-003`은 읽기 전용 화면 smoke 범위로만 통과 처리한다. 실제 UI submit→성공 화면·네트워크 불확실 재시도 E2E, 제품 수락·기기/접근성 검사는 미실행이다. 성공 submit 경계는 W08-C 실제 Auth/RPC 검사, 재사용 멱등 키는 W08-D unit 검사로 별도 근거가 있다. [W08-D 검사 증거](../quality/reports/w08-d-goal-record-ui-check-2026-10-08.json)

다음 작업은 W09 연결·판 권한·공유 칭찬이다. 실제 UI mutation submit E2E, 제품 수락 TC, 기기/접근성 검사는 W08-D 읽기 smoke의 근거에 포함하지 않았다.

## W09-A 연결·초대·요청·차단 API 후속 완료 기록

14개 HTTP method endpoint를 기존 W06-C1 Auth-scoped RPC에 연결했다: 본인의 연결·초대·요청·차단 목록, 일회 초대 발급/미리보기/폐기, 초대 요청 생성/수락/거절/철회, 연결 해제, 차단/해제. 목록은 최소 프로필·상태 필드만 allowlist하고, 초대 비밀은 1회 발급 응답에만 반환한다. mutation은 동일 출처·CSRF·JSON 본문 guard 뒤 고정 RPC 인자를 전달한다. 연결 수락은 공유판 권한 부여를 자동으로 만들지 않는다.

`scripts/connection-api.test.mjs` unit 8/8과 `scripts/project.ps1 -Task api:connection-test` A/B/C 각각 12/12가 통과했다. API smoke는 목록 읽기, cursor/query 검증, no-CSRF 차단, malformed 초대/요청/차단 입력, 임의 연결 404/no-store를 확인했으며 제품 fixture 쓰기 0건이다. 관계 RPC의 실제 Auth session 13/13 근거는 W06-C1 보고서를 따른다. 유효 초대 발급·소비/수락을 통한 route→DB 성공 검증은 제품 fixture를 보존하기 위해 실행하지 않았다. 전체 check/build와 SHA-256 source 근거는 [W09-A 검사 증거](../quality/reports/w09-a-connection-api-check-2026-10-08.json)에서 추적한다.

W09-C 연결·공유 UI06~UI08은 남아 있다. API mutation route→DB 성공은 unit과 실제 Auth RPC 계층에서 각각 검증했으나 A/B/C route smoke에서는 기존 fixture를 쓰지 않았고, 제품 수락 TC와 기기/접근성 검사도 미실행이다.

## W09-B 공유 권한·peer 칭찬 API 완료 기록

`GET /api/v1/boards/{board_id}`와 `/members`, `PUT/DELETE /members/{user_id}`를 기존 역할별 보드·멤버 RPC에 연결했다. 판 응답은 owner와 contributor의 필드 allowlist를 분리해 contributor에게 goal ID·비공개 설명·owner 목표 설정을 반환하지 않는다. 공유판 칭찬 생성은 현재 유효한 contributor만 `create_peer_praise`로 연결하고 실천일 입력을 받지 않는다. peer 수신자의 숨김·해제·제외 route는 `hide_peer_praise`, `unhide_peer_praise`, `exclude_peer_praise`로 연결했다. 숨김은 목록 표시만 바꾸고 제외는 같은 트랜잭션에서 회차 유효 개수·완료 상태를 다시 계산한다. 마이그레이션 `20261008024700`은 적용된 SQL의 후속 마이그레이션이며 RLS recipient/peer 조건과 제한된 업데이트 필드를 둔다.

pgTAP W09-B 10/10, 전체 DB 247/247을 통과했다. 실제 Auth 발급 owner/contributor/outsider 세션 기반 공유판 검사는 7/7이며 숨김·해제·제외 재시도, 집계 감소, 부정 역할, grant 상한/연결 회수 경합을 확인했다. 합성 계정·세션 제거 후 제품 fixture와 기존 세션 수를 보존했다. 전체 unit 99/99·A/B/C route 경계 각 12/12·`build:check`도 통과했다. 로컬 API 검사와 경로→RPC unit은 제품 fixture를 변경하지 않는다. 실제 route mutation→DB 성공, 제품 수락 E2E, 실제 Google/OTP 로그인, 기기·접근성은 범위에서 제외했다. [W09-B 검사 증거](../quality/reports/w09-b-shared-board-praise-api-check-2026-10-08.json)

다음 작업은 W09-C UI06~UI08이다. W10 소식/삭제와 W11 테마/접근성/PWA는 W09-C 뒤 진행한다.

## 프로젝트에서 사용할 재개 메시지

```text
차곡찬 개발을 이어서 진행해. AGENTS.md와 docs/development/codex-project-handoff.md, 진행표·등록부를 읽고 W06부터 재개해. 개발 중 로그인 화면 없이 이용하고 실제 로그인은 오픈 준비 때 적용한다. 기능별 검증·문서·상태 갱신·작업과 이유가 드러나는 커밋을 함께 진행하고 원격에 반영해.
```
