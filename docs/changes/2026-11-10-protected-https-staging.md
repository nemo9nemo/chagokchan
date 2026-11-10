# 보호된 HTTPS 스테이징 배포

W14-B / NFR-001·NFR-004 / POL-SEC-001·POL-ACCOUNT-002

무료 Hobby를 확인한 팀에 별도 staging 웹 프로젝트를 만들고 검증된 main `0143902`를 실제 배포했다. 환경·DB·세션/CSRF 비밀과 재인증 검증 키를 운영용과 분리한다. 일반 웹에 service role을 두지 않는다. 기존 운영용 프로젝트에는 배포하지 않았다.

기본 보호 범위의 운영 별칭은 익명 200으로 열리는 것을 확인해 All Deployments로 강화했다. 이후 무쿠키 GET은 Vercel 로그인 302다. 소유자 브라우저에서는 HTTPS 로그인·안내 5개·앱 세션 거절·CSRF 준비를 확인했다. 앱 계정은 0개이고 Google 제공자·실제 사용자 수락·운영 삭제/복원은 미완료다. 공개 성공이나 전체 보안 완료로 표시하지 않는다.

소스 변경 없는 환경 준비 작업으로 배포 메타데이터·실제 빌드·스테이징 DB 상태·읽기 경계와 문서 정합성을 확인했다. [운영 절차](../development/hosted-staging.md)·[검사 증거](../quality/reports/w14-b-https-staging-check-2026-11-10.json).
