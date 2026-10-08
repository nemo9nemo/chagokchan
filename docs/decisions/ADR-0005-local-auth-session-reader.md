# ADR-0005 — 로컬 DB에서 현재 Auth 세션을 최소 권한으로 확인

- 상태: 채택
- 결정일: 2026-10-08
- 작업: W06-A
- 관련 요구·정책·검사: REQ-001, POL-ACCOUNT-002, POL-SEC-001, POL-DEV-001, TC-DB-SESSION-001

## 맥락

업무 RPC는 서명된 JWT의 사용자 ID만 믿지 않고 현재 `auth.sessions` 행·만료·비활성·provider `not_after`·`auth.users`의 삭제/정지 상태를 확인해야 한다. Supabase 관리 테이블 `auth.sessions`와 `auth.users`는 RLS가 켜져 있고 앱이 추가한 조회 정책이 없다. 로컬 마이그레이션 연결 역할은 `auth` 스키마의 소유자가 아니어서 별도 guard에 스키마 `USAGE`를 부여할 수 없다. 또한 RLS가 켜진 Auth 테이블은 일반 역할의 행 조회를 막는다.

따라서 일반 SQL `GRANT`만으로 별도 NOBYPASSRLS 역할이 Auth 세션을 읽을 수 있다고 가정할 수 없다. PostgreSQL 17.11의 로컬 권한·RLS 상태를 확인하고 실제 Auth 발급 세션 호출로 검증했다.

## 결정

`chagokchan_session_reader`를 `NOLOGIN`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`으로 만들고, Auth 관리 테이블 조회에 필요한 한정 열만 부여한다. Auth 테이블에 앱 RLS 정책이 없으므로 이 역할에만 `BYPASSRLS`를 둔다. `authenticated`의 `auth` 스키마 사용 권한과 Auth 함수 실행 권한은 상속하되 `SET ROLE authenticated`는 허용하지 않는다.

이 역할은 단일 `private.require_session_user()` SECURITY DEFINER 함수의 소유자다. 함수는 `search_path=pg_catalog`를 고정하고 `auth.jwt()`, `auth.uid()`, 관리 세션의 ID·사용자·생성/갱신/만료 시각, Auth 계정의 익명·삭제·정지 열만 검사한 뒤 인증 사용자 UUID만 반환한다. 사용자 API 역할은 이 역할의 구성원이 아니며, 이 함수의 직접 실행 권한도 갖지 않는다. 세션 검사를 호출하는 `chagokchan_guard`만 실행할 수 있다.

`chagokchan_session_reader`에는 제품 테이블 권한·쓰기 권한·스키마 생성 권한을 주지 않는다. `chagokchan_guard`는 별도 NOBYPASSRLS 역할로 제품 계정 상태와 교차 참조를 확인하고, `chagokchan_rpc`는 제한된 RPC 응답을 만든다. Auth 스키마는 PostgREST에 노출하지 않는다.

## 결과와 제한

- 사용자가 제공한 `actor UUID`나 만들어 낸 JWT가 아니라 Auth가 실제 발급한 현재 세션을 검증한다.
- 로그아웃한 미만료 JWT 재사용, 30일 세션 상한, 7일 비활성, `not_after`, 미가입·deleting·익명·정지·삭제 계정은 거절한다.
- `BYPASSRLS` 플래그는 이 비로그인 역할에만 있다. SQL 함수가 취약해지면 역할이 부여받은 Auth 열 범위 안에서 Auth 행을 읽을 수 있으므로 함수 본문·실행 권한을 제한하고 해당 역할이 제품 테이블을 읽지 못하는 검사를 유지한다.
- 사용자 로그인 제공자 연동, 업무 쓰기 RPC·집계·중복/동시성·권한 회수 경합은 이 결정이나 W06-A로 완료되지 않는다.

## 대안

JWT의 UUID만 확인하면 관리 Auth RLS와 충돌은 피하지만 로그아웃 뒤 아직 만료되지 않은 토큰을 거절할 수 없어 채택하지 않았다. `service_role`, SQL superuser, 앱의 Auth 테이블 전체 조회를 사용하면 세션 검증보다 넓은 권한을 업무 호출 경로에 주므로 채택하지 않았다.
