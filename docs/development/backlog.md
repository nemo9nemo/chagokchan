# 개발 순서와 진행표

갱신일: 2026-10-08 / 개발 기준 경로: `C:\Users\love0\nemo9Dev\chagokchan`

이 표가 **작업별 상태의 기준**이다. 완료할 때마다 상태·결과·근거를 갱신하고 사용자에게 표를 보여준다. 설계 작업의 DONE은 문서와 해당 정적 검사의 완료다. DB 적용·앱 기능·실제 로그인 검증은 각각의 구현 행에서 따로 완료한다.

W01~W03의 설계 완료 기준일은 2026-10-08이며 상호 참조 확인은 [이번 산출물 검사](../quality/reports/artifacts-check-2026-10-08-workspace.json)에 기록한다. 설계 완료 후 정책을 바꾸면 해당 검사도 다시 실행한다.

| 상태값 | 의미 |
| --- | --- |
| TODO | 대기. 선행 작업 후 착수 |
| IN_PROGRESS | 진행 중 |
| DONE | 해당 행의 완료 기준과 관련 검사 충족 |
| BLOCKED | 착수했지만 외부 입력·환경 문제가 있어 중단. 원인·해결할 다음 행동 기록 |
| DEFERRED | 사용자 요청에 따라 정해진 후속 시점에 진행 |

