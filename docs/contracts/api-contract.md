# API 계약과 구현 규칙

버전: 0.2.0 / 상태: GET /me·목표·개인 칭찬 목록/생성/수정/취소·상태 전이·판 설정·회차 목록의 로컬 API 구현·검증, 공유 peer 쓰기와 W08-D 이후 계약은 구현 전 / 기준: [OpenAPI](../../contracts/openapi.json)

OpenAPI 3.1.0 JSON으로 요청·응답·경로·오류를 정의했다. 서버 주소는 동일 출처 /api/v1이다. W07-A에서 GET /me, W07-B에서 개발용 GET /auth/csrf와 mutation 검증 기반, W08-A/B1/B2에서 목표·판 API, W08-C에서 칭찬 목록·개인판 생성·수정·취소 API를 로컬 fixture Auth 세션에 연결했다. 칭찬 route는 GET/POST `/boards/{board_id}/praises`, PATCH `/praises/{praise_id}`, POST `/praises/{praise_id}/cancel`이다. 개인 생성은 멱등 키를 요구하며 회차 ID를 결과에 반환한다. 공유 peer 쓰기·숨김·제외는 W09에 연결한다. 목표·회차·칭찬 목록은 기본 20·최대 50개이며 cursor는 해당 목표 필터 또는 판에 적용한다. 배포 Auth flow/session binding은 W12다. operation의 x-requirements·x-policy-ids·x-test-cases로 요구·정책·검증을 추적한다. [OpenAPI 공식 사양](https://spec.openapis.org/oas/v3.1.0.html)

개발 중에는 [로컬 사용자 해석기](../development/local-development.md)가 가상 Auth 세션을 서버에서 준비한다. 아래 공개 인증·쿠키 계약을 변경하거나 클라이언트 actor 입력을 추가하지 않는다. 실제 Google/OTP 인증 API와 사용자 로그인 검증은 [진행표](../development/backlog.md)의 W12/W13에서 수행한다.

## 입력·응답

모든 변경 API는 application/json과 X-CSRF-Token을 요구한다. 본문이 없는 명령도 빈 JSON 객체를 보낸다. W07-B의 `validateMutationRequest`는 Origin·Fetch Metadata, signed CSRF cookie/header 일치, JSON object, 정책의 실제 바이트 상한을 확인한다. 새 mutation route는 업무 검증 전에 이 공통 guard를 호출해야 한다. CookieSession은 서버 관리 grape_auth를 기본 이름으로 하며 SDK의 분할 쿠키를 서버에서 조립·갱신한다. 클라이언트는 Auth 토큰을 직접 읽거나 JSON으로 받지 않는다.

쿠키 이름은 Supabase SSR의 cookieOptions.name으로 지정하고, 각 요청마다 서버 클라이언트를 만든다. 실제 고정 SDK 버전에서 분할·갱신·HttpOnly와 no-store를 인증 spike로 확인한다. [Supabase SSR 서버 코드](https://github.com/supabase/ssr/blob/main/src/createServerClient.ts)

정해진 필드만 받고 알 수 없는 필드를 거절한다. owner/actor/recipient·bunch·count는 클라이언트 입력 대상이 아니다. null·생략·빈 문자열의 의미와 정규화는 제품 정책을 따른다. 제목·문구 길이는 코드 포인트 기준이다.

본인 개인판과 지인의 공유판 응답을 oneOf와 viewer_role로 구분한다. ContributorBoard에 개인 goal_id·설명·개수·멤버 목록을 넣지 않는다. PraiseContributor·SentPraise에는 수신자의 hidden/excluded 상태를 넣지 않는다. 화면에서 숨기기 전에 응답 자체를 제한한다.

## 생성과 재시도

목표·공유판·칭찬·연결 요청·계정 삭제 접수는 Idempotency-Key UUID를 요구한다. 사용자·업무 종류·키를 유일하게 관리하고 정규화 입력 해시에 경로 대상 ID와 의미 있는 입력을 넣는다. 서버 시각·새 ID·검증 당시 개수는 해시에 넣지 않는다.

같은 키/같은 입력은 같은 결과 ID와 replayed=true, 같은 키/다른 입력은 409다. 생성은 최초·재시도 모두 계약의 성공 상태로 반환한다. 실제 권한이 회수되면 기존 성공 요청이어도 현재 허용 범위에서만 응답한다. 상대 정보를 재생해 노출하지 않는다.

칭찬은 ID·회차 ID만 반환하고 현재 개수는 재조회한다. 취소·숨김·제외의 반복은 한 번의 상태 효과만 있고 결과에는 상대의 현재 개수가 없다. 목표 수정은 expected_revision을 요구한다.

초대 발급은 원문 비밀을 DB에 보관하지 않으므로 성공 응답을 재생하는 방식의 중복 키 계약에서 제외한다. 발급 결과가 불확실하면 비밀 없는 초대 목록을 확인하고 필요 없는 초대를 폐기한 뒤 새 초대를 만든다. 보관하는 것은 비밀 해시뿐이다.

계정 삭제 접수 후는 deleting·세션 폐기로 추가 접근이 거절될 수 있다. 재시도 때문에 새 삭제 작업을 생성하지 않는다. 202는 접수·접근 중단이며 물리 삭제 완료가 아니다.

## 인증 흐름

GET /auth/csrf는 no-store 응답과 HttpOnly/SameSite 쿠키로 서명 토큰을 준비한다. 개발 모드는 서버 프로세스 전용 키를 사용한다. 현재 배포 route는 로그인 flow/session과 토큰을 결합하지 않으므로 배포에서는 503으로 닫혀 있고, session-bound 동작은 W12에서 구현한다. Google start는 서버 PKCE URL을 반환하고 GET callback은 서버 흐름 쿠키·PKCE를 검증한 뒤 허용된 앱 경로로 303 복귀한다. next는 /goals·/connect·계정 설정 같은 등록된 내부 경로만 허용한다. /signup·삭제 진행 안내는 서버가 계정 상태로 선택하고 클라이언트 next만으로 가입 확인을 건너뛰지 않는다.

이메일 start는 CAPTCHA·제한 후 계정 존재 여부와 무관한 같은 안내를 반환한다. 서버는 flow_id·이메일·next·만료를 묶어 검증하며 verify로 UUID를 확인한다. 응답의 account_state는 signup_required/active/deleting이며 새 사용자는 /signup, 기존 사용자는 허용된 원래 목적지로 안내한다. Auth 결과에 access/refresh token을 반환하지 않는다.

Auth 성공은 앱 계정 생성을 자동 실행하지 않는다. bootstrap은 검증된 Auth 세션과 아직 없는 app_users를 처리하는 예외 초기화 경로이며 adult_confirmed=true·registration_policy_version을 명시적으로 요구한다. 새 계정은 현재 버전을 검사하고 서버 UTC 확인 시각과 버전을 계정·프로필과 함께 원자적으로 기록한다. 기존 active 계정 재시도는 원래 확인 기록을 반환하고 덮어쓰지 않는다. deleting 계정을 되살리지 않는다. 형식에 맞는 이전 정책 버전의 새 가입은 409 POLICY_VERSION_CHANGED, 확인 누락·false는 400 INVALID_INPUT이다.

일반 /me·제품 API는 active 계정을 요구한다. 검증된 Auth 세션에 app_users가 없으면 403 REGISTRATION_REQUIRED로 /signup 안내를 제공한다. Auth가 없거나 현재 세션이 무효이면 401이다. 가입 미완료 정리 표시가 있으면 bootstrap을 거절한다. /signup 자체와 로그아웃·세션 갱신은 새 사용자가 필요한 제한 경로이며 제품 권한을 열지 않는다.

reauth는 현재 세션·UUID·account.delete에 묶인다. 이메일은 검증된 본인 주소로만 발송한다. Google 콜백도 기존 UUID를 확인하며 다른 계정으로 현재 세션을 바꾸지 않는다. grant ID·기한만 확인하고 10분·한 번 소비를 DB에서 적용한다.

## 권한·페이지·오류

목표·판·회차·칭찬은 현재 권한을 확인한 뒤 조회한다. 회차 query는 해당 판 소속이어야 한다. include_hidden은 주인만 허용한다. 휴지통은 본인만이며 일반 조회와 별도다.

목록 기본 20건·최대 50건, 안정적인 recorded/created 시각과 ID 또는 cycle_no·ID 순서를 사용한다. 목표 목록은 created_at·ID 역순 keyset cursor를 쓰고 cursor에 status 필터를 포함해 다른 필터에서 재사용할 수 없게 한다. 회차 목록은 cycle_no·ID 역순 keyset cursor를 쓰고 cursor에 board ID를 포함한다. 소유자 또는 현재 유효한 공유판 구성원만 조회할 수 있으며, 응답은 회차 요약 필드로 제한한다. 각 커서는 해당 목록·필터·판에만 적용한다. 요청 키·정렬·cursor를 사용자가 준 SQL로 합성하지 않는다.

| 상태 | code 예 | 처리 |
| --- | --- | --- |
| 400 | INVALID_INPUT | 허용 필드·값 검증 |
| 401 | AUTH_REQUIRED | 로그인·현재 세션 필요 |
| 403 | ACTION_FORBIDDEN / REGISTRATION_REQUIRED | 볼 수 있는 객체의 금지 행동 / 검증된 Auth 사용자의 앱 가입 미완료 |
| 404 | OBJECT_NOT_AVAILABLE | 없음과 접근 불가의 같은 응답 |
| 409 | STATE_CONFLICT / REVISION_CONFLICT / IDEMPOTENCY_CONFLICT / RESOURCE_LIMIT_REACHED / POLICY_VERSION_CHANGED | 최신 상태 확인 또는 입력 변경 |
| 413 | PAYLOAD_TOO_LARGE | 32KB 본문 상한 |
| 429 | RATE_LIMITED | Retry-After 초 안내 |
| 503 | DEPENDENCY_UNAVAILABLE | 중요 요청의 필수 제한 저장소 장애 |
| 500 | INTERNAL_ERROR | 요청 ID로 문의, 내부 상세·본문·비밀 비노출 |

성공·오류에는 X-Request-ID와 no-store를 적용한다. error.code·message·request_id만 기본 노출하며 제한에는 retry_after_seconds를 추가한다. 계약의 오류 목록은 공통 가능한 형식이며 모든 경로에서 모든 오류를 실제 발생시킨다는 뜻은 아니다.

## DB 구현 전에 대응할 것

GET은 사용자 세션과 RLS/제한 projection, 변경은 지정 업무 RPC로 매핑한다. bootstrap·Auth 호출·삭제 작업의 관리 경계는 일반 제품 DML과 분리한다. 원자성·잠금 순서·FK·공개 범위는 ERD·정책·TC에 맞춰 구현한다.

현재 검사는 JSON 형식·로컬 참조·ID 중복·필수 경로 인자·요구/TC 연결·정책 수치와 응답 경계 확인 범위다. 실제 스키마 validator·타입 생성·서버 계약 테스트·DB 검증은 개발 기반이 준비된 뒤 수행한다. 검사 결과는 [산출물 검사 기록](../quality/reports/2026-10-07-baseline.md)에 남긴다.
