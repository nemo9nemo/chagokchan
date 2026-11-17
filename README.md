# 차곡찬 (Chagokchan)

성인 개인 사용자가 목표별 셀프 칭찬과 지인의 칭찬을 개인·공유 칭찬판에 따로 모으는 반응형 웹앱을 개발한다. PC·모바일 브라우저로 이용하며 PWA 설치는 선택이다. 2026-11-03 사용자 결정으로 Android/iOS 스토어는 현재 범위에서 제외했다. 포도는 교체 가능한 표현 테마이며 서비스 브랜드는 테마와 독립적으로 정한다.

현재 단계: **핵심 로컬 기능 완료, 실제 인증·웹앱 운영 준비(W12/W14/W27) 진행**. 요청별 서버 세션·Google/가입/탈퇴 웹 화면·현재/전체 로그아웃·삭제 작업자와 로컬 백업/복원 기반을 구현했다. 2026-11-17 공유/초대 재시도·본인 프로필·복원 세션 안전성을 보완하고 unit 271·DB 437·합성 API 브라우저 72·실제 로컬 Auth 프로필/복원을 각각 검증했다. [프로필 검사](docs/quality/reports/w12-e-profile-settings-check-2026-11-17.json) · [복원 검사](docs/quality/reports/w14-c2b-restore-session-check-2026-11-17.json). 실제 Google·호스팅 삭제/복원·전체 수락·실기기·운영 공개는 미완료다. 새 소스 외부 업로드·배포는 사용자 요청으로 보류 중이며, 공개 연락처 환경값 저장과 실제 페이지 반영을 구분한다. 로컬은 로그인 화면 없이 계속 사용하고 수익화는 부차 목표다. [진행표](docs/development/backlog.md) · [웹앱 전환 결정](docs/decisions/ADR-0010-webapp-release.md) · [서버·DB 시장조사](docs/webapp-infrastructure-research-2026-11-03.md).

개발 기준 경로: `C:\Users\love0\nemo9Dev\chagokchan`. 개발 중에는 로그인 화면 없이 로컬 가상 사용자로 이용하고, 실제 로그인 연동·테스트는 오픈 준비 단계에서 진행한다. DB·업무 권한 검사는 개발 중에도 수행한다.

- [개발 순서·현재 진행표](docs/development/backlog.md) — 작업 완료마다 상태와 검사 근거를 갱신한다.
- [Codex 프로젝트 개발 인계](docs/development/codex-project-handoff.md) — 현재 인계와 과거 W06 초안 구분.
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

개발자는 요구사항 → 정책 → ERD·화면·API 계약 → 검증 시나리오 → 구현 → 검증 → 릴리스 순서로 진행한다. 작업 규칙은 [AGENTS.md](AGENTS.md)를 따른다. 2026-10-08 사용자 요청으로 로컬 Git을 초기화하고 기능 단위로 커밋한다. 메시지에 작업·이유·검증·참조를 포함하며 [커밋 기준](docs/development/git-workflow.md)을 따른다. [GitHub 저장소](https://github.com/nemo9nemo/chagokchan)는 origin/main으로 연결했다. GitHub Actions quality CI와 main PR 보호를 적용했다. 보호된 HTTPS 스테이징은 배포했으며 운영 공개는 미완료다. [연결 증거](docs/quality/reports/git-remote-connection-2026-10-08.json)를 남겼다.
