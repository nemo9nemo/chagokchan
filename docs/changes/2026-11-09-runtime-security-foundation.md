# 보안 런타임과 배포 호환성

2026-11-09 / W27-B / REQ-011·NFR-001/004/005·POL-SEC-001/POL-OPS-001·TC-DEPLOY-RUNTIME-001

Node 24.19.0을 24.22.1로 교체하고 로컬/CI는 정확 버전, 배포는 같은 24 메이저의 보안 하한 이상을 요구한다. Next.js 16.4.5·잠금 파일을 갱신하고 기존 정책 JSON을 정적 import로 번들링해 webpack에서 발생한 경로 오류를 고쳤다. production 빌드는 지원되는 webpack을 일관되게 사용한다. 개발 fixture의 외부 바인딩은 계속 거절하며 production host/PORT를 검증한다.

단위 206·lint/typecheck·산출물·build·격리 production 보안 HTTP 10·audit 근거는 [검사 보고서](../quality/reports/w27-b-runtime-security-check-2026-11-09.json)에 기록한다. 새 런타임 단위 7개는 구버전·다른 메이저·prerelease·fixture 외부 실행·잘못된 포트를 검사한다. 초기 Turbopack CSS worker 오류와 webpack 정책 URL 오류를 고쳤으며 최종 성공만 따로 기록한다.

이번 완료는 런타임 기반이다. 실제 Google 로그인/가입/갱신·탈퇴 UI·분산 제한/원장·운영 DB·복원·실기기 수락과 공개 배포는 별도다. SQL 원본을 변경하지 않았다. Codex가 버전/환경 경계·diff·비밀 제외를 직접 검토하며 PR 필수 CI·병합은 GitHub 기록을 따른다.
