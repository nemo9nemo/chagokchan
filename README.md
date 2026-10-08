# 차곡찬 (Chagokchan)

성인 개인 사용자가 목표별 셀프 칭찬과 지인의 칭찬을 개인·공유 칭찬판에 따로 모으는 모바일 웹/PWA를 개발한다. 포도는 교체 가능한 표현 테마이며 서비스 브랜드는 테마와 독립적으로 정한다.

현재 단계: **S06 사용자 기능 구현 중 — W11 진행 중**. W06 DB 권한부터 W10 목표 휴지통·복구까지 구현했고, W11-A 테마 전환과 W11-B1 키보드 본문 이동·연결 조회 오류 재시도를 확인했다. 다음은 W11-B2 작은 화면·실기기 접근성과 W11-C PWA 정적 캐시다. [진행표](docs/development/backlog.md), [W11-B1 검사 증거](docs/quality/reports/w11-b1-accessibility-recovery-check-2026-10-08.json).

개발 기준 경로: `C:\Users\love0\nemo9Dev\chagokchan`. 개발 중에는 로그인 화면 없이 로컬 가상 사용자로 이용하고, 실제 로그인 연동·테스트는 오픈 준비 단계에서 진행한다. DB·업무 권한 검사는 개발 중에도 수행한다.

- [개발 순서·현재 진행표](docs/development/backlog.md) — 작업 완료마다 상태와 검사 근거를 갱신한다.
- [Codex 프로젝트 개발 인계](docs/development/codex-project-handoff.md) — W06 재개 순서와 미검증 초안 위치.
- [로그인 없이 사용하는 로컬 개발](docs/development/local-development.md)
- [개발 환경 정책](policies/development-policy.json)

- [개발 절차와 단계별 완료 조건](docs/development/README.md)
- [산출물·진행 상태](docs/development/artifact-register.json)
- [MVP 요구사항](docs/requirements/mvp-requirements.md)
- [정책 기준 파일](policies/app-policy.json)
- [성인 사용자 범위와 가입 정책](docs/policies/audience-and-signup.md)
- [전체 설계 문서](docs/README.md)
- [브랜드명·영문 표기 기준](docs/branding/brand-guide.md)
- [출시명 검토 기록과 테마 원칙](docs/branding/name-candidates-2026-10-07.md)
- [개발 작업 목록](docs/development/backlog.md)
- [검증 계획](docs/quality/verification-plan.md)

개발자는 요구사항 → 정책 → ERD·화면·API 계약 → 검증 시나리오 → 구현 → 검증 → 릴리스 순서로 진행한다. 작업 규칙은 [AGENTS.md](AGENTS.md)를 따른다. 2026-10-08 사용자 요청으로 로컬 Git을 초기화하고 기능 단위로 커밋한다. 메시지에 작업·이유·검증·참조를 포함하며 [커밋 기준](docs/development/git-workflow.md)을 따른다. [GitHub 저장소](https://github.com/nemo9nemo/chagokchan)는 origin/main으로 연결했다. CI 설정은 후속 단계다. [연결 증거](docs/quality/reports/git-remote-connection-2026-10-08.json)를 남겼다.
