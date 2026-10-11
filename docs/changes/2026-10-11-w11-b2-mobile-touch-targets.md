# W11-B2 모바일 CSS viewport 조작 영역 보완

- 작업 ID·제목: W11-B2 / 모바일 링크·날짜 입력 조작 영역 보완
- 날짜·담당: 2026-10-11 / Codex
- 변경 목적·전후 동작: 모바일 CSS viewport에서 상단 홈 링크가 26.9px, 날짜 입력이 36px로 44px 기준보다 작게 렌더링되는 것을 확인했다. 760px 이하에서 두 요소의 최소 높이를 45px로 맞췄다.
- 관련 기준: REQ-011·NFR-002 / W11-B2 / TC-WEB-006의 브라우저 viewport 부분 검사. 실제 기기 수락은 완료하지 않았다.
- 변경 파일: `src/app/globals.css`; 진행표·검증 계획·검사 증거는 관련 문서에서 함께 갱신한다.
- 검증 방법: 로컬 synthetic A fixture 화면을 데스크톱 브라우저의 CSS viewport override로 열고 393×852, 360×800, 320×640 CSS px에서 목표 목록·상세·연결·받은 공유판·휴지통을 순회했다. 15개 viewport/화면 조합의 문서 폭·보이는 조작부·화면 경계·제목을 측정했다.
- 결과·데이터 영향: 15/15 조합에서 기대 화면과 네비게이션 상태를 확인했다. 가로 넘침·44px 미만 조작 영역·화면 밖 조작부는 0건이다. 목표·칭찬·권한 제출은 하지 않았고 제품 데이터 쓰기는 0건이다. `api:me-test` 합성 A 세션 검사는 15/15 통과했다. 검사 상세는 [증거 보고서](../quality/reports/w11-b2-mobile-touch-target-followup-2026-10-11.json)에 기록한다.
- 통합 검증: `scripts/project.ps1 -Task build:check` 통과. Next.js 16.4.0 프로덕션 컴파일·TypeScript·40개 라우트 생성을 완료했다. 이어 `scripts/project.ps1 -Task check`도 통과했다: Biome 96개 파일, TypeScript, unit 115/115, JSON 41개, 링크 515개, OpenAPI 55 경로·700 참조, 등록부 산출물 294개, 오류 0건.
- 한계·남은 일: 브라우저 viewport override는 iOS/Android 사용자 에이전트·실제 터치·200% 확대·VoiceOver/TalkBack을 제공하지 않는다. 현재 테스트 도구에서 iOS 실기기/시뮬레이터를 제어할 수 없고 Android SDK/에뮬레이터도 발견되지 않았다. TC-WEB-006 전체와 PWA 계정 전환·오프라인 TC-CACHE-001은 미실행이며 W11은 진행 중이다.