| ID | 순서·작업 | 상태 | 선행·시점 | 산출물·완료 기준 | 현재 결과·근거 |
| --- | --- | --- | --- | --- | --- |
| W00 | 개발 작업 공간 지정·산출물 이전 | DONE | 사용자 지정 경로 | 기존 산출물 복사·SHA-256 일치·새 경로 검사 | **이전 완료 2026-10-08**. 복사 파일 해시 일치. [이전 검사](../quality/reports/workspace-transfer-2026-10-08.json) |
| W01 | 사용자 범위·MVP 요구·제품 정책 | DONE | 구현 전 | 요구 ID·수락 기준·권한·상태·집계·삭제 정책 | **설계 완료**. [요구](../requirements/mvp-requirements.md)·[제품 정책](../../policies/app-policy.json) |
| W02 | DB 논리 설계·API·화면·검증 설계 | DONE | W01 | ERD·키/관계·계약·화면·TC 상호 참조 | **설계 완료**. [ERD v0.3](../data-erd.md)·[OpenAPI](../../contracts/openapi.json). SQL·실제 DB는 W05 |
| W03 | 개발 중 무로그인 사용 정책 | DONE | 사용자 결정·W01 | 로컬 가상 사용자·배포 분리·실제 로그인 적용 시점 | **설계 완료**. [개발 정책](../../policies/development-policy.json)·[로컬 개발](local-development.md)·[ADR-0004](../decisions/ADR-0004-local-development-auth.md). 실행 코드는 W07 |
| W04 | 개발 환경·앱 기반·로컬 DB 준비 | DONE | W02, W03. 다음 작업 | 고정 Node/pnpm·package/lock·타입/린트·Supabase 설정. 앱 빌드·DB 기동 재현 | **완료 2026-10-08**. 설치·린트·타입·환경/포트 27/27·빌드·HTTP·PostgreSQL 17.11·Auth/REST·포트 127.0.0.1 확인. [검사 증거](../quality/reports/foundation-check-2026-10-08.json) |
| W05 | DB 물리 설계·마이그레이션·가상 데이터 | DONE | W04 | ERD를 SQL·제약·인덱스로 구현. 빈 로컬 DB 적용·A/B/C 초기 데이터 재현 | **완료 2026-10-08**. 빈 DB 적용·18테이블/ERD 컬럼·A/B/C·DB 51/51·준비 재실행 보존/환경 차단·소스 32/32·빌드. [DB 검사 증거](../quality/reports/physical-database-check-2026-10-08.json) |
| W06 | 업무 RPC·RLS·트랜잭션·DB 검사 | DONE | W05 | 직접 접근 거절·집계·중복·동시성·권한 회수·삭제 상태 검사 통과 | **완료 2026-10-08.** W06-A~D2의 DB RPC·RLS와 삭제 경계를 검증했다. 전체 DB 213/213(물리 51·RPC 경계 21·업무 RPC 141), RPC 전용 162/162, D1 실제 세션 통합 4/4, D2 실제 세션/Auth Admin 통합 6/6. BFF/UI·제품 수락·실제 Google/OTP 로그인·운영 원장은 미완료. [D1 증거](../quality/reports/w06-d1-news-and-purge-check-2026-10-08.json)·[D2 증거](../quality/reports/w06-d2-account-deletion-check-2026-10-08.json) |
| W07 | 서버 API 기반·로컬 사용자 연결 | DONE | W03, W06 | 로그인 화면 없이 A 사용, B/C로 같은 RPC/RLS 검사. 입력·CSRF·응답 제한·배포 차단 검증 | **완료 2026-10-08.** W07-A/B에서 local Auth session·`/me`·CSRF/Origin/JSON/32KB guard 기반을 구현하고 A/B/C API·unit·배포 build 차단을 검증했다. 제품 route는 W08부터 붙인다. 배포 session-bound login은 W12로 유예. [W07-B 검사](../quality/reports/w07-b-api-security-check-2026-10-08.json) |
| W08 | 개인 목표·셀프 칭찬·회차·정리 | DONE | W07 | 목표→개인 칭찬→완성→지난 회차·취소. REQ-002/003/007/012 검증 | W08-A/B1/B2/C/D 완료. W08-D 기본 UI와 조회 smoke, unit 82/82 및 build:check 통과. 브라우저의 실제 mutation submit E2E와 제품 수락 검사는 W15 범위에서 계속 미실행으로 추적한다. [W08-D 검사](../quality/reports/w08-d-goal-record-ui-check-2026-10-08.json) · [W08-C 검사](../quality/reports/w08-c-personal-praise-api-check-2026-10-08.json) |
| W09 | 사람 연결·판 권한·공유 칭찬 | DONE | W07, W08 | 초대→요청→수락→판 grant→칭찬. 연결만 된 B·무관한 C 거절 | **W09-A~C 완료 2026-10-08.** 연결 API·공유 grant/peer API·UI06~UI08과 현재 grant 공유판 목록을 구현·검증했다. DB 252/252·실제 Auth 공유 RPC 8/8·A/B/C board API 각 14/14·전체 unit 100/100·UI06 로컬 렌더 smoke. 제품 수락·실제 로그인·기기/접근성 E2E는 W13/W15. [W09-C 검사](../quality/reports/w09-c-shared-board-ui-check-2026-10-08.json) |
| W10 | 소식·보낸함·삭제·정리 작업 | IN_PROGRESS | W08, W09 | 최소 응답·재시도·파기·FK·접근 중단 검사. 실제 재인증 수락은 W12/W13 | **W10-A/B 완료.** 소식·보낸함 API와 목표 휴지통·복구 API/UI를 구현했다. 삭제 재요청은 같은 revision으로 replay해 30일 기한을 연장하지 않는다. 전체 unit 109/109·A/B/C trash API 각 11/11·W06-D1 Auth 세션 4/4·전체 DB 257/257·정적 산출물·빌드 검사를 통과했다. 실제 브라우저 mutation E2E·운영 원장 검증은 미실행. 다음 W11은 테마·접근성·PWA, 계정 재인증 경로는 W12/W13. [W10-B 검사](../quality/reports/w10-b-goal-trash-api-ui-check-2026-10-08.json) |
| W11 | 테마 분리·오류 UX·접근성·PWA | IN_PROGRESS | W08~W10 | 테마 교체 시 기록 불변, 목록 대안·작은 화면·정적 캐시·개인정보 no-store 검사 | W11-A·W11-B1 완료. W11-B2 브라우저 재배치·대비와 W11-C PWA 매니페스트·정적 캐시·오프라인 단위 검증을 마쳤다. 실기기 확대·읽기 도구·터치 TC-WEB-006 및 A/B 계정 전환·실제 오프라인 TC-CACHE-001이 남았다. [W11-C 검사](../quality/reports/w11-c-pwa-cache-check-2026-10-08.json) · [W11-B2 검사](../quality/reports/w11-b2-small-screen-contrast-check-2026-10-08.json) |
| W12 | 실제 로그인 제공자·가입·세션 연동 | DEFERRED | **오픈 준비 시점**, W07, W14 | Google/OTP·가입 확인·쿠키·갱신·로그아웃·재인증·초대 복귀 구현 | 사용자 요청으로 후반 진행. REQ-001 실제 인증 미구현 |
| W13 | 실제 로그인·여러 계정 권한 수락 검사 | DEFERRED | **공개 전 필수**, W09~W12 | 실제 로그인한 테스트 계정으로 연결·권한·세션 폐기·캐시·가입·삭제 검사 | 로컬 가상 계정 결과로 대체하지 않음 |
| W14 | 운영 입력·공개 정책·스테이징 준비 | TODO | 로컬 개발과 병행 가능. 서비스 개설 전에 입력 필요 | 운영 주체·지원·도메인·예산·처리방침·약관·독립 삭제 원장·별도 환경 | 실제 서비스·결제·운영 설정 없음 |
| W15 | 통합·보안·기기·복원·부하 검사 | TODO | W11, W13, W14 | 필수 TC 실행 증거·P0/P1 해결·복원·실측 성능·배포 차단 검사 | 소스 단위 32개·물리 DB 51개 통과. 제품 수락 TC 36개·업무 RPC·실제 로그인·통합/복원/부하 검사 미실행. [검증 계획](../quality/verification-plan.md) |
| W16 | Git 형상관리·CI 연결 | DONE | **사용자 지정 원격 연결 요청 2026-10-08** | 지정 저장소·문서/소스/lock/SQL/검사 함께 관리·CI 검증 | W16-A/B/C 완료. 기능별 커밋·원격 업로드, GitHub Actions `quality` CI, main PR 보호와 필수 검사·관리자 우회/강제 push/삭제 금지를 적용·확인했다. [W16-C 증거](../quality/reports/w16-c-ci-check-2026-10-08.json) |
| W17 | 운영 배포·공개·초기 관찰 | TODO | W12~W15. Git 연결 시 W16의 CI 사용 | 검증 소스·호환 DB 적용·운영 빌드·공개·오류/로그인 관찰·릴리스 기록 | 배포·공개 미실행 |

