# 문서의 머신별 경로 제거

- 작업 ID·제목: DOCS-PRIVACY-001 / 문서·기록의 사용자 로컬 절대 경로 제거
- 날짜·담당: 2026-10-11 / Codex
- 변경 목적·전후 동작: 저장소의 지침·README·진행표·결정 기록·인계 자료·이전 검사 보고서에 있던 사용자 이름과 머신별 절대 작업 경로를 제거했다. 검증기는 해당 절대 경로 문자열 대신 설정된 작업 공간 식별자, 현재 Git 저장소 메타데이터, 이전 복사 검증 표식을 검사한다.
- 관련 기준: AGENTS.md / ART-011·ART-014 / W00·W11
- 영향 파일: `AGENTS.md`, `README.md`, `docs/README.md`, `docs/development/*`, `docs/decisions/ADR-0004-local-development-auth.md`, 이전 인계·공간 이전 보고서와 `scripts/verify-artifacts.mjs`.
- 이유: 공개 저장소 문서에 개인 계정명과 로컬 폴더 구조를 남기지 않기 위해서다. 진행 재개 기준은 저장소 루트와 Git 상태로 확인하도록 바꿨다.
- 남은 진행·대기 이유: W11-B2 viewport 검사는 통과했으나 실제 iOS/Android 확대·터치·스크린리더 `TC-WEB-006`은 기기/OS 에뮬레이터가 필요하다. 브라우저 기반 A/B 계정 전환·오프라인 `TC-CACHE-001`은 아직 end-to-end로 실행하지 않았다. W12/W13 실제 로그인은 오픈 준비·공개 전이라는 사용자 일정에 따라 유예 중이다. W14 운영 입력은 외부 서비스/스테이징 전에 필요하고 로컬 개발은 막지 않는다. `main` 직접 push는 보호되며 PR 생성 권한이 현재 연동에 없어 W11-B2 기능 브랜치 상태다.
- 검증: `scripts/project.ps1 -Task check` 통과(lint 96 files, typecheck, unit 115/115, JSON 40, 로컬 Markdown 링크 505, OpenAPI 경로 55/참조 700, 등록 경로 291). 후속 등록부 항목을 추가한 뒤 `pnpm check:artifacts`도 통과(등록 경로 292). 문서의 사용자 홈·임시 폴더 절대 경로 검색 0건. `git diff --check` 통과.
- Git 이력 범위: 현재 작업 트리와 새 문서는 경로를 제거한다. 과거 공개 커밋의 내용을 지우는 force-push/이력 재작성은 수행하지 않았다.
