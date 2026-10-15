# W11 마감·실기기 수락 검사 W15 이관

- 작업 ID·제목: W11 테마·오류 UX·접근성·PWA 마감
- 날짜·담당: 2026-10-13 / Claude Code (사용자 결정)
- 변경 목적·전후 동작: 코드 변경 없음. W11에 남은 항목은 실기기 수락 검사 `TC-WEB-006`(확대·스크린리더·터치)과 `TC-CACHE-001`(A→B 계정 전환·기기 오프라인 PWA)뿐이었다. 로컬 무로그인 모드는 loopback 바인딩이 필수라 휴대폰이 접속할 수 없다. 서비스 워커는 production 빌드에서만 등록되는데 그 빌드는 가상 로그인을 차단한다. 로그아웃·로그인은 W12에 속한다. 그래서 두 TC를 W13 이후 배포 환경에서 실행하도록 W15로 옮기고, W11·W11-B·W11-B2·W11-C를 로컬 구현·검사 범위 기준 DONE으로 바꿨다.
- 관련 REQ / POL / TC / API operation: REQ-011, NFR-001, NFR-002 / POL-SEC-001 / TC-WEB-006, TC-CACHE-001 / API 변경 없음
- 기준 소스: cf54261
- 변경 파일·마이그레이션: docs/development/backlog.md, docs/development/artifact-register.json, docs/development/codex-project-handoff.md, docs/quality/verification-plan.md, docs/design/user-flows.md, 이 파일. 마이그레이션 없음.
- 정책·데이터 영향: 없음. 정책 파일과 TC 상태는 바꾸지 않았다.
- 실행 환경·도구 버전: 문서 변경. Node v22.14.0으로 `node scripts/verify-artifacts.mjs`를 실행해 링크·형식을 확인했다(project.ps1 허용 목록에 단독 task가 없다).
- 실행 명령 또는 수동 재현 단계: 해당 없음
- 관찰 결과·증거 파일: 기존 [W11-B2 모바일 검사](../quality/reports/w11-b2-mobile-emulation-check-2026-10-09.json), [W11-C 검사](../quality/reports/w11-c-pwa-cache-check-2026-10-08.json)
- 통과 / 실패 / 미실행: TC-WEB-006·TC-CACHE-001 미실행(`not_run` 유지, 통과 아님).
- 결함과 해결: 없음
- 다음 의존 작업: W10 UI09 소식·보낸함 화면. TC-WEB-006·TC-CACHE-001은 W12·W13 이후 W15에서 실행한다.