W14는 서비스 개설을 준비할 때, W16은 사용자가 정한 시점에 진행한다. 이 두 입력 때문에 로컬 DB·기능 개발을 멈추지 않는다. 실제 로그인 없이 개발한다는 요구도 DB 권한·동시성 검사를 미루는 이유로 사용하지 않는다.

업무 ID를 이 순서로 재정리했다. 요구의 개발 작업 열은 같은 ID를 참조한다. 상위 S01~S08 단계·환경·산출물 존재 상태는 [등록부](artifact-register.json)에 기록하고, 이 표와 함께 갱신한다. 기록 양식은 [변경 기록](../templates/change-record.md)을 사용한다. 완료 표시는 산출물·관련 검사·완료 날짜의 근거를 남긴 뒤 변경하며 실제 로그인 TC는 공개 전에 반드시 실행한다.

## W04와 로컬 Git의 완료 범위

| ID | 기능 단위 | 상태 | 결과·다음 행동 |
| --- | --- | --- | --- |
| W04-A | 고정 런타임·앱·환경 차단 검사 | DONE | 2026-10-08. 린트·타입·환경 20개·빌드·loopback HTTP 통과. [검사](../quality/reports/foundation-check-2026-10-08.json) |
| W04-B | Supabase CLI·로컬 설정 | DONE | 2026-10-08. CLI 2.120.0 실행·config.toml 생성 확인 |
| W04-C | Docker 엔진·로컬 DB·포트 제한 | DONE | PostgreSQL 17.11·Auth/REST 200·공개 포트 127.0.0.1·포트 회귀 7개 통과 |
| W16-A | 로컬 Git·기능 단위 커밋 | DONE | main·메시지 훅 적용. 작업·이유·검증·참조 본문 필수 |
| W16-B | 지정 GitHub 원격 연결·이력 업로드 | DONE | 2026-10-08. 공개 origin/main·기존 세 커밋 보존·SHA/업스트림 일치. [증거](../quality/reports/git-remote-connection-2026-10-08.json) |
| W16-C | CI·브랜치 보호 | DONE | GitHub Actions `quality` job에 Node·pnpm 잠금 설치·`pnpm check`·`pnpm build:check`를 구성했다. 첫 실행 오류를 수정한 뒤 원격 run `37783463500`와 기록 PR run `37783959708`의 `quality`·build가 통과했다. main에 PR 필수, strict `quality`, 관리자 포함, 강제 push·삭제 금지를 적용·재조회했다. 1인 개발 기준 승인 리뷰 요구는 0명이다. [검사 증거](../quality/reports/w16-c-ci-check-2026-10-08.json) · [CI 변경 기록](../changes/2026-10-08-w16-c-ci.md) |

