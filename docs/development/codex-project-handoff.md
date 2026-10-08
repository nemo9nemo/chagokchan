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
| W06 | IN_PROGRESS | 세션·계정 경계와 get_me·참조/불변 조건의 초안 작성. 제품 DB 미적용·검사 미실행 |
| W07~W11 | TODO | 서버 API·로컬 사용자 해석·개인/공유 기능·삭제·테마/접근성/PWA |
| W12/W13 | DEFERRED | 오픈 준비 시 실제 로그인 구현·검증 |
| W14/W15 | TODO | 운영 입력·별도 스테이징·통합/보안/복원/부하 |
| W16-A/W16-B | DONE | 기능별 로컬 커밋·원격 이력 업로드 |
| W16-C | TODO | CI·브랜치 보호 |
| W17 | TODO | 공개 배포·관찰 |

앱에는 준비 화면만 있다. 업무 UI·BFF API는 미구현이다. 제품 수락 TC 36개는 계획 상태이며 실행 완료한 항목은 0개다. 기존 51개 DB 검사는 물리 제약·기본 직접 접근 거절 범위다.

## 현재 런타임과 DB

Node `24.19.0`, pnpm `11.19.0`, Next `16.4.0`, React `19.3.0`, TypeScript `5.9.3`, Biome `2.5.15`, Supabase CLI `2.120.0`, SDK `2.117.3`를 고정했다. PATH 기본 Node는 `22.14.0`이라 그대로 쓰면 환경 검사가 실패한다. 저장소의 `scripts/project.ps1 -Task ...`가 고정 Node를 선택한다. [환경 실행 방법](runtime-setup.md)을 따른다.

Docker 엔진 `29.1.3`, 실제 로컬 PostgreSQL `17.11`이다. 프로젝트 서비스 7개를 사용한다. DB 컨테이너는 `supabase_db_chagokchan`, API 게이트웨이는 `supabase_kong_chagokchan`이다. API 54321·DB 54322·Studio 54323·메일함 54324는 127.0.0.1에 바인딩한다. 프로젝트의 loopback 프록시를 포함한 `db:start` 실행 경로를 유지한다.

적용 완료 SQL은 `supabase/migrations/20261008013000_product_schema.sql` 하나다. **적용한 SQL은 수정하지 않는다.** Auth 테이블은 Supabase 관리 영역이다. 기존 합성 계정·앱 데이터를 자동으로 초기화하거나 삭제 작업 중인 계정을 재활성화하지 않는다.

`.env.development.local`, `private-data/local-fixtures.json`은 현재 폴더에 존재하며 Git에서 제외한다. 인증 값은 읽어 출력하거나 문서·로그에 기록하지 않는다. 로컬 fixture 파일은 현재 사용자와 SYSTEM만 접근하도록 제한했다. `db:seed`는 명시적으로 준비하며 재실행 시 기존 제품 데이터를 덮어쓰지 않는다. 서버 실행·빌드에서 자동 seed를 하지 않는다.

원격 첫 업로드는 GitHub CLI의 기존 인증을 프로세스 한정 credential helper로 사용했다. 글로벌 Git 설정은 바꾸지 않았다. 후속 push가 로컬 인증 설정 때문에 실패하면 `gh auth status`로 상태를 확인하고 토큰을 출력하지 않는 GitHub CLI credential helper를 사용한다. 강제 push로 원격 이력을 덮어쓰지 않는다.

## 보존한 W06 초안과 재개 절차

현재 컴퓨터의 프로젝트 폴더 아래 `tmp/w06-draft/source/`에 초안 4개를 복사하고 `tmp/w06-draft/manifest.json`에 SHA-256을 기록했다. 이 폴더 전체는 Git에서 제외되며 **DB 미적용·실행 미검증**이다. 복사 해시 일치는 기능 검증을 의미하지 않는다. 다른 컴퓨터에는 이 임시 폴더가 없으므로 위 계약·설계에서 다시 구현한다.

