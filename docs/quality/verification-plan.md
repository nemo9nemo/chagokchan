# 검증 계획과 증거 기준

버전: 0.2.0 / 상태: 계획·기술 TC 일부 실행 / 갱신일: 2026-10-08

[테스트 케이스](test-cases.json)에 69개 시나리오를 입력·기대 결과·요구·정책 ID로 기록했다. 제품 수락 시나리오 36개는 아직 미실행이며 W06~W10-B의 기술 TC 31개는 각 범위별 근거에 따라 통과 처리했다. 정책·문서 검사 결과는 [기준 산출물 검사 기록](reports/2026-10-07-baseline.md)과 분리한다.

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

## W07-B CSRF·동일 출처·본문 크기 요청 guard 검사

`GET /api/v1/auth/csrf`는 로컬 프로세스 키로 만료가 포함된 HMAC 토큰을 발급하고 HttpOnly·SameSite=Lax·API 경로 범위 cookie와 no-store·request ID를 반환한다. 배포 모드에서는 flow/session binding이 구현될 때까지 endpoint가 닫혀 있다. `validateMutationRequest`는 Origin·Sec-Fetch-Site·application/json·서명된 cookie/header 이중 제출·JSON object와 `policies/app-policy.json`의 실제 32KB byte 상한을 검증한다. 배포 실행은 환경별 32바이트 이상 `CSRF_SIGNING_SECRET`을 요구하고 local key/manifest를 거절한다.

`scripts/project.ps1 -Task api:security-test`는 HMAC 변조·만료·다른 key·cross-site/Origin·CSRF 불일치·비JSON·잘못된 JSON·실제/선언 본문 크기 경계를 14/14 통과했다. `api:me-test` A/B/C 각각 15/15에서 /me와 CSRF 응답의 쿠키·헤더를 확인했다. `check` unit 53/53과 build:check를 통과했다. TC-API-002는 통과로 기록한다. mutation 업무 route는 아직 없으며 구현 시 이 guard를 첫 경계로 붙인다. 배포 session-bound CSRF는 W12이고 제품 업무 API는 W08~W10이다. [세부 증거](reports/w07-b-api-security-check-2026-10-08.json)

## W08-A 목표 생성·상세·수정 API 경계 검사

`POST /api/v1/goals`, `GET /api/v1/goals/{goal_id}`, `PATCH /api/v1/goals/{goal_id}`를 기존 `create_goal`·`get_goal`·`update_goal` 업무 RPC에 연결했다. 목표 변경 route는 `validateMutationRequest`의 Origin·Fetch Metadata·CSRF·JSON/32KB 경계를 업무 입력 검사 전에 통과해야 한다. client actor/owner/recipient 입력은 거절하고, 결과를 OpenAPI allowlist로 축소하며 모든 응답은 no-store·request ID를 반환한다. 당시 목표 목록은 DB `listGoals` RPC가 없어 포함하지 않았고, 다음 W08-B1에서 추가했다.

새 `scripts/goal-api.test.mjs` 8/8은 기본값·공유 입력·멱등 키·알 수 없는 입력 거절·RPC 인자·CSRF 선행 검사·응답 projection·404/409 안전 변환을 확인했다. 실제 A/B/C Auth session API 검사는 각 3/3으로 임의 UUID의 비공개 404, 잘못된 경로 UUID 400, CSRF 없는 생성 거절 403을 확인했다. 해당 API integration은 DB 쓰기를 하지 않는다. `scripts/project.ps1 -Task build:check`에서 세 route가 dynamic Node.js API로 컴파일됐다. 전체 `check`는 Biome·typecheck·unit·산출물 검사를 다시 실행해 이 변경 범위의 최종 상태를 남긴다. `TC-API-003`은 이 제한된 handler/경계 범위만 통과이며 실제 생성·수정 route→DB 성공과 제품 화면/수락 검사는 미실행이다. [세부 증거](reports/w08-a-goal-api-check-2026-10-08.json)

## W08-B1 목표 목록·status-bound cursor RPC/API 검사