## W05의 완료 범위

| ID | 기능 단위 | 상태 | 결과·다음 행동 |
| --- | --- | --- | --- |
| W05-A | 물리 스키마·FK·인덱스·기본 RLS | DONE | 18테이블·38FK·68인덱스·ERD 컬럼 일치. 적용 SQL 변경 없음 |
| W05-B | 명시적인 합성 Auth·앱 초기 데이터 | DONE | A/B/C 3개. 비공개 준비 기록·재실행 불변·잘못된 환경 거절 |
| W05-C | 물리 제약·초기 접근 검사 | DONE | pgTAP 51/51·소스 단위 32/32·빌드 통과. 업무 RPC·동시성·세션은 W06/W07 |

## W06의 기능 단위 진행

| ID | 기능 단위 | 상태 | 결과·다음 행동 |
| --- | --- | --- | --- |
| W06-A | 현재 Auth 세션·계정 경계·get_me·참조/정체성 트리거 | DONE | 2026-10-08. PostgreSQL 17.11에서 전체 DB 72/72, Auth 발급 A/B/C 세션 통합 27/27, 앱 데이터 보존·임시 계정/세션 정리 통과. [검사 증거](../quality/reports/w06-a-session-boundary-check-2026-10-08.json) |
| W06-B1 | 목표 생성·소유 조회·내용 수정·상태 전이 RPC | DONE | 2026-10-08. migration 4개·RLS/열 권한 18/18·전체 DB 90/90·발급 세션 통합 12/12·W06-A 세션 회귀 27/27·lint/type/build 통과. 같은 키 재시도·상한 경합·데이터/세션 보존 확인. [검사 증거](../quality/reports/w06-b1-goal-rpc-check-2026-10-08.json) |
| W06-B | 목표·개인 칭찬·회차 업무 RPC와 원자적 집계·취소·재시도 | DONE | W06-B1 목표 생성·소유 조회·revision 상태와 W06-B2 개인 칭찬·회차. DB 116/116·RPC 경계/업무 권한 65/65·발급 세션 목표 12/12·개인 칭찬 12/12·W06-A 세션 회귀 27/27·lint/type/unit/build 통과. 개인/회차 기술 TC 3개 통과. [W06-B2 증거](../quality/reports/w06-b2-personal-praise-check-2026-10-08.json) |
| W06-B2 | 개인 칭찬·회차·완성 소식·제한·롤백 | DONE | 2026-10-08. 적용 마이그레이션 20261008021400~20261008021700. 실제 발급 세션 12/12: 편집·취소·중복, 마지막 단위 동시 부여·회차 이동·수신자 RLS·목표 snapshot·20/분·300/일·강제 실패 전체 롤백. 기존 적용 SQL은 수정하지 않음. [검사 증거](../quality/reports/w06-b2-personal-praise-check-2026-10-08.json) |
| W06-C | 연결·초대·요청·판 grant·공유 칭찬 RPC와 권한 회수 경합 | DONE | 연결·공유 기능의 모든 단위 완료 | **완료 2026-10-08**: W06-C1 관계 수명주기와 W06-C2 공유판 권한·공유 칭찬을 구현하고 관계/공유 쓰기 경합을 검사했다. 전체 DB 161/161·RPC 110/110·관계 세션 13/13·공유판 세션 6/6. [W06-C1 커서 보완](../quality/reports/w06-c1-cursor-pagination-check-2026-10-08.json), [W06-C2 증거](../quality/reports/w06-c2-shared-board-rpc-check-2026-10-08.json) |
| W06-C1 | 일회 초대·연결 요청·승인·해제·차단·재연결 | DONE | W06-B2 | 초대 미리보기/소비·단일 대기 요청·연결 세대·블록·상한 경합 | **완료 2026-10-08**. 적용 migration 20261008021800~20261008022100, 페이지 경계 후속 20261008023000. 최초 DB 135/135·RPC 84/84·pgTAP 19/19·실제 발급 세션 13/13. 커서 보완은 pgTAP 20/20·전체 DB 161/161·RPC 110/110·발급 세션 13/13이며 초대/요청/연결/차단 전체 페이지에서 ID 중복·누락 없음. [최초 검사](../quality/reports/w06-c1-connection-rpc-check-2026-10-08.json), [커서 보완 검사](../quality/reports/w06-c1-cursor-pagination-check-2026-10-08.json) |
| W06-C2 | 공유판 grant/revoke·안전 projection·공유 칭찬·권한 회수 경합 | DONE | W06-C1 | 오너만 권한 관리, 세대 snapshot·연결/차단 동시 회수·공유 칭찬/개인 집계 독립 | **완료 2026-10-08**. migration 20261008022200~20261008022900. DB 160/160·RPC 109/109·공유판 실제 발급 세션 6/6·공유판 pgTAP 25/25. 50명 grant 상한·공유/개인 집계 분리·재시도·롤백·revoke/disconnect/block 경합과 기존 fixture 보존을 확인. [검사 증거](../quality/reports/w06-c2-shared-board-rpc-check-2026-10-08.json) |
| W06-D | 소식·요청 결과·삭제/파기 RPC와 FK 정리 경계 | DONE | idempotency·계정 접근 중단·작성자/수신자 삭제·재시도 검사 | **완료 2026-10-08**: D1·D2 하위 기능·권한 경계와 재시도를 구현하고 로컬에서 검증했다. 외부 독립 삭제 원장과 실제 제공자 로그인은 운영/오픈 준비 단계에서 설정·검증한다. |
| W06-D1 | 소식·보낸 칭찬·목표 휴지통/복구·목표 파기 경계 | DONE | W06-C2 | 2026-10-08. DB pgTAP 20/20·발급 Auth 세션 통합 4/4: 최소 소식/커서·읽음 재시도·관계 해제 뒤 보낸함·소프트 삭제/권한 회수·복구·기한·외부 원장 gate·FK 정리. 기존 fixture 보존·probe 정리 통과. 원장 미설정으로 gate는 기본 차단. [증거](../quality/reports/w06-d1-news-and-purge-check-2026-10-08.json) |
| W06-D2 | 재인증·계정 접근 중단·작성자/수신자 파기·Auth 삭제 재시도 | DONE | W06-D1 | **완료 2026-10-08.** DB pgTAP 32/32·발급 Auth 세션/Auth Admin 통합 6/6 통과. 외부 원장 gate 차단·실패 rollback·동일 원장 참조 retry·작성자 기록 scrub/수신자 소유 데이터 제거·Auth 최종 삭제·UUID 재가입 차단·fixture 보존 확인. 독립 원장 미설정으로 gate는 기본 차단; 로컬에서만 합성 참조 사용. [검사](../quality/reports/w06-d2-account-deletion-check-2026-10-08.json) |

