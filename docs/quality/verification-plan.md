# 검증 계획과 증거 기준

버전: 0.2.0 / 상태: 계획·기술 TC 일부 실행 / 갱신일: 2026-10-08

[테스트 케이스](test-cases.json)에 57개 시나리오를 입력·기대 결과·요구·정책 ID로 기록했다. 제품 수락 시나리오 36개는 아직 미실행이며, W06-A 기술 TC 2개·W06-B1 기술 TC 2개·W06-B2 기술 TC 3개·W06-C1 기술 TC 4개·W06-C2 기술 TC 4개·W06-D1 기술 TC 4개·W06-D2 기술 TC 2개가 통과했다. 정책·문서 검사 결과는 [기준 산출물 검사 기록](reports/2026-10-07-baseline.md)과 분리한다.

## 검증 계층

| 계층 | 시점 | 대상·증거 |
| --- | --- | --- |
| 정적 산출물 | 설계 변경 때 | JSON·로컬 링크·OpenAPI 참조/경로/ID·REQ/POL/TC 연결·ERD 원본 일치 |
| DB 제약·RLS·RPC | 관련 SQL 작성 때 | anon/A/B/C 역할, 위조 ID, 직접 DML/RPC/뷰, 집계·잠금·롤백 |
| 서버·인증 계약 | API 작성 때 | 성인 확인 전 접근 차단·기존 확인 기록 유지, HTTP 입력/응답·필드 제한·현재 세션·CSRF·재인증·오류 |
| 사용자 흐름 E2E | 해당 화면 작성 때 | 목표→개인 칭찬, A/B 연결→grant→공유 칭찬, 취소·삭제 |
| 수동 기기·접근성 | 베타 전 | 실제 iOS/Android·인앱 브라우저·PWA·키보드·읽기 도구 |
| 운영·복원·부하 | 출시 전 | 환경·마이그레이션·배포/롤백·독립 삭제 원장·복원·지연 |

검증에서 사용할 A/B/C는 실제 연락처가 없는 가상 사용자다. A 주인, B 허용 지인, C 무권한 사용자로 시작하고 연결만 있는 B 상태도 별도로 준비한다. 스테이징 로그인은 지정된 테스트 계정으로 수행한다.

2026-10-08 사용자 결정에 따른 검사 시점:

| 시점 | 실행 범위 | 기록 기준 |
| --- | --- | --- |
| 로컬 개발 중 | DB 제약·RLS·RPC·중복/동시성·응답·화면, TC-DEV-001의 무로그인 사용과 TC-DEV-002의 환경 차단 | 합성 Auth 세션으로 실행. 실제 제공자 로그인 통과로 집계하지 않음 |
| 오픈 준비 | 실제 Google/OTP·가입·갱신·로그아웃·재인증·초대 복귀, TC-AUTH-001~004·TC-AUDIENCE-001·TC-UX-002의 실제 인증 흐름 | 실제 테스트 계정·콜백·메일·환경의 증거 필요. 로컬에서 일부 검사했어도 해당 인증 흐름 추가 실행 |
| 공개 전 | 실제 로그인한 여러 계정으로 권한·캐시·삭제·기기·복원·부하·배포 차단 재검증 | 필수 TC의 요구 환경을 충족해야 완료. 로컬 가상 계정 결과만으로 출시 수락 불가 |

TC-DEV-001/002는 [개발 정책](../../policies/development-policy.json)과 POL-DEV-001을 검증한다. 2026-10-08 환경 차단 단위 검사 20개·포트 회귀 검사 7개·앱 빌드·HTTP·로컬 DB 연결·포트 확인을 통과했다. [부분 검사 근거](reports/foundation-check-2026-10-08.json). 실제 세션·업무 API·RPC/RLS·스테이징·번들 검증이 남아 있어 전체 TC는 not_run을 유지한다.

## 필수 출시 기준

관련 REQ·정책을 구현한 뒤 필수 TC를 실행한다. 보안·권한·집계·삭제 실패와 데이터 유출은 P0/P1로 처리하고 출시 전에 해결한다. 성능 목표 차이는 실제 규모·개선 내용·출시 판단 근거와 함께 기록한다.

부하 목표는 합성 100계정·목표 3개·칭찬 300개씩, 50 read/s·10 write/s 5분, p95 읽기 800ms·쓰기 1500ms·오류율 1% 미만으로 시작한다. 성능 수치와 삭제/복원 시간은 현재 목표이며 측정값이 아니다.