`20261008024300_goal_list_rpc.sql`에서 owner 전용 `list_goals(text,integer,text)`와 내부 cursor helper를 추가했다. PostgreSQL `encode(...,'base64')`가 긴 값에서 줄바꿈을 생성해 API cursor 제한에 걸린 결함을 확인해, 적용 migration은 수정하지 않고 `20261008024400_goal_list_cursor_base64_wrap_fix.sql` 후속 migration에서 줄바꿈을 제거했다. 목록은 삭제되지 않은 본인 목표 요약 필드만 반환하고 created_at·ID 내림차순 keyset으로 이어 간다. cursor에는 필터 상태를 포함해 다른 status에 재사용할 수 없다.

GET `/api/v1/goals`는 기본 20·최대 50, `active|completed|archived` 필터, cursor 길이/중복 query parameter 검증과 RPC 응답 allowlist를 적용한다. 신규 DB test `009_business_rpc_goal_list.test.sql` 9/9 및 전체 DB 222/222를 통과했다. 실제 로컬 Auth-issued owner probe에서 페이지 끝까지 ID 중복·누락 없음, status 필터, 다른 필터의 cursor 거절, malformed cursor/page/status 거절, 타인 빈 목록 및 직접 테이블 읽기 거절을 5/5 확인했다. probe 계정/세션은 제거했고 기존 fixture를 보존했다. A/B/C API 각 3/3은 기본 목록·허용 필터·잘못된 status/limit를 확인했으며 DB 쓰기는 없었다.

`TC-API-004`는 cursor 쿼리·projection 단위 검사, RPC 권한/페이지 pgTAP, 실제 Auth session 통합과 A/B/C API 검증으로 통과 처리한다. 전체 `check`·`build:check` 최종 출력과 SHA-256 source basis는 [W08-B1 증거](reports/w08-b1-goal-list-check-2026-10-08.json)에 함께 기록한다. W08-B2 상태/설정/회차 API, W08-C 개인 칭찬 API 및 화면은 이 완료 범위에 포함하지 않는다.

## W08-B2 목표 상태·판 설정·회차 목록 API 검사

완료·보관·재개 POST는 `complete_goal`·`archive_goal`·`resume_goal`을, 판 설정 PATCH는 `update_board`를 호출한다. 모든 변경은 CSRF/Origin/JSON guard 뒤 revision과 고정 필드를 검사한다. 새 `list_bunches` RPC와 GET `/api/v1/boards/{board_id}/bunches`는 판 소유자 또는 현재 권한이 유효한 공유 구성원만 허용하고, cycle_no/ID 내림차순의 board-bound keyset 페이지와 회차 요약 allowlist를 반환한다. 공유판 설정은 owner만 바꿀 수 있으며 다음 회차 목표 수 변경이 이미 생성된 회차 snapshot을 소급 변경하지 않는다.

새 `010_business_rpc_bunch_list.test.sql`은 SECURITY DEFINER 소유자·고정 search_path·열 권한·authenticated-only 실행 및 helper 비노출 등 9/9 통과했다. 전체 `db:test`는 231/231(물리 51·RPC 경계 21·업무 RPC 159), `db:rpc-test`는 180/180을 통과했다. 실제 Auth 발급 owner/outsider 세션 probe 6/6에서 revision 충돌, 다음 회차 target snapshot, 회차 페이지 연속성·cursor 타 판 거절·malformed/page size 거절, 완료/보관/재개 후 상태 및 회차 불변, 무관 사용자와 직접 table read 거절을 확인했다. 임시 계정과 session을 제거하고 기존 fixture 및 session count를 보존했다. 로컬 A/B/C API 경계 검사는 각 8/8로 서버 actor 고정, 각 변경 route의 CSRF 선행 차단, 잘못된 board ID/page size, 접근 불가 board의 숨김 404/no-store를 확인했으며 DB mutation은 없다.

전체 `check`는 Biome·typecheck·unit 69/69·산출물 상호 참조를 통과했고 `build:check`는 신규 5개 동적 route를 컴파일했다. `TC-API-005`를 통과로 기록한다. W08-C 개인 칭찬 API, W08-D UI, 제품 수락 TC와 실제 Google/OTP 로그인은 여기 포함하지 않는다. 실행 결과와 source SHA-256은 [W08-B2 증거](reports/w08-b2-goal-lifecycle-api-check-2026-10-08.json)에 기록한다.