## W07 서버 API 기반·로컬 사용자 연결

| ID | 기능 단위 | 상태 | 결과·다음 행동 |
| --- | --- | --- | --- |
| W07-A | 서버 전용 local fixture 세션과 GET /me | DONE | 개발 환경의 허용된 A/B/C만 서버에서 선택하고 Auth-issued local session으로 `get_me` RPC/RLS 호출. 응답을 OpenAPI Me allowlist로 제한·no-store. 현재 선택 actor에 대해 API 통합 검사 통과. [검사](../quality/reports/w07-a-local-me-api-check-2026-10-08.json) |
| W07-B | API 공통 요청 경계·CSRF·입력·오류 처리 | DONE | Origin/Fetch Metadata·signed double-submit·JSON·실제 32KB 상한·no-store 오류 응답 기반. unit 14/14·A/B/C CSRF API integration 확인. [검사](../quality/reports/w07-b-api-security-check-2026-10-08.json) |
| W07-C | 배포 Auth 세션 해석기와 일반 API client | DEFERRED | Google/OTP와 실사용 로그인을 미루는 사용자 결정에 따라 W12에서 구현. 배포 `/me`는 현재 세션 모드 미지원 시 401 |

## W08 개인 목표·셀프 칭찬·회차·정리

| ID | 기능 단위 | 상태 | 결과·다음 행동 |
| --- | --- | --- | --- |
| W08-A | 목표 생성·상세·설명 수정 API | DONE | 로컬 fixture Auth 세션을 사용해 POST `/api/v1/goals`, GET/PATCH `/api/v1/goals/{goal_id}`를 기존 create/get/update RPC에 연결했다. body·멱등 키·응답 allowlist·no-store·CSRF·비소유자 비공개 404를 검사했다. 단위 8/8, A/B/C 각각 비파괴 API 3/3, build:check 통과. 실제 생성/수정의 route→DB 통합 검사는 fixture DB를 변경하지 않도록 미실행이며 별도 기록한다. [검사](../quality/reports/w08-a-goal-api-check-2026-10-08.json) |
| W08-B1 | 목표 목록·상태 필터·keyset cursor RPC/API | DONE | W08-A | 2026-10-08. 제한 요약 projection의 `list_goals` RPC와 GET `/api/v1/goals`를 연결했다. 소유자·삭제 제외, 1~50개 순서형 페이지, status-bound cursor, 잘못된 cursor/필터 거절. DB 전체 222/222·RPC 171/171·W08-B1 pgTAP 9/9·실제 Auth 세션 RPC 5/5·A/B/C API 각 3/3·unit 64/64·build:check 통과. 기존 fixture DB 변경 없음. [검사](../quality/reports/w08-b1-goal-list-check-2026-10-08.json) |
| W08-B2 | 목표 완료·보관·재개·판 설정 변경 및 회차 읽기 API | DONE | W08-B1 | 2026-10-08. `complete/archive/resume_goal`, `update_board`, `list_bunches`를 서버 API에 연결하고 회차 목록에 board-bound keyset cursor·현재 판 권한·요약 allowlist를 적용했다. pgTAP 9/9·DB 231/231·RPC 회귀 180/180·실제 Auth 세션 회차/전이 6/6·A/B/C API 각 8/8·unit 69/69·build:check 통과. 합성 계정 정리 및 기존 fixture 보존. [검사](../quality/reports/w08-b2-goal-lifecycle-api-check-2026-10-08.json) |
| W08-C | 개인 칭찬 생성·수정·취소·회차 API | DONE | W08-B2 | 2026-10-08. 목록·생성·수정·취소 API를 기존 업무 RPC에 연결하고, 회차 ID가 빠져 있던 기존 생성 RPC는 적용본을 유지한 채 원자적 결과 projection wrapper를 추가했다. pgTAP 6/6·전체 DB 237/237·RPC 186/186·실제 Auth 세션 3/3·A/B/C API 각 10/10·전체 unit 79/79·build:check 통과. 공유 peer 쓰기와 숨김/제외 route는 W09 대기. [검사](../quality/reports/w08-c-personal-praise-api-check-2026-10-08.json) |
| W08-D | 목표·개인 기록 기본 화면 | DONE | 화면 설계 UI02~UI05를 구현하고 성공 전 전송 상태·동일 키 재시도·빈/오류 상태를 검증한다. 접근성·PWA 세부 검사는 W11에 포함한다. | 목표 목록·생성·상세·목표/판 설정·완료/보관/재개·개인 기록·회차·받은 칭찬 읽기를 서버 API에 연결했다. 로컬 Auth A 브라우저 조회 smoke에서 판별 전환·빈 회차 첫 입력·선택 공유판 폼·설정을 확인했다. Biome·typecheck·unit 82/82·산출물 검사·build:check 통과, TC-UI-003 smoke 통과. 실제 UI mutation submit E2E와 기기·스크린리더·PWA는 미실행이며 제품 수락 TC로 완료 처리하지 않는다. [검사](../quality/reports/w08-d-goal-record-ui-check-2026-10-08.json) |