외부 공격 통제의 상세 조건은 [위협 모델](../security-threat-model.md)을 따른다. OWASP ASVS는 검증 범위를 검토할 참고 자료로 사용하고 전체 인증·준수 완료로 표시하지 않는다. [OWASP ASVS](https://owasp.org/projects/asvs)

## 결과 기록

각 실행에 TC ID·소스 식별자·환경/버전·시작/종료·명령 또는 수동 단계·관찰 결과·통과/실패·결함·증거 위치를 남긴다. 실패는 재현 방법과 원인을 기록하고 수정 후 해당 시나리오를 재실행한다.

Git 연결 전에는 검사 시각·소스 산출물 SHA-256·마이그레이션 목록으로 버전을 식별한다. 연결 후에는 commit SHA와 잠금 파일·정책 버전을 함께 남긴다. 비밀·본문·운영 사용자 기록을 증거에 복사하지 않는다.

관계도 문자열 검사가 통과해도 Mermaid 렌더링·SQL 유효성·DB 권한 검증이 통과한 것으로 표시하지 않는다. OpenAPI의 구조 확인과 실제 validator·타입 생성·서버 계약 검사도 구분한다.

## W06-A 세션·참조 경계 검사

2026-10-08 PostgreSQL 17.11·Supabase CLI 2.120.0 로컬 DB에서 `20261008020500`~`20261008020900` 순서의 W06-A 마이그레이션을 적용했다. 전체 DB 검사는 물리 무결성 51/51과 W06-A RPC 경계 21/21, RPC 전용 명령도 21/21을 통과했다. 실제 Auth가 발급한 A/B/C 세션을 이용한 로컬 통합 27/27에서 본인 get_me 필드, 직접 테이블·내부/관리 스키마 차단, 로그아웃 후 토큰 재사용, 미가입·deleting 상태, 앱 데이터 보존, 임시 계정·세션 정리를 확인했다. [세부 증거](reports/w06-a-session-boundary-check-2026-10-08.json).

TC-DB-SESSION-001과 TC-DB-REFERENCE-001은 W06-A에서 통과했다. 이는 로컬 개발 Auth 세션과 정적 DB 경계 검사이며 실제 Google/OTP 로그인을 뜻하지 않는다. 제품 수락 시나리오 36개와 실제 제공자 로그인은 실행 0개다.

## W06-B1 목표 소유·생성·상태 RPC 검사

2026-10-08 PostgreSQL 17.11 로컬 DB에 `20261008021000`~`20261008021300`을 순서대로 적용했다. 목표 생성은 목표·개인판과 명시적 공유 프로필을 한 트랜잭션에 저장하고, 본인 상세 응답·revision 기반 수정·완료/보관/재개를 RPC로 제공한다. 목표 상한은 사용자별 advisory transaction lock으로 직렬화하고 요청 키/입력 해시로 중복 결과를 고정한다. RPC 소유자는 비로그인·RLS 유지 역할이며 API 직접 테이블 접근은 계속 거절된다.

DB 회귀 `scripts/project.ps1 -Task db:test` 90/90(물리 51, 세션/참조 경계 21, 목표 RPC 권한/RLS 18), RPC 전용 `db:rpc-test` 39/39를 통과했다. 로컬 Auth에서 실제 발급한 임시 소유자·타인 세션의 목표 통합 `scripts/project.ps1 -Task db:goal-test` 12/12를 통과했다. 동일 키 10개 병렬 요청은 하나의 목표만 만들었고, 19개 상태에서 서로 다른 키 병렬 상한 경쟁은 한 요청만 승인되어 활성 20개를 넘지 않았다. revision 충돌·타인 목표 404·직접 테이블 거절·실패 입력 원자성·공유 프로필의 명시 필드도 확인했다. 검사용 합성 계정/세션을 정리하고 기존 앱 fixture를 보존했다. `scripts/project.ps1 -Task check`(lint 21개·typecheck·단위 32/32·정적 산출물 40 TC/361 링크) 및 `build:check`도 통과했다. [세부 증거](reports/w06-b1-goal-rpc-check-2026-10-08.json)

TC-DB-GOAL-001/002는 통과했지만 OpenAPI `/api/v1` 서버와 화면은 아직 없으므로 TC-GOAL-001/002 등 제품/API 수락 시나리오를 완료로 올리지 않는다. 연결/공유 권한 경합과 삭제 RPC는 W06-C/D에 남아 있다. 목표 RPC 검사도 실제 Google/OTP 로그인 검증이 아니다.

## W06-B2 개인 칭찬·회차 원자성 검사

2026-10-08 PostgreSQL 17.11 로컬 Supabase에 `20261008021400`~`20261008021700`을 순서대로 적용했다. W06-B1의 목표 소유·revision 경계 위에서 개인판 작성, 메모/실천일 수정, 작성자 취소, 회차 snapshot 및 집계를 트랜잭션 RPC로 구현했다. 기존 적용 마이그레이션은 수정하지 않았다. 완성 소식의 중복 방지는 `(recipient_user_id, dedupe_key)` 충돌 키를 사용한다. PostgreSQL은 충돌 대상 INSERT에서 제안된 행에도 SELECT RLS를 확인하므로 RPC 역할에만 현재 수신자 행을 보이는 SELECT 정책을 추가했고, API 역할의 직접 SELECT 권한은 추가하지 않았다.

`db:test`는 116/116(물리 무결성 51, RPC 경계 21, 업무 RPC 권한/RLS 44), `db:rpc-test`는 65/65를 통과했다. Auth가 발급한 로컬 소유자·타인 세션 통합 `db:praise-test` 12/12에서 개인 칭찬 생성/재시도/입력 충돌·수정/취소·직접 테이블 거절·동시 회차 경계·과거 회차 취소·다음 회차 설정 적용·목표 완료/재개·UTC 분당 20/일 300 제한·완성 실패 시 칭찬/회차/영수증/쿼터 전체 롤백과 같은 키 재시도를 확인했다. ON CONFLICT 알림 probe, 테스트 계정/세션 정리, 기존 fixture 보존도 통과했다. 기존 W06-B1 목표 세션 회귀 12/12와 W06-A 세션 회귀 27/27을 다시 통과했다.

`check`는 lint 22개, typecheck, 단위 32/32 및 43개 계획 TC의 정적 링크/참조 검사를 통과했고 offline `build:check`도 Next 16.4.0으로 통과했다. TC-DB-PRAISE-001·TC-DB-CYCLE-001·TC-DB-RATE-001을 통과로 기록한다. 업무 UI/BFF는 아직 미구현이므로 제품 수락 36개와 실제 Google/OTP 로그인은 여전히 실행 0개다. 연결/판 권한/공유 칭찬 W06-C와 소식·삭제 W06-D는 남아 있다. [세부 증거](reports/w06-b2-personal-praise-check-2026-10-08.json)

## W06-C1 초대·연결 요청·관계 수명주기 검사

2026-10-08 PostgreSQL 17.11 로컬 DB에 `20261008021800`~`20261008022100`을 순서대로 적용했다. 14개 SECURITY DEFINER RPC와 초대 해시/코드 정규화, 24시간 미리보기·소비, 멱등 요청, 승인/거절/취소, 연결 세대·해제·차단/해제, 관계 projection을 구현했다. DB `db:test` 135/135(물리 51, 경계 21, 업무 권한/RLS 63), RPC 전용 `db:rpc-test` 84/84, 연결 Auth 발급 세션 통합 `db:connection-test` 13/13과 신규 관계 권한 pgTAP 19/19를 통과했다. 동일 초대·역방향 요청 경합, 요청 일일/15분 제한, 연결 200개 상한의 병렬 승인, 재연결 generation 증가 및 fixture/세션 정리를 확인했다. 기존 W06-A 세션 27/27, 목표 12/12, 개인 칭찬 12/12 회귀도 통과했다.

적용 뒤 결함 세 건을 후속 migration으로 고쳤다. `jsonb_object_length`가 PostgreSQL에 없어 `jsonb_object_keys`를 사용하고, 요청/수락 알림 ON CONFLICT의 제안 행 SELECT RLS를 전이 당사자로 한정했다. 수락 알림은 `notifications_typed_target`의 단일 대상 제약에 맞춰 request ID 대신 connection ID를 저장한다. W06-B2 임시 알림 probe는 PostgREST schema reload가 필요해 테스트 생성·제거 뒤 캐시 갱신을 넣었다. 적용된 파일은 수정하지 않았다. [상세 증거](reports/w06-c1-connection-rpc-check-2026-10-08.json)

TC-DB-CONNECT-001~004는 통과했다. 업무 UI/BFF가 없으므로 제품 연결 흐름 TC-CONNECT-001~003은 미실행이며 완료 처리하지 않는다. W06-C2 공유판 권한/칭찬은 완료했고 W06-D 소식·삭제가 남아 있다. 실제 Google/OTP 로그인도 미검증이다.

### W06-C1 관계 목록 cursor 경계 보완

W06-C2 목록 검증 중 C1의 연결·초대·요청·차단 목록이 `limit+1` lookahead 행을 다음 페이지 cursor로 사용해 페이지 사이 첫 항목을 건너뛸 수 있음을 확인했다. C2의 공통 cursor 인코더 줄바꿈 수정과 별도로 `20261008023000_connection_list_cursor_boundary_fix.sql`에서 네 RPC 모두 마지막 반환 행의 `(created_at,id)`를 사용하게 했다. 기존 적용 마이그레이션은 바꾸지 않았다.

`db:connection-test` 13/13에서 실제 발급 사용자 세션으로 초대 5개·요청 목록 3개 이상·연결 200개 이상·차단 5개를 각각 끝까지 페이지 탐색해 기대 ID 집합과 일치하고 중복/누락이 없음을 확인했다. `db:rpc-test` 110/110, `db:test` 161/161, 관계 cursor pgTAP 20/20도 통과했다. fixture 보존 및 합성 계정/세션 정리 통과, 실제 provider 로그인 0회다. [세부 증거](reports/w06-c1-cursor-pagination-check-2026-10-08.json)

## W06-C2 공유판 권한·공유 칭찬 원자성 검사

2026-10-08 PostgreSQL 17.11 로컬 Supabase에 `20261008022200`~`20261008022900`을 순서대로 적용했다. 오너 전용 grant/revoke, 연결 세대 스냅샷과 공유 상태의 안전 projection, 오너/기여자 역할별 목록, 공유 칭찬 기록·영수증·회차·집계·알림을 트랜잭션 RPC로 구현했다. 개인 목표/개인 칭찬 집계는 공유판과 분리한다. 적용된 마이그레이션은 수정하지 않았다.

`db:test`는 160/160(물리 51, RPC 경계 21, 업무 권한/RLS 88), `db:rpc-test`는 109/109, 공유판 전용 pgTAP은 25/25를 통과했다. Auth가 실제 발급한 로컬 오너·기여자·무관 사용자 세션 통합 `db:shared-test` 6/6에서 안전 projection, 권한 부여/회수, 역할별 목록, 멱등 공유 칭찬, 회차 완성/알림, 개인판과 독립된 개수, 판별/분당/일일 제한, 실패 전체 롤백, 50명 상한 경합, revoke/disconnect/block 대 praise 경합 및 재연결 재부여를 확인했다. probe 세션/계정 제거와 기존 fixture 보존이 통과했다. 실제 Google/OTP 로그인을 실행하지 않았다. [세부 증거](reports/w06-c2-shared-board-rpc-check-2026-10-08.json)

TC-DB-SHARED-001~004는 통과했다. 제품 수락 TC 36개, 실제 로그인 및 BFF/API 실행은 계속 미실행이다. C1 관계 목록도 후속 커서 마이그레이션과 실제 다중 페이지 검사로 보완했다. 소식·계정 삭제 RPC는 W06-D에 남아 있다.

## W06-D1 소식·보낸함·목표 휴지통/파기 경계 검사

W06-D1 전용 pgTAP `007_business_rpc_lifecycle.test.sql`은 20/20, 실제 Auth 발급 로컬 세션 통합 `db:lifecycle-test`는 4/4를 통과했다. 통합 검사는 최소 소식 projection·수신자/대상 권한·읽음 재시도·보낸 peer 칭찬 cursor·연결 해제 이후 접근·목표 휴지통/복구와 멤버 권한 회수·만료 후 복구 거절·원장 gate 거절·FK 의존 정리를 확인했다. 기존 fixture 보존, 합성 계정/세션 정리도 통과했다. 원장 gate를 합성으로 켠 단계는 로컬 DB의 동작 검사이고 독립 저장소 구성이나 운영 파기 완료가 아니다. [증거](reports/w06-d1-news-and-purge-check-2026-10-08.json)

OpenAPI에는 DB RPC가 구현됐고 서버 API 연결이 남았다고 기록했다. `TC-DB-NEWS-001~002`와 `TC-DB-DELETE-001~002`를 통과로 기록한다. 제품 수락 36개·백업 복원·실제 Google/OTP 로그인은 미실행이다.

## W06-D2 재인증·계정 파기·Auth 최종 삭제 검사

`db:rpc-test`는 162/162, 전체 `db:test`는 213/213(물리 51·RPC 경계 21·업무 RPC 141)을 통과했다. D2 pgTAP `008_business_rpc_account_deletion.test.sql`은 32/32, Auth가 실제 발급한 probe 세션과 로컬 Auth Admin을 사용한 `db:deletion-test`는 6/6을 통과했다. D1 `db:lifecycle-test` 4/4도 최종 전체 스키마에서 다시 통과했다. `scripts/project.ps1 -Task check`는 lint·typecheck·단위 32/32·정적 산출물 57개 상호참조를 통과했다.

통합은 외부/만료/다른 scope·session grant 거절, 같은 키 재시도·입력 충돌, 접수 즉시 접근 중단, worker 외부 원장 gate 거절, 주입 오류의 전체 rollback, 작성자 이벤트 수 보존과 개인 필드 scrub, Auth 삭제 실패 checkpoint·동일 ledger reference retry·최종 Auth 제거, UUID 재가입 차단, 수신자 소유 데이터/FK 정리를 확인했다. 임시 Auth 사용자·세션은 제거됐고 원래 fixture는 보존됐다. gate 활성화는 폐기 가능한 로컬 DB에서 합성한 동작 검사이며 실제 독립 원장은 미설정이다. [증거](reports/w06-d2-account-deletion-check-2026-10-08.json)

`TC-DB-DELETE-003~004`를 통과로 기록한다. 제품 수락 TC 36개, BFF/API·UI·Google/OTP 로그인·스테이징/운영 원장·백업 복원은 미실행이거나 미설정이다. 이에 따라 W06 DB 작업만 완료했고 다음 W07 서버 API 구현과 오픈 전 W12/W13 실제 인증 검증은 별도다.

## W07-A 로컬 세션 /me API 검사

서버 전용 adapter가 loopback 개발 환경의 `LOCAL_DEV_ACTOR` A/B/C를 읽고, 보호된 fixture manifest의 합성 계정으로 Supabase Auth가 발급한 실제 로컬 세션을 준비·검증한다. 같은 세션으로 `get_me` RPC를 호출하고 DB RLS 결과를 OpenAPI `Me` 필드 allowlist로 응답한다. actor 선택에는 query·header·Authorization을 사용하지 않으며 JSON 응답에는 세션 token이나 fixture 자격증명을 포함하지 않는다.

`scripts/project.ps1 -Task api:me-test`를 A/B/C 각각 실행해 각 5/5 확인을 통과했다. `scripts/project.ps1 -Task check`는 Biome 30개 파일, typecheck, 단위 37/37, 산출물 교차참조 58 TC·691 OpenAPI refs·179 등록 경로를 통과했다. `scripts/project.ps1 -Task build:check`도 통과했고 GET `/api/v1/me`는 동적 route로 컴파일됐다. TC-API-001을 통과로 기록한다. 제품 수락 TC 36개와 실제 Google/OTP 로그인을 대신하지 않으며, 배포 세션 adapter·CSRF/변경 요청 경계·제품 UI는 후속 작업이다. [세부 증거](reports/w07-a-local-me-api-check-2026-10-08.json)

## W05 물리 DB의 부분 검사

2026-10-08 물리 스키마·ERD 컬럼 일치·초기 데이터 준비·pgTAP 51/51·준비 기록 단위 검사 5개(기존 환경/포트 포함 32/32)·빌드·잠금 파일을 확인했다. 준비 명령 재실행의 데이터 보존과 잘못된 환경 3개의 실제 거절을 추가 확인했다. [DB 검사 증거](reports/physical-database-check-2026-10-08.json). W06-A 검사 전 단계의 범위다. 현재 두 기술 TC만 추가로 실행했으며 제품 업무·동시성·전체 API/E2E·실제 로그인 검사는 남아 있다.