## W08-C 개인 칭찬 목록·생성·수정·취소 API 검사

GET/POST `/api/v1/boards/{board_id}/praises`, PATCH `/api/v1/praises/{praise_id}`, POST `/api/v1/praises/{praise_id}/cancel`을 연결했다. 각 mutation은 업무 검증 전에 동일 출처·CSRF·JSON guard를 거치며 본문/날짜/Idempotency-Key/query와 response allowlist를 검사한다. 목록 응답은 owner와 contributor shape를 분리하고 contributor에게 작성자 신원·실천일·숨김/제외/author erased 필드를 주지 않는다. 공유 peer 생성과 숨김/제외는 W09 범위다.

기존 `create_praise`의 원자적 transaction은 회차 ID를 반환하지 않는다. 이미 적용된 migration을 수정하지 않고 `create_personal_praise` wrapper migration `20261008024600`을 추가했다. wrapper는 기존 생성 RPC의 결과 ID로 현재 actor·board·self source 행을 찾고 그 불변 bunch ID를 응답한다. 신규 `011_business_rpc_personal_praise_result.test.sql` 6/6, 전체 `db:test` 237/237(물리 51·RPC 경계 21·업무 165), `db:rpc-test` 186/186을 통과했다.

실제 Auth-issued owner probe 3/3에서 정확한 bunch 결합, 동일 키 재시도 ID·cycle 유지와 집계 중복 방지, 임의 board의 hidden 404를 확인했다. synthetic account/session을 제거하고 원래 fixture 및 session count를 보존했다. A/B/C 로컬 API 경계는 각 10/10으로 actor 고정, invalid board/query, create/edit/cancel CSRF, 유효 CSRF 뒤 없는 대상의 안전 404를 확인했다. unit 79/79, Biome·typecheck, 산출물 교차 참조, build:check가 통과했다. `TC-API-006`은 API handler·RPC result 경계의 기술 검사만 통과로 기록한다. 제품 수락 TC, W08-D UI, 실제 Google/OTP 로그인은 미실행이다. 결과와 SHA-256 source basis는 [W08-C 증거](reports/w08-c-personal-praise-api-check-2026-10-08.json)에 남긴다.

## W08-D 목표·개인 기록 기본 UI 검사

UI02~UI05 기본 화면을 server API에 연결했다. 목록은 소유 목표 상태와 개인/공유판 개수를 각각 표시한다. 상세는 개인 기록과 받은 칭찬을 판별로 나누며 지난 회차를 읽기 전용으로 선택한다. 목표 생성·목표 정보 수정·판별 다음 목표 설정·완료/보관/재개, 개인 칭찬 생성·수정·취소 폼을 제공한다. 첫 칭찬 전 `current_bunch`가 없어도 개인 입력 폼을 표시하도록 확인했다.

로컬 Auth A 세션을 사용한 브라우저 조회 smoke에서 목표 목록·상세, 회차/칭찬 읽기, 개인/공유 전환, empty state, 선택 공유판 입력 필드, 목표·판 설정 필드를 확인했다. smoke는 GET과 폼 열기만 수행했고 기존 fixture의 제품 데이터를 쓰지 않았다. `TC-UI-003`은 이 범위로 통과 처리한다. 전체 `check`의 Biome·typecheck·unit 82/82·산출물 구조 검사와 `build:check`가 통과했다. Idempotency-Key와 요청 본문 재사용은 별도 unit 3개에서 확인한다.

실제 UI 폼 submit 후 성공 화면/상태 반영, 전송 중 네트워크 단절 및 같은 키의 재시도는 브라우저 E2E로 실행하지 않았다. 제품 fixture 쓰기를 보존하기 위한 제한이다. 실제 성공 경로의 낮은 계층 근거는 W08-C Auth/RPC 3/3, 재시도 상태 helper는 W08-D unit 3/3이다. TC-UX-001/002, 실제 기기·스크린리더·PWA/캐시, 실제 Google/OTP 로그인 및 전체 제품 수락 검사는 계속 미실행이다. [W08-D 검사 증거](reports/w08-d-goal-record-ui-check-2026-10-08.json)

