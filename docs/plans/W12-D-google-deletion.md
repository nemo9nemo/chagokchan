# W12-D — Google 재인증과 웹 탈퇴

2026-11-09 / REQ-001/010·NFR-001·POL-ACCOUNT-001/002·POL-DELETE-002·POL-SEC-001·TC-DELETE-001~004

초기 베타는 Google만 제공한다. 현재 사용자·현재 세션·CSRF를 확인해 별도 PKCE 재인증을 시작하고, 새 Google 인증의 UUID가 기존 사용자와 일치할 때만 같은 계정의 새 세션과 10분·1회용 account.delete grant를 발급한다. 다른 Google 계정은 현재 계정을 교체하지 않으며 보조 세션 폐기를 시도한다. 같은 계정의 성공 시 기존 세션은 폐기하고 새로운 검증된 세션에 grant를 묶는다. Google 비밀번호 재입력을 보장한다고 표현하지 않는다.

W12-D1은 서버가 확인한 재인증 결과의 서명과 최소 권한 DB grant 발급 경계다. 일반 사용자 JWT만으로 grant를 만들 수 없어야 한다. 서버의 목적별 파생 키로 사용자·새 세션·scope·nonce·시각·기한을 서명하고, 별도 비로그인 definer가 DB의 비공개 검증 키와 현재 활성 세션/RLS로 검증한다. 키는 SQL/Git에 넣지 않고 환경별로 별도 프로비저닝한다. [ADR-0011](../decisions/ADR-0011-server-reauth-proof.md).

W12-D2는 재인증 BFF·상태·탈퇴 확인 화면과 기존 request_account_deletion RPC를 연결한다. 명시적 삭제 확인과 멱등 키를 요구하고 접근 차단 접수와 실제 파기 완료를 구분한다. DB deleting 전환 후에는 Auth 폐기 장애가 있어도 제품 접근을 열지 않는다. 운영 원장·worker/복원은 W14에 이어서 준비하고 실제 공개 전에 수락한다.

검증은 서명/목적/시각/사용자/세션/중복·RLS/DML·타 계정·만료·폐기·Auth 장애/경합을 포함한다. 실제 Google·HTTPS 검증과 합성 로컬 증거를 구분한다. 기존 SQL은 수정하지 않고 새 순서의 migration을 추가한다.

2026-11-09 D2 구현: POST reauth/start, GET reauth/callback·reauth/{flow_id}, POST account/deletion-requests를 연결했다. 현재 세션 갱신 뒤 PKCE를 시작하며, 같은 UUID의 새 세션만 검증하고 서버 증명으로 grant를 발급한다. 계정 메뉴·확인 화면·접수 안내와 임시 쿠키 정리를 추가했다. [변경 기록](../changes/2026-11-09-google-reauth-deletion-web.md)·[검사 증거](../quality/reports/w12-d2-deletion-web-check-2026-11-09.json).
