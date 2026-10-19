# ADR-0008 — 배포 요청별 서버 세션 검증과 쿠키

- 상태: W12-A 구현, 검증 결과는 별도 보고서에 기록
- 결정일: 2026-10-19 / 참조: REQ-001·NFR-001, POL-ACCOUNT-002·POL-SEC-001, TC-AUTH-002의 세션 경계 부분

로컬 무로그인 사용은 유지하면서 배포의 일반 제품 API를 요청별 Supabase 세션으로 연결한다. 브라우저 Supabase 클라이언트·관리 키·공유된 로그인 클라이언트를 사용하지 않는다. 배포 요청마다 HttpOnly 쿠키를 해석하고 Auth.getUser로 토큰을 검증한 뒤 get_me RPC에서 현재 auth.sessions·기간·계정 상태를 재확인한다. JWT의 서명/exp만으로 폐기된 세션을 허용하지 않는다.

일반 클라이언트 설정에는 publishable 또는 기존 anon 형식만 허용하고 secret/service_role 키를 거절한다. 암호화 키가 없거나 형식이 잘못되면 배포 빌드·시작을 실패시킨다. build:check의 가상 키는 검사 전용이며 실제 운영 설정으로 사용하지 않는다.

쿠키는 기존 정책의 base name에 `__Host-`를 붙인 `__Host-grape_auth`다. Path=/·Secure·HttpOnly·SameSite=Lax와 Domain 미지정으로 발급한다. 서버 전용 32바이트 base64url 키로 AES-256-GCM 암호화하며 앱 출처를 AAD에 묶는다. 변조·다른 키/출처·만료·중복 쿠키·과대 입력은 거절한다. 키를 바꾸면 기존 앱 쿠키는 무효가 된다. 키·토큰·쿠키는 로그/JSON에 출력하지 않는다. 쿠키의 30일 기간은 DB의 실제 세션 생성일/비활성/폐기 검사를 대체하지 않는다.

배포 CSRF 토큰은 현재 암호화 세션 쿠키의 해시에 묶는다. 다른 계정·로그인/로그아웃·쿠키 교체 뒤의 이전 토큰은 거절한다. Origin·Fetch Metadata·서명된 이중 제출·JSON·본문 상한 검사는 유지한다. 미인증 때는 로그인 전 문맥을 사용하며 향후 Google/OTP의 개별 흐름 식별·PKCE·시도 제한은 별도 구현한다.

W12-A는 세션 쿠키 발급 헬퍼·검증 어댑터와 기존 제품 API 연결까지만 구현한다. 로그인 제공자·가입 bootstrap·세션 갱신/로그아웃 엔드포인트·재인증은 이 결정만으로 완성되지 않는다. 자동 갱신을 일반 요청에 숨겨 넣지 않으며, 갱신은 별도 CSRF·동시 요청·세션 일치 검증을 갖춰 후속 단위에서 구현한다. 모든 인증 응답은 no-store이고 PWA/공유 캐시를 사용하지 않는다.

근거: [Supabase 서버 인증](https://supabase.com/docs/guides/auth/server-side/advanced-guide) · [기존 세션 확인 경계](ADR-0005-local-auth-session-reader.md) · [W12-A 검사](../quality/reports/w12-a-session-check-2026-10-19.json)