## W09-A 초대·연결 요청·차단 API 경계 검사

연결·초대·요청·차단의 14개 HTTP method 경로를 기존 W06 업무 RPC에 연결했다. 목록 응답은 connection/invite/request/block의 최소 필드만 투영하고 cursor/limit/direction 및 중복·미지원 query를 검사한다. 초대 코드는 구분자를 제거하고 대문자로 정규화한다. 비밀은 preview/request RPC에 전달하지만 목록·로그에는 저장하거나 반환하지 않는다. 초대 비밀을 포함한 새 요청은 Idempotency-Key를 사용하고, 모든 변경은 Origin·CSRF·JSON byte guard 후 RPC를 호출한다. 초대 발급에는 secret 재생을 피하기 위해 멱등성 응답을 제공하지 않는다.

`scripts/connection-api.test.mjs` 8/8은 초대 secret 정규화, 응답 allowlist, query 경계, CSRF 선행 검사, request key, block 입력, 안전 오류 변환을 확인했다. `scripts/project.ps1 -Task api:connection-test`는 실제 local Auth 세션 A/B/C 각각 12/12를 통과했다. 각 actor에서 연결·초대·요청·차단 GET, 잘못된 페이지/actor query, CSRF 없는 발급 차단, malformed preview/request/block, 임의 연결 404/no-store를 확인했고 기존 fixture 쓰기는 0건이었다. 관계 업무 RPC의 실제 Auth 세션 13/13과 초대 소비·권한·재연결 경합 근거는 [W06-C1 증거](reports/w06-c1-cursor-pagination-check-2026-10-08.json)를 따른다.

새 `TC-API-007`은 handler 단위 및 A/B/C 로컬 API 경계 범위만 통과한다. 유효 초대 발급/소비·실제 요청 생성의 route→DB 성공은 제품 fixture 보호를 위해 여기서 실행하지 않았다. 공유판 grant/peer praise API는 W09-B에서 완료했고 UI는 W09-C에 남는다. check·build·source hash는 [W09-A 검사 증거](reports/w09-a-connection-api-check-2026-10-08.json)에 기록한다.

## W09-B 공유판 권한·peer 칭찬 API

W09-B는 `GET /boards/{board_id}`, `GET /members`, `PUT/DELETE /members/{user_id}`, 역할별 공유 칭찬 `POST /praises`, peer praise 숨김·해제·제외 route를 구현했다. endpoint는 로컬 Auth 세션과 기존 grant·revoke·get_board·member list·peer create/moderation 업무 RPC를 사용한다. owner/contributor 응답은 별도 allowlist를 적용하고 contributor에게 goal ID와 비공개 목표 필드를 노출하지 않는다. 모든 mutation은 Origin·CSRF·JSON body guard와 고정 인자 mapping을 거친다.

새 pgTAP `012_business_rpc_peer_praise_moderation.test.sql` 10/10과 전체 `db:test` 247/247을 통과했다. 실제 Auth 발급 합성 owner/contributor/outsider 세션 기반 `db:shared-test` 7/7은 명시적 grant/revoke, peer 작성 멱등성, hide/unhide 반복, exclude 반복·회차 개수 및 완료 상태 조정, 관계 회수/차단 경합을 확인했다. 계정·세션을 제거하고 기존 fixture snapshot을 보존했다. `api:board-test`는 local A/B/C 각각 12/12에서 owner/contributor projection 및 읽기 경계, C 거절, mutation CSRF 선행 차단을 확인했고 제품 fixture 쓰기 0건이다. API unit 99/99·Biome·typecheck·정적 검사·`build:check` 통과. 실제 API route mutation을 합성 세션으로 호출해 DB에 쓰는 통합과 제품 UI E2E·실제 로그인은 미실행이다. 상세 명령·소스 hash는 [W09-B 검사 증거](reports/w09-b-shared-board-praise-api-check-2026-10-08.json)를 따른다.