| 초안 파일 | 의도 |
| --- | --- |
| `supabase/migrations/20261008020500_session_rpc_boundary.sql` | NOLOGIN·NOBYPASSRLS 역할·최소 컬럼 접근, 현재 Auth 세션/앱 계정 상태 검사, 본인 get_me 응답, 참조 종류·기록 정체성 트리거 |
| `supabase/tests/001_physical_integrity.test.sql` | 기존 51개 검사를 새 불변 트리거와 함께 재현하도록 입력 보완 |
| `supabase/tests/002_rpc_boundary.test.sql` | 역할·30일/7일 경계·UTC 해석·참조 종류·불변 조건의 pgTAP 21개 계획 |
| `scripts/test-local-rpc.mjs` | 실제 발급된 합성 A/B/C 세션, 본인 응답·직접 접근 거절·로그아웃 후 토큰 재사용 거절·미가입/삭제 상태의 로컬 검사 26개 계획 |

검사 개수 21·26은 **초안의 계획 수치**다. 실행 결과가 아니다. 검토 후 필요한 수정과 실제 결과를 새 증거에 남긴다. 스크립트는 일시적인 합성 미가입 계정과 C 상태를 만들고 정리하는 개발 도구이므로 로컬 환경 차단·정리·데이터 보존 경로부터 검토한다. 정상 업무 RPC는 publishable key와 발급된 사용자 세션을 쓴다.

1. 현재 프로젝트의 `git status`, main·origin/main·HEAD, 로컬 DB 상태, 초안 manifest 해시를 확인한다. 이 인계 이후 사용자의 변경을 보존한다.
2. 정책·ERD·계약에서 세션·상태·응답·불변 조건을 재검토하고 초안을 실제 구현 경로로 반영한다. 역할 소유권 이전·Auth 컬럼 SELECT 권한을 실제 DB에서 확인한다.
3. 세션의 최대 기간 30일·비활성 7일·provider not_after를 검사한다. 실제 `auth.sessions.refreshed_at`은 time zone 없는 timestamp라 UTC로 해석한다. Auth 관리 테이블에 가짜 세션/JWT를 넣지 않는다.
4. `database-task.mjs`의 DB 검사 report는 현재 물리 스키마 범위로 고정되어 있다. W06 검사 추가 시 보고 범위를 실제로 구분하고 `db:rpc-test` 같은 명시적 로컬 명령과 Windows wrapper를 추가한다. 계획 수와 실제 실행 수를 혼동하지 않는다.
5. 새 SQL을 적용하고 물리 제약·세션 경계·실제 로컬 발급 세션 검사를 수행한다. 적용 후 수정이 필요하면 새 마이그레이션으로 보완한다. 소스 린트·타입·관련 단위·빌드·산출물 검사를 마친다.
6. 증거·진행표·등록부·변경 기록을 갱신하고 W06-A만 완료한다. W06 전체는 남은 업무 RPC·집계·중복/동시성·권한 회수·삭제 검사가 끝날 때까지 IN_PROGRESS다.
7. 검증된 기능 단위로 커밋한다. 제목에 무엇을 왜 했는지 담고 작업·이유·검증·참조 본문을 쓴다. 원격에 업로드하고 로컬/원격 SHA를 확인한다. 이후 W06의 남은 업무 트랜잭션을 끝낸 뒤 W07 API·로컬 사용자 연결로 진행한다.

## 프로젝트에서 사용할 재개 메시지

```text
차곡찬 개발을 이어서 진행해. AGENTS.md와 docs/development/codex-project-handoff.md, 진행표·등록부를 읽고 W06부터 재개해. 개발 중 로그인 화면 없이 이용하고 실제 로그인은 오픈 준비 때 적용한다. 기능별 검증·문서·상태 갱신·작업과 이유가 드러나는 커밋을 함께 진행하고 원격에 반영해.
```
