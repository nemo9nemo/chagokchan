# 공개 출시 완료 여부와 보안 보완

작업: W15-A / 요구: NFR-001·NFR-004·NFR-005 / 정책: POL-SEC-001·POL-OPS-001 / 검사: TC-SEC-HEADERS-001

사용자 요청에 따라 진행표와 실제 구현을 대조하고 인증·권한·입력/응답·캐시·환경 경계·비밀 패턴·공개 의존성 권고를 Codex가 직접 검토했다. 전체 출시 작업은 미완료다. 로컬 기능 완료와 실제 제공자·운영 수락을 구분한 [점검 보고서](../quality/reports/security-completion-audit-2026-10-20.md)에 수정 및 잔여 조건을 남겼다.

Next.js를 공식 보안 수정 버전을 포함하는 16.4.2로 고정하고 lock을 갱신했다. 요청별 nonce CSP, 동적 문서/no-store, no-referrer·운영 HSTS·기기 권한 제한을 추가했다. 기존 진행 막대 style 속성 및 공개 오프라인 고정 스타일 예외를 명시했고, 서비스 워커의 동일 출처 fetch를 유지한다. CI에는 공개 의존성 감사와 production 빌드 HTTP 헤더 검사를 추가했다. API 계약·제품 정책·DB 마이그레이션·기존 기록은 변경하지 않았다.

단위 175·DB 390·로컬 Auth 어댑터 5·태그 HTTP 17·격리 production HTTP 7·build-check를 통과했다. 보안 자동 감사는 수정 전후 모두 0건이어서 공식 권고를 별도로 대조했다. 비밀 패턴 검사는 추적 파일·로컬에서 도달 가능한 Git 이력 및 공개 빌드 자산으로 범위를 한정했다. 실제 HTTPS 브라우저 CSP/hydration·PWA·Google/OTP·분산 제한/장애·운영·실기기·복원/부하 검사는 미실행이다. [구조화된 증거](../quality/reports/security-completion-audit-2026-10-20.json)를 참조한다.