## W09 사람 연결·공유 기능

| ID | 기능 단위 | 상태 | 결과·다음 행동 |
| --- | --- | --- | --- |
| W09-A | 연결 초대·요청·차단 API | DONE | 연결·초대·요청·차단 목록/수명주기 route 14개를 기존 Auth-scoped RPC에 연결했다. unit 8/8, A/B/C 각각 12/12 경계 API 검사, 기존 W06-C 관계 RPC 실제 세션 13/13 근거를 함께 확인했다. 기존 fixture 쓰기 0건. [검사](../quality/reports/w09-a-connection-api-check-2026-10-08.json) |
| W09-B | 공유판 권한·peer 칭찬 API | DONE | 2026-10-08. 판 상세/멤버 목록 역할 projection, owner grant/revoke, contributor 공유 칭찬 생성, recipient hide/unhide/exclude API를 기존 업무 RPC에 연결했다. pgTAP 10/10, 전체 DB 247/247, 합성 Auth 세션 7/7, A/B/C route 경계 각 12/12, unit 99/99, build:check 통과. 기존 fixture DB 보존. 실제 route mutation→DB 성공은 fixture 쓰기 없이 미실행이며 실제 로그인은 W12/W13. [검사](../quality/reports/w09-b-shared-board-praise-api-check-2026-10-08.json) |
| W09-C | 연결·공유판 화면 | DONE | UI06 초대 링크/코드·요청·연결/차단, UI07 공유판별 contributor grant/revoke, UI08 현재 권한 공유판·내가 보낸 칭찬을 구현했다. `20261008024800` `list_my_shared_boards`와 GET `/api/v1/shared-boards`는 현재 연결 generation·차단·grant를 확인하며 cursor page와 제한 projection을 제공한다. pgTAP 013 5/5·전체 DB 252/252·실제 Auth 세션 공유 RPC 8/8·A/B/C route 각 14/14·unit 100/100·lint/typecheck/build:check·UI06 연결 화면 로컬 렌더 확인. API 검사 중 제품 fixture 쓰기 0건, 합성 계정/세션 정리 및 fixture snapshot 보존. 실제 UI mutation submit·제품 수락·기기/스크린리더 검사는 W15. [검사](../quality/reports/w09-c-shared-board-ui-check-2026-10-08.json) |

