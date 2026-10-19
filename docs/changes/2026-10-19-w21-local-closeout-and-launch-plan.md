# W21 로컬 무로그인 마무리 검증과 W22 출시·수익화·마케팅 실행안

- 날짜·담당: 2026-10-19 / Codex. 사용자 직접 요청이며 기존 브리프 구현 요청은 아니다.
- 목적: 1차는 로그인 없이 로컬 기능을 검증하고 2차는 실제 로그인 후 모바일 웹/PWA → Android → iOS로 출시한다. 현재 완료 기록을 동기화하고 실행 가능한 사업 가설을 남긴다.
- 참조: W21/W22, NFR-001/005, REQ-002/003/004/007/008/009, POL-DEV-001·POL-SEC-001·POL-OPS-001·POL-PRAISE-002, TC-API-001~011·TC-SHARED-COUNT-001. TC-DEV-001/002와 전체 TC-UI-MOCKUP-001을 부분 검사만으로 통과 처리하지 않는다.
- 소스: 기준 `86d5be9448353cf0f504eae68e18011ec98de344` + [검사 보고서](../quality/reports/w21-local-closeout-check-2026-10-19.json)의 raw-byte SHA-256.
- 코드 변경: `scripts/project.ps1`의 프로젝트 전용 고정 pnpm/Node 선택, `test-local-personal-praise.mjs` 임시 RPC schema cache 대기, `test-local-shared-board-rpc.mjs` 권한 경합용 별도 합성 판. 제품 RPC·RLS·SQL·상한·package/lock은 변경하지 않는다.
- 문서 변경: 요구·개발 정책의 1/2차 경계, README/진행표/등록부/인계/검증 계획, [1차 기록](../development/phase-one-closeout.md), [출시 실행안](../launch-and-growth-plan.md), [마케팅 준비물](../marketing/launch-kit.md). 개발 정책 변경은 출시 가입 정책 버전을 바꾸지 않는다.
- 환경: Windows PowerShell, Node 24.19.0·pnpm 11.19.0·Docker 29.1.3·PostgreSQL 17.11, 마이그레이션 48개. 앱/DB는 loopback, 기존 DB 초기화 없음.
- 명령/결과: `scripts/project.ps1 -Task check`(lint 105파일·typecheck·unit 132·artifact), `build:check`, `db:test` 336, DB 세션/RPC 10종 96개, API A/B/C 경계 261개·태그 성공 쓰기 9개 통과. 자세한 명령과 범위는 보고서를 따른다.
- 브라우저: 실제 로컬 A, 9개 화면/패널 × CSS 320/360/393/768/1280px 45화면. 가로 넘침·44px 미만 노출 조작부 0, 로그인 입력 없음, 빈 이름 제출 거절·기본값·테마/개수 불변. 제품 데이터 mutation 요청 0건. 전체 수락·실기기·스크린리더·실제 로그인으로 기록하지 않는다.
- 결함/재실행: pnpm 버전 불일치, 임시 probe의 PGRST202, 이전 쿼터 소진이 개입하는 권한 경합 검사를 보완했다. 한 차례 겹쳐 실행한 전역 fault trigger 검사와 마지막 중복 휴지통 API 실패도 숨기지 않고 보고서에 남겼다. 잔존 probe/trigger 0과 순차 회귀 통과를 확인했다.
- 보존: 성공 쓰기 API 검사는 자기 생성 데이터·쿼터를 안전하게 정리하고 전체 기존 fixture snapshot을 보존했다. 브라우저는 읽기/폼 오류만 확인했다. 실제 .env·이메일·토큰·초대 비밀·사용자 본문·Claude 조직 메타데이터는 변경 문서와 Git에 포함하지 않는다.
- 리뷰: 프로젝트 분업에 따라 Claude Code 2.1.296을 도구/파일 변경 없이 호출했으나 모델 실행 전 `403 oauth_not_allowed_for_organization`으로 실패했다. 리뷰 승인을 기록하지 않으며 초안 PR로 인계한다. 기존 브리프를 구현한 작업이 아닌 직접 요청이므로 검증 변경의 로컬 커밋·원격 업로드는 기존 커밋 규칙을 따른다.
- 미실행/다음 작업: Claude 접근 준비와 구현 리뷰, 전체 제품 수락·실기기/PWA·실제 Google/OTP·운영 원장·복원·부하. 2차 서비스 생성에는 운영 주체·지원 연락처·도메인·월 예산 입력이 필요하다. 결제/스토어 제출/마케팅 게시/광고 집행/운영 배포는 수행하지 않았다.
