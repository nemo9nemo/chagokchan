# 스테이징 Google OAuth 제공자 연결

W12-C2b3 · REQ-001. 사용자 승인을 받아 Chagokchan 프로젝트에서 스테이징 웹 클라이언트를 발급하고 스테이징 Supabase의 Google 제공자를 활성화했다. 기본 복귀 주소를 스테이징 HTTPS로 저장하고 로그인·재인증 콜백 두 개를 등록했다.

기존 스테이징 배포 0143902에서 ‘Google로 계속하기’를 눌러 실제 Google 로그인 화면에 도달했고 Google 요청의 콜백이 스테이징 Supabase 주소와 일치했다. 계정 로그인, 앱 콜백과 세션 및 제품 수락은 W12-C2b에서 검증한다.

[연동 근거](../quality/reports/w12-c2b3-staging-google-oauth-2026-11-24.json) · [진행표](../development/backlog.md)
