# W12-B 명시적 가입 확인과 원자적 계정 생성

- 날짜: 2026-10-19 / 기준 소스: `b896e148b621153ce0d809dcc332233e60f93837`
- 참조: REQ-001, POL-ACCOUNT-001·POL-AUDIENCE-001, TC-AUTH-001·TC-AUTH-004 중 DB/API 부분

Auth 인증 뒤 앱 계정이 없는 사용자에게 제품 권한을 자동으로 열지 않도록, 확인과 생성을 분리했다. bootstrap_account RPC는 현재 Auth 세션·명시적인 성인 확인·정책 버전을 확인한 뒤 계정·프로필·서버 확인 시각을 한 트랜잭션에 생성한다. 기존 계정의 재시도는 최초 값을 유지하고 삭제 중이거나 정리 표시가 있는 UUID는 재활성화하지 않는다. 기존 삭제 작업과 같은 사용자 잠금을 사용한다.

POST /me/bootstrap과 GET /auth/session을 서버 API에 연결했다. 가입 전 Auth 검증 경로는 가입/상태 조회 전용이며 일반 제품 API의 활성 계정 검증은 유지한다. UUID·확인 시각·생년월일 등 임의 필드는 받지 않고 응답도 본인 계약으로 제한한다. 신규 프로필 기본값은 테마 독립 문구와 star로 맞췄으며 기존 프로필과 적용 SQL은 변경하지 않았다.

직접 리뷰에서 기존 계약의 grape_auth/SDK 분할 쿠키 설명이 W12-A의 실제 Host 암호화 쿠키와 달랐음을 확인했다. 정책에 prefix와 분할 미사용을 명시하고 계약·검사·서버 구현을 __Host-grape_auth로 일치시켰다. 가입 연령·확인 의미는 바꾸지 않아 가입 정책 버전은 0.2.0을 유지한다.

새 마이그레이션 20261019000100(가입 RPC)과 20261019000200(향후 프로필 기본값)만 loopback 로컬 DB에 적용했다. 적용한 SQL 파일을 수정하거나 DB를 초기화하지 않았다. 최소 소유자 권한·고정 search_path·본인 INSERT RLS·authenticated만의 명시적인 RPC 실행 권한을 확인한다. DB 전체·실제 발급 로컬 Auth·HTTP API·단위·빌드의 실행 결과는 [W12-B 보고서](../quality/reports/w12-b-registration-check-2026-10-19.json)를 따른다.

실제 Google/OTP·가입 화면·운영 미완료 가입 정리 worker의 경합·재인증·공개 배포는 완료하지 않았다. 부분 검사로 TC-AUTH-001/004 전체를 통과 처리하지 않는다. [진행표](../development/backlog.md) · [ADR-0009](../decisions/ADR-0009-registration-bootstrap.md)