## W10 소식·보낸함·삭제·정리

| ID | 기능 단위 | 상태 | 결과·다음 행동 |
| --- | --- | --- | --- |
| W10-A | 소식·보낸 peer 칭찬 읽기 API | DONE | `GET /api/v1/notifications`, `PATCH /api/v1/notifications/{notification_id}`, `GET /api/v1/sent-praises`를 W06-D1의 recipient-scoped RPC에 연결했다. 응답 allowlist·cursor/limit·no-store·읽음 CSRF·idempotent RPC 결과를 적용했다. unit 107/107, A/B/C 실제 local Auth API 각 11/11, W06-D1 세션 회귀 4/4, 전체 DB 252/252. 제품 fixture 쓰기 0건. UI09·화면 submit E2E는 다음 화면 단위에서 진행한다. [검사](../quality/reports/w10-a-news-sent-api-check-2026-10-08.json) |
| W10-B | 목표 휴지통·복구 API/UI | DONE | 본인만 휴지통을 보고 기한 전 복구, 삭제/복구의 revision·권한 회수·이전 grant 미복구를 연결했다. unit 109/109·전체 DB 257/257·W06-D1 Auth 세션 회귀 4/4·A/B/C API 각 11/11·check·build:check 통과. 삭제 응답 재시도는 원래 revision으로 안전하고 purge_after를 연장하지 않는다. 실제 UI mutation E2E 및 운영 삭제 원장은 미실행. [검사](../quality/reports/w10-b-goal-trash-api-ui-check-2026-10-08.json) |
| W10-C | 계정 탈퇴 재인증·접근 중단 orchestration | DEFERRED | 실제 session-bound reauthentication과 쿠키/세션 폐기는 W12/W13에 함께 구현·검증한다. DB W06-D2 RPC 결과를 실제 로그인 완료로 간주하지 않는다. |

