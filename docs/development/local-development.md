# 로그인 없이 사용하는 로컬 개발

기준일: 2026-10-08 / 상태: 환경 차단·합성 Auth 초기 준비·물리 DB·W06-A 세션/get_me 경계·W07-A local /me·W07-B CSRF/요청 검증 기반 완료

사용자는 개발 중 로그인 화면 없이 앱을 이용하고, 실제 오픈을 준비하는 시점부터 로그인 테스트와 실사용을 진행한다. [개발 환경 정책](../../policies/development-policy.json)과 [ADR-0004](../decisions/ADR-0004-local-development-auth.md)가 이 결정의 기준이다. 출시용 [계정·권한 정책](../auth-and-permissions.md)과 제품 정책 버전은 유지한다.

## 사용자 경험과 서버 경계

개발 중 로그인 화면을 띄우지 않는다. W07-A에서 구현한 `GET /api/v1/me`는 가상 사용자 A/B/C 중 서버 환경의 `LOCAL_DEV_ACTOR`를 사용하며 기본값은 A다. B는 연결·공유 칭찬, C는 무권한 접근 거절 검증에 사용한다. 사용자 변경은 개발 서버 설정을 바꾸고 재시작한다. 요청 본문·쿼리·헤더에 들어온 사용자 UUID·역할·Authorization은 로컬 actor 선택에 사용하지 않는다. 목표 화면·제품 UI는 W08에서 구현한다.

서버의 사용자 해석 경계는 `local_fixture`와 `supabase_session`으로 분리한다. W07-A에서 전자는 로컬 전용 가상 Auth 계정으로 Auth가 실제 발급한 세션을 서버에서 준비하고, 그 세션으로 `get_me` RPC를 호출한다. 응답은 OpenAPI의 본인 최소 필드만 허용하고 no-store를 적용한다. W07-B는 로컬 개발의 signed double-submit CSRF, 동일 Origin·Fetch Metadata, JSON 형식과 본문 바이트 상한 검사 기반을 제공한다. 실제 로그인 flow/session binding과 배포 세션 경로는 W12에서 구현한다. 제품 변경 route는 이 공통 검증기를 사용해야 한다. 업무 API는 동일 RPC·RLS·집계 규칙을 사용한다. 테스트 JWT를 임의 서명하거나 일반 데이터 요청에 관리 키를 사용하지 않는다.

가상 Auth 계정 준비는 폐기 가능한 로컬 DB의 명시적인 초기 데이터 작업이다. 자격증명은 로컬에서 생성해 서버 전용 저장 위치에 두고 문서·Git·브라우저·로그에 노출하지 않는다. 자동 세션 준비에는 로컬 Auth의 테스트 계정 인증을 사용할 수 있다. 사용자가 수행하는 실제 Google/이메일 OTP 로그인은 출시 준비 단계로 미룬다. 삭제 중인 계정의 접근 검사와 현재 DB 세션 검사는 로컬에서도 유지하며, 서버 시작 때 삭제 계정을 다시 생성하지 않는다.

