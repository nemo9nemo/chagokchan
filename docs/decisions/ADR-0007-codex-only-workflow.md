# ADR-0007 — Claude 사용 없이 Codex 직접 진행

- 상태: 채택·작업 절차 반영
- 결정일: 2026-10-19 / 작업: W21-C·W22-B
- 출처: 사용자 명시 요청 “claude 사용하지 말고 해”

2026-10-13에 정한 Claude 기획/리뷰·Codex 구현 분업을 현재 작업부터 Codex 직접 진행으로 대체한다. Codex가 요구·설계·구현·diff 검토·검증·기록·커밋·PR을 담당한다. Claude 실행·위임·인증 복구와 Claude APPROVED를 기다리지 않는다.

W21의 이전 Claude 리뷰 시도는 모델 실행 전 조직 인증 403으로 실패했다. 이 사실을 이력으로 남기고, Codex가 검토한 소스 버전·범위·검사 증거·미실행 항목을 별도로 기록한다. Codex 직접 검토를 독립 교차 리뷰나 Claude 승인으로 표현하지 않는다.

기존 브리프를 지시받은 경우 범위·금지 사항·검증 명령·구현 보고는 유지한다. 기능 단위 커밋, 비밀 제외, PR·필수 CI, 실제 로그인·전체 제품 수락·운영 배포 조건도 유지한다. 사용자가 도구 사용을 다시 지시하면 그 요청을 우선한다.

반영: [AGENTS.md](../../AGENTS.md) · [현재 절차](../development/claude-codex-workflow.md) · [진행표](../development/backlog.md) · [W21 직접 검토](../quality/reports/w21-codex-review-check-2026-10-19.json)