## W09-C 연결·공유 화면과 현재 grant 디렉터리

UI06 연결 센터에서 일회 초대 발급/미리보기, 요청 수락·거절·철회, 연결 해제, 차단/해제를 연결했다. 초대 fragment secret은 브라우저 주소에서 바로 제거하고 요청 성공·취소 뒤 탭 상태에서도 지운다. UI07은 목표 설정별 contributor grant/revoke를 활성 연결 사용자에게만 제공한다. UI08은 본인의 현재 유효 grant 공유판을 표시하고 해당 판에서만 peer 칭찬을 읽고 작성한다.

화면의 공유판 목록을 위해 `20261008024800_list_my_shared_boards_rpc.sql`과 GET `/api/v1/shared-boards`를 추가했다. DB는 호출자의 현재 연결 generation, 양방향 차단, 명시적 grant, 삭제 목표 상태를 매번 확인한다. 최대 50개 순서형 페이지와 contributor 최소 projection을 반환한다. UI 디렉터리도 이어보기 cursor를 사용한다.

신규 `TC-API-009`는 pgTAP 013 5/5, 전체 DB 252/252, 실제 Auth-issued 공유 RPC 통합 8/8, A/B/C board API 경계 각 14/14, unit 100/100으로 통과 처리한다. A/B/C API 검사는 기존 제품 fixture 쓰기 없이 종료했고 합성 probe 계정/세션 정리와 fixture snapshot 보존을 확인했다. Biome·typecheck·artifact check·`build:check`는 W09-C 완료 시 다시 실행해 보고서에 결과를 기록한다. UI 검사는 invalid synthetic invite token을 이용한 읽기 전용 UI06 렌더 smoke 한 건이며, 실제 초대·관계·grant·칭찬 mutation submit, 제품 수락, 스크린리더·기기 E2E, 실제 Google/OTP 로그인은 포함하지 않는다. [W09-C 검사 증거](reports/w09-c-shared-board-ui-check-2026-10-08.json)

## W10-A 소식·보낸 peer 칭찬 API 검사

`GET /notifications`, `PATCH /notifications/{notification_id}`, `GET /sent-praises`를 W06-D1의 recipient-scoped `list_notifications`, `mark_notification_read`, `list_sent_praises` RPC에 연결했다. 페이지는 cursor/limit 1~50을 제한하고, 소식 응답에 허용된 type·시각·read_at·target kind/ID만, 보낸함에는 작성자 본인 peer record의 ID·본문·기록/취소 상태만 allowlist한다. 읽음 변경은 Origin/CSRF/JSON guard 뒤 `{read:true}`만 받아 RPC의 반복 요청 결과를 반환한다.

신규 `TC-API-010`에 대해 handler unit 7/7, A/B/C 실제 local Auth API 각 11/11, 기존 W06-D1 실제 Auth session RPC 회귀 4/4, 전체 DB 252/252를 확인했다. A/B/C 검사는 목록 읽기·커서 입력·no-store·CSRF 없는 쓰기 거절과 임의 알림 404를 확인했고 제품 fixture를 변경하지 않았다. 전체 `check`와 `build:check` 결과 및 소스별 SHA-256은 [W10-A 검사 증거](reports/w10-a-news-sent-api-check-2026-10-08.json)에 기록한다. UI09 제출 흐름과 제품 수락 E2E는 아직 실행하지 않았으며 실제 로그인·재인증은 W12/W13이다.

## W05 물리 DB의 부분 검사

2026-10-08 물리 스키마·ERD 컬럼 일치·초기 데이터 준비·pgTAP 51/51·준비 기록 단위 검사 5개(기존 환경/포트 포함 32/32)·빌드·잠금 파일을 확인했다. 준비 명령 재실행의 데이터 보존과 잘못된 환경 3개의 실제 거절을 추가 확인했다. [DB 검사 증거](reports/physical-database-check-2026-10-08.json). 이 단락은 W06-A 이전 W05 부분 검사 기록이며, 이후 업무 DB/API 검증은 각 작업 단락과 진행표의 별도 증거를 따른다.
