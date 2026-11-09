# ADR-0011: Google 재인증 결과를 검증하는 제한된 DB grant 발급

2026-11-09 / 상태: W12-D1 서버 서명·DB 발급 경계 로컬 구현/검증, Google BFF·운영 키 설정 후속

브라우저에는 Supabase 토큰을 주지 않고 일반 요청은 사용자 JWT로 처리한다. 삭제 grant를 사용자 JWT만으로 발급하면 기존 로그인 자체를 재인증으로 오인할 수 있다. 관리 키로 제품 테이블에 직접 넣는 방식은 기존 RPC/RLS 경계를 벗어난다.

서버가 별도 PKCE Google 흐름과 기존/새 UUID·현재 DB 세션을 검증한 뒤 목적별 HMAC 증명을 만든다. 증명은 v·검증 키 ID·grant nonce·사용자·새 세션·account.delete·확인 시각·만료를 포함한다. 원문 proof는 브라우저에 반환하지 않는다. DB에는 별도 비로그인·비 superuser·비 BYPASSRLS 발급 역할을 두고 서명 검증과 본인 세션/RLS에 맞는 grant INSERT만 허용한다. 검증 키 설정에는 일반 API 역할·RPC 역할·발급 역할의 쓰기 권한을 주지 않는다.

검증 키는 기존 서버 세션 암호화 루트에서 HKDF-SHA256으로 목적과 앱 origin을 구분해 파생한다. DB에 파생 키가 노출되더라도 루트 키나 Auth 쿠키를 복호화할 수 없다. 환경별 DB에 해당 파생 키만 별도로 프로비저닝하며 Git·SQL migration·로그에 실제 키를 넣지 않는다. 키가 없거나 불일치하면 발급을 거절한다. 루트 키 교체는 기존 쿠키 폐기와 DB 검증 키 갱신을 함께 처리한다.

서명 비교는 길이가 고정된 바이트를 모두 비교한다. proof는 10분 이내이며 같은 nonce의 재시도는 같은 미소비 grant만 반환한다. 소비·만료 뒤 재발급하지 않는다. 기존 request_account_deletion RPC의 현재 세션·scope·10분·1회 소비와 원자적 deleting 전환은 유지한다. 과거 적용 SQL은 변경하지 않는다.

Google 성공 시 같은 사용자에게 새 Auth 세션이 생기므로 새 세션에 grant를 묶고 기존 세션을 폐기한다. 다른 UUID는 교체하지 않는다. Google의 계정 선택 흐름이며 비밀번호 강제 재입력과 동등하다고 주장하지 않는다. 키 프로비저닝·실제 Google/HTTPS·탈퇴/운영 파기는 구현과 별도 수락 증거가 필요하다.

Google의 `select_account`는 계정 선택을 요청하는 값이며 비밀번호 입력을 보장하지 않는다. [Google OIDC 공식 문서](https://developers.google.com/identity/openid-connect/openid-connect#authenticationuriparameters) · [Supabase Google 설정](https://supabase.com/docs/guides/auth/social-sign-in/auth-google). 기존 Auth 격리 역할 소유의 함수 실행 권한은 실제 소유 역할에서만 좁게 부여한다. 초기 로컬 권한 누락은 후속 migration으로 보완했으며 적용된 SQL은 변경하지 않았다.