## W11 테마·오류 UX·접근성·PWA

| ID | 기능 단위 | 상태 | 결과·다음 행동 |
| --- | --- | --- | --- |
| W11-A | 교체 가능한 테마 토큰·전환 | DONE | 정원/포도 팔레트와 의미 중심 CSS 토큰을 분리했다. 화면 전환은 현재 탭 상태만 바꾸며 로컬 저장·업무 API 쓰기를 하지 않는다. 키보드로 전환해 목표 제목·개인/공유 개수 유지와 `aria-pressed` 상태를 확인했다. [검사](../quality/reports/w11-a-theme-switch-check-2026-10-08.json) |
| W11-B | 오류·빈/로딩 상태·키보드/읽기 도구·작은 화면 | IN_PROGRESS | W11-A | W11-B1 완료. W11-B2의 320/640px 반응형·두 테마 대비 브라우저 검증 완료. 실기기 확대·읽기 도구·터치는 TC-WEB-006에 남겨 뒀다. [B1 증거](../quality/reports/w11-b1-accessibility-recovery-check-2026-10-08.json) · [B2 증거](../quality/reports/w11-b2-small-screen-contrast-check-2026-10-08.json) |
| W11-B1 | 본문 건너뛰기·비동기 상태·조회 오류 재시도 | DONE | W11-A | 키보드 본문 이동, 4개 목록의 busy 상태, 연결 조회 실패·재시도를 읽기 전용 smoke로 검증한다. |
| W11-B2 | 작은 화면·대비·실기기 읽기 도구 | IN_PROGRESS | W11-B1 | 320/640px 브라우저 재배치와 두 테마 글자 대비를 수정·검증했다. 실제 기기 확대·스크린리더·터치 흐름 `TC-WEB-006`은 미실행이며 기기 검증이 남았다. [브라우저 검사](../quality/reports/w11-b2-small-screen-contrast-check-2026-10-08.json) |
| W11-C | PWA 설치·정적 전용 캐시·오프라인 안내 | IN_PROGRESS | PWA 매니페스트·PNG 아이콘·운영 모드 서비스 워커와 정적 오프라인 문서를 구현했다. immutable 정적 파일만 허용하고 사용자 HTML/RSC/API/초대/query secret/변경 요청은 가로채지 않는 단위 검사 `TC-CACHE-002` 6/6 및 build:check를 통과했다. 홈 문서·API는 no-store, 브라우저는 오프라인 경고와 미확인 기록 안내를 표시한다. A/B 계정 전환 및 실제 기기 오프라인 `TC-CACHE-001`은 미실행으로 남긴다. [검사](../quality/reports/w11-c-pwa-cache-check-2026-10-08.json) |
