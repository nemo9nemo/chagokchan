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
| W07~W11 | TODO | 서버 API·로컬 사용자 해석·개인/공유 기능·삭제·테마/접근성/PWA |
| W12/W13 | DEFERRED | 오픈 준비 시 실제 로그인 구현·검증 |
| W14/W15 | TODO | 운영 입력·별도 스테이징·통합/보안/복원/부하 |
| W16-A/W16-B | DONE | 기능별 로컬 커밋·원격 이력 업로드 |
| W16-C | TODO | CI·브랜치 보호 |
| W17 | TODO | 공개 배포·관찰 |

앱에는 준비 화면만 있다. 업무 UI·BFF API는 미구현이다. 제품 수락 TC 36개는 실행 완료 0개다. W06-A/B/C1/C2 기술 TC 15개가 통과했다. 전체 DB 검사 161/161은 물리 51, 세션·참조 경계 21, 업무 RPC 권한/RLS 89개다. RPC 회귀 110/110, 연결 통합 13/13, 공유판 통합 6/6, 발급 로컬 세션 목표 12/12·개인 칭찬 12/12·A/B/C 세션 27/27이 통과했다. 실제 Google/OTP 로그인은 검증하지 않았다.

## 현재 런타임과 DB

Node `24.19.0`, pnpm `11.19.0`, Next `16.4.0`, React `19.3.0`, TypeScript `5.9.3`, Biome `2.5.15`, Supabase CLI `2.120.0`, SDK `2.117.3`를 고정했다. PATH 기본 Node는 `22.14.0`이라 그대로 쓰면 환경 검사가 실패한다. 저장소의 `scripts/project.ps1 -Task ...`가 고정 Node를 선택한다. [환경 실행 방법](runtime-setup.md)을 따른다.

Docker 엔진 `29.1.3`, 실제 로컬 PostgreSQL `17.11`이다. 프로젝트 서비스 7개를 사용한다. DB 컨테이너는 `supabase_db_chagokchan`, API 게이트웨이는 `supabase_kong_chagokchan`이다. API 54321·DB 54322·Studio 54323·메일함 54324는 127.0.0.1에 바인딩한다. 프로젝트의 loopback 프록시를 포함한 `db:start` 실행 경로를 유지한다.

적용 완료 SQL은 `20261008013000_product_schema.sql`, W06-A `20261008020500`~`20261008020900`, W06-B1 `20261008021000`~`20261008021300`, W06-B2 `20261008021400`~`20261008021700`, W06-C1 `20261008021800`~`20261008022100`, W06-C2 `20261008022200`~`20261008022900`, C1 페이지 보완 `20261008023000`, W06-D1 `20261008023100`~`20261008023400`, W06-D2 `20261008023500`~`20261008024200`이다. **적용한 SQL은 수정하지 않는다.** Auth 테이블은 Supabase 관리 영역이고 스키마 변경은 하지 않는다. 기존 합성 계정·앱 데이터를 자동으로 초기화하거나 삭제 작업 중인 계정을 재활성화하지 않는다.

`.env.development.local`, `private-data/local-fixtures.json`은 현재 폴더에 존재하며 Git에서 제외한다. 인증 값은 읽어 출력하거나 문서·로그에 기록하지 않는다. 로컬 fixture 파일은 현재 사용자와 SYSTEM만 접근하도록 제한했다. `db:seed`는 명시적으로 준비하며 재실행 시 기존 제품 데이터를 덮어쓰지 않는다. 서버 실행·빌드에서 자동 seed를 하지 않는다.

원격 첫 업로드는 GitHub CLI의 기존 인증을 프로세스 한정 credential helper로 사용했다. 글로벌 Git 설정은 바꾸지 않았다. 후속 push가 로컬 인증 설정 때문에 실패하면 `gh auth status`로 상태를 확인하고 토큰을 출력하지 않는 GitHub CLI credential helper를 사용한다. 강제 push로 원격 이력을 덮어쓰지 않는다.

## W06-A~W06-D2 완료와 다음 작업

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

Auth 관리 테이블은 RLS가 켜져 있고 앱 정책이 없다. 그 때문에 전용 reader만 `BYPASSRLS`를 가지며 조회 가능한 Auth 열을 제한했다. 이 역할은 `NOLOGIN`, 제품 테이블 권한 없음, API 역할이 assume 불가이고, 고정 `search_path`를 가진 세션 검사 함수만 소유한다. 결정 근거와 제한은 [ADR-0005](../decisions/ADR-0005-local-auth-session-reader.md)에 있다. 일반 get_me 호출은 publishable key와 실제 발급된 사용자 세션을 사용한다. 관리 API 키는 검사용 임시 계정 생성·삭제에만 쓴다.

1. W06 전체 DB 213/213·RPC 162/162, W06-D1 발급 세션 통합 4/4·W06-D2 발급 세션/Auth Admin 통합 6/6을 통과했다. 기존 fixture 보존·probe 계정/세션 정리도 통과했다. 실제 Google/OTP 로그인과 BFF/API는 실행하지 않았다.
2. W07에서 로컬 사용자 해석기·BFF API를 구현한다. 실제 Google/OTP 로그인은 오픈 준비 W12/W13까지 미룬다.
3. `OPS-INPUT-02` 독립 삭제 원장 저장소는 미설정이다. 이를 구성하기 전 스테이징/운영 purge 및 계정 erasure worker gate는 닫아 둔다.

## 프로젝트에서 사용할 재개 메시지

```text
차곡찬 개발을 이어서 진행해. AGENTS.md와 docs/development/codex-project-handoff.md, 진행표·등록부를 읽고 W06부터 재개해. 개발 중 로그인 화면 없이 이용하고 실제 로그인은 오픈 준비 때 적용한다. 기능별 검증·문서·상태 갱신·작업과 이유가 드러나는 커밋을 함께 진행하고 원격에 반영해.
```
