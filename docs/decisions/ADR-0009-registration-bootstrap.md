# ADR-0009 — 최초 가입 확인과 계정 생성의 원자성

- 상태: DB/API 구현·로컬 Auth·HTTP·단위·빌드 검증 완료, 실제 제공자/화면 수락 전
- 결정일: 2026-10-19 / 작업: W12-B
- 참조: REQ-001, POL-ACCOUNT-001·POL-AUDIENCE-001, TC-AUTH-001·TC-AUTH-004의 DB/API 부분

기존 요구대로 Auth 인증과 앱 가입을 분리한다. POST /me/bootstrap은 검증된 Auth UUID·현재 DB 세션을 사용하고 adult_confirmed=true·현재 가입 정책 버전만 받는다. UUID·확인 시각·생년월일·닉네임을 이 입력으로 받지 않는다. 일반 제품 API는 여전히 active 앱 계정을 요구한다.

bootstrap_account RPC는 기존 계정 삭제와 같은 `account-deletion:<Auth UUID>` advisory transaction lock을 사용한다. 활성 계정의 재시도는 기존 get_me를 반환하며 최초 확인 시각·정책 버전·프로필을 덮어쓰지 않는다. deleting 계정과 상태에 관계없이 남아 있는 삭제/가입 정리 표시는 가입을 막는다. 새 가입만 현재 정책 버전을 비교한다. 계정·프로필·서버 확인 시각은 한 트랜잭션에서 생성하고 어느 단계가 실패해도 모두 롤백한다.

새 프로필은 테마에 독립적인 “새로운 사용자”·허용된 star 아바타를 사용한다. 정책과 DB의 향후 생성 기본값도 새 마이그레이션으로 맞추며 기존 프로필과 적용된 SQL 파일은 변경하지 않는다. 신규 RPC 소유자는 기존 최소 권한 chagokchan_rpc이며 필요한 INSERT 열·본인 RLS만 추가한다. authenticated·anon·service_role의 직접 DML 권한은 추가하지 않는다.

GET /auth/session은 인증된 본인의 최소 상태와 고정 경로만 반환한다. 가입 확인 전에는 signup_required·/signup, active는 /, deleting/정리 표시는 /account/deletion이다. 계정 없는 사용자에 대한 Auth 검증 경로는 이 상태 조회와 가입 전용이며 일반 API의 active 검증을 대체하지 않는다.

운영의 미완료 가입 정리 작업·실제 Google/OTP·가입 화면은 후속 범위다. 정리 작업을 연결할 때도 같은 사용자 잠금과 삭제 표시를 사용해야 한다. DB/API 부분 검사만으로 TC-AUTH-001/004 전체 실제 인증·정리 경합 수락을 통과 처리하지 않는다.
