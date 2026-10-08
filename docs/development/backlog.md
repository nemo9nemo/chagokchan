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
| W08 | 개인 목표·셀프 칭찬·회차·정리 | IN_PROGRESS | W07 | 목표→개인 칭찬→완성→지난 회차·취소. REQ-002/003/007/012 검증 | W08-A/B1/B2 완료. W08-C 개인 칭찬 API와 W08-D 화면이 남음. [W08-B2 검사](../quality/reports/w08-b2-goal-lifecycle-api-check-2026-10-08.json) |
| W09 | 사람 연결·판 권한·공유 칭찬 | TODO | W07, W08 | 초대→요청→수락→판 grant→칭찬. 연결만 된 B·무관한 C 거절 | REQ-004/005/006 미구현 |
| W10 | 소식·보낸함·삭제·정리 작업 | TODO | W08, W09 | 최소 응답·재시도·파기·FK·접근 중단 검사. 실제 재인증 수락은 W12/W13 | REQ-008/009/010 미구현 |
| W11 | 테마 분리·오류 UX·접근성·PWA | TODO | W08~W10 | 테마 교체 시 기록 불변, 목록 대안·작은 화면·정적 캐시·개인정보 no-store 검사 | REQ-011·NFR-002 미구현 |
| W12 | 실제 로그인 제공자·가입·세션 연동 | DEFERRED | **오픈 준비 시점**, W07, W14 | Google/OTP·가입 확인·쿠키·갱신·로그아웃·재인증·초대 복귀 구현 | 사용자 요청으로 후반 진행. REQ-001 실제 인증 미구현 |
| W13 | 실제 로그인·여러 계정 권한 수락 검사 | DEFERRED | **공개 전 필수**, W09~W12 | 실제 로그인한 테스트 계정으로 연결·권한·세션 폐기·캐시·가입·삭제 검사 | 로컬 가상 계정 결과로 대체하지 않음 |
| W14 | 운영 입력·공개 정책·스테이징 준비 | TODO | 로컬 개발과 병행 가능. 서비스 개설 전에 입력 필요 | 운영 주체·지원·도메인·예산·처리방침·약관·독립 삭제 원장·별도 환경 | 실제 서비스·결제·운영 설정 없음 |
| W15 | 통합·보안·기기·복원·부하 검사 | TODO | W11, W13, W14 | 필수 TC 실행 증거·P0/P1 해결·복원·실측 성능·배포 차단 검사 | 소스 단위 32개·물리 DB 51개 통과. 제품 수락 TC 36개·업무 RPC·실제 로그인·통합/복원/부하 검사 미실행. [검증 계획](../quality/verification-plan.md) |
| W16 | Git 형상관리·CI 연결 | IN_PROGRESS | **사용자 지정 원격 연결 요청 2026-10-08** | 지정 저장소·문서/소스/lock/SQL/검사 함께 관리·CI 검증 | 로컬 Git·메시지 훅·공개 origin/main·첫 업로드 확인. [연결 증거](../quality/reports/git-remote-connection-2026-10-08.json). CI·브랜치 보호는 대기 |
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
| W16-C | CI·브랜치 보호 | TODO | 현재 로컬 검사를 CI로 재현하고 필수 검사를 설정한 뒤 완료 |

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
| W08-C | 개인 칭찬 생성·수정·취소·회차 API | TODO | existing praise/cycle RPC를 CSRF·멱등·최소 응답 API에 연결하고 작성·수정·취소·동시 회차 TC를 실제 local session으로 실행한다. |
| W08-D | 목표·개인 기록 기본 화면 | TODO | 화면 설계 UI02~UI05를 구현하고 성공 전 전송 상태·동일 키 재시도·빈/오류 상태를 검증한다. 접근성·PWA 세부 검사는 W11에 포함한다. |