Supabase의 로컬 스택에는 PostgreSQL과 Auth가 포함되고 CLI·컨테이너 런타임으로 실행한다. [공식 로컬 개발 안내](https://supabase.com/docs/guides/local-development), [테스트 계정 세션 준비에 사용할 인증 API](https://supabase.com/docs/reference/javascript/auth-signinwithpassword)

## POL-DEV-001 — 로컬 무로그인과 배포 인증 분리

| 설정·검사 | 로컬 개발 | 배포 환경 |
| --- | --- | --- |
| `APP_AUTH_MODE` | `local_fixture` 명시 | `supabase_session` 명시 |
| 환경 | `APP_ENV=local`, `NODE_ENV=development` | Preview·staging·production 별도 설정 |
| 서버·DB 주소 | loopback에만 바인딩, 정책에 있는 로컬 DB 주소·포트 | 지정된 프로젝트와 HTTPS 주소 |
| 가상 계정 | 합성 A/B/C, 서버에서만 선택 | 가상 자동 로그인·자격증명 거절 |
| DB 권한 | 실제 로컬 사용자 세션·RLS·RPC | 실제 사용자 세션·RLS·RPC |
| 설정 오류 | 시작 실패, 다른 모드로 자동 전환 없음 | 빌드·시작·배포 검사 실패 |

`NODE_ENV` 하나만으로 허용하지 않는다. 환경, 인증 모드, 실제 바인딩 주소, 앱 URL, Supabase URL과 포트를 함께 확인한다. 로컬 개발 서버와 DB를 터널·공유 URL·외부 네트워크에 공개하지 않는다. 배포용 빌드에는 로컬 사용자 해석 경로가 연결되지 않게 하고, `local_fixture` 설정이나 가상 자격증명이 있으면 배포 전에 실패시킨다. 환경 변수명에 `NEXT_PUBLIC_`를 붙이지 않는다. [Next.js 환경 변수 안내](https://nextjs.org/docs/app/guides/environment-variables)

개발 설정은 `.env.development.local`에 준비했고 Git에서 제외한다. Next.js가 배포 빌드에서 읽는 환경 파일과 개발용 fixture 설정을 분리한다. [.env.example](../../.env.example)은 설정 템플릿이다. 환경 검사와 앱 기반은 [실행 방법](runtime-setup.md)·[검사 JSON](../quality/reports/foundation-check-2026-10-08.json)에 기록한다. A/B/C Auth 계정과 초기 데이터는 W05에서 [명시적인 로컬 준비](database-foundation.md)로 구현했다. W06-A에서 로컬 Auth가 발급한 현재 세션·계정 상태와 get_me 응답 경계를 DB에 적용하고 검증했다. Auth의 `sessions`·`users` 테이블은 관리 스키마이고 RLS가 활성화되어 앱 정책이 없다. 비로그인 `chagokchan_session_reader`는 필요한 Auth 메타데이터 열만 읽고 제품 테이블 권한은 갖지 않으며, API 역할이 이를 가정할 수 없다. 해당 역할의 SECURITY DEFINER 함수는 고정 `search_path`에서 세션·계정 상태만 확인한다. 자세한 권한 이유와 한계는 [ADR-0005](../decisions/ADR-0005-local-auth-session-reader.md), 실행 증거는 [W06-A 검사](../quality/reports/w06-a-session-boundary-check-2026-10-08.json)에 기록한다. 로컬 사용자 해석기·업무 API와 쓰기 RPC는 W06/W07에 남아 있다.

## DB와 검사 순서

1. ERD·키·제약·인덱스를 SQL 마이그레이션으로 작성한다.
2. 합성 Auth·앱 계정과 A/B/C 관계·권한 데이터를 로컬에 준비한다. 확인 기록은 가상 데이터이며 실제 사용자 동의의 증거가 아니다.
3. 업무 RPC·RLS·직접 접근 거절·중복·동시성·삭제 상태를 DB 수준에서 검증한다.
4. 서버의 로컬 사용자 해석기를 연결하고 개인 기능부터 화면·API를 구현한다.
5. W07의 로컬 세션·CSRF·요청 guard 기반 위에서 W08~W10의 기능 API·화면을 연결한다.
6. 출시 준비 때 실제 Google/OTP, 가입 확인, 세션 갱신·로그아웃·재인증·초대 복귀를 구현·검증한다.
7. 실제로 로그인한 여러 테스트 계정으로 권한·캐시·삭제 검사를 다시 실행한 뒤 공개한다.

개발용 세션이 작동해도 실제 OAuth·메일 전달·로그아웃·재인증·가입 화면 검사가 통과한 것으로 기록하지 않는다. 계정 삭제 같은 민감 흐름은 로컬에서 상태·작업 로직을 검사할 수 있지만 실제 재인증 수락 검사는 출시 준비 때 수행한다. 상세 작업 순서와 상태는 [진행표](backlog.md), 검사 시점은 [검증 계획](../quality/verification-plan.md)에서 관리한다.

W06-A의 로컬 DB 세션 검사는 고정 Node 환경의 Windows 실행 래퍼에서 `db:migrate`, `db:test`, `db:rpc-test`, `db:session-test`로 수행한다. 마지막 검사는 실제 Auth 발급 합성 세션만 사용하며, 관리 API 키는 일시적인 합성 probe 계정 생성·삭제에만 사용한다. 업무 RPC 호출과 probe 정리 뒤 앱 fixture 행과 기존 A/B/C 세션이 유지되는지 확인한다. 세션·계정 단위 검사로 실제 제공자 로그인이나 제품 업무 수락 검사를 완료한 것으로 간주하지 않는다.
