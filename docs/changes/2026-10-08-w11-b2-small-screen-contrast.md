# W11-B2 작은 화면 재배치·글자 대비

- 작업 ID·제목: W11-B2 작은 화면 재배치·글자 대비
- 날짜·담당: 2026-10-08 / Codex
- 변경 목적·전후 동작: 760px 이하에서 주요 화면 메뉴의 네 번째 항목이 잘려 보여 탐색할 수 있는 선택지가 명확하지 않았다. 메뉴를 2열로 재배치하고 각 항목의 높이를 44px로 늘렸다. 초대 버튼의 좁은 줄바꿈을 고치고 두 테마의 작은 보조 글자색을 대비 기준에 맞게 조정했다.
- 관련 REQ / POL / TC: REQ-011·NFR-002 / POL-SEC-001 / TC-WEB-005 통과, TC-WEB-006 미실행
- 정책·데이터 영향: 로컬 fixture의 읽기 화면과 테마 표시만 전환했다. 목표·칭찬·개수·권한을 변경하는 조작은 실행하지 않았다.
- 실행 환경·도구 버전: Windows 로컬 fixture actor A, Node 24.19.0·pnpm 11.19.0·Next.js 16.4.0, Codex In-app Browser, 320px·640px viewport override
- 실행 명령 또는 수동 재현 단계: 320px·640px에서 목표 목록/상세·연결·받은 공유판·휴지통을 순회하고 양 테마의 글자 대비를 측정했다. 실제 기기 브라우저 확대와 VoiceOver/TalkBack은 실행하지 않았다. `scripts/project.ps1 -Task check` (lint 90·typecheck·unit 109/109·artifact check 통과); `scripts/project.ps1 -Task build:check` (36 route entries 통과).
- 관찰 결과·증거 파일: 네 화면 모두 가로 넘침이 없었다. 주요 메뉴 4개가 모두 노출되고 각 버튼 높이는 44px이었다. 연결 화면의 “초대 만들기”는 한 줄로 표시됐다. 정원 테마 초대 코드 placeholder는 6.21:1이었다. 양 테마·측정 화면에서 aria-hidden 장식을 제외한 렌더링 텍스트의 WCAG AA 대비 미달은 없었다. [W11-B2 검사 증거](../quality/reports/w11-b2-small-screen-contrast-check-2026-10-08.json)
- 통과 / 실패 / 미실행: TC-WEB-005 브라우저 반응형·대비 확인 통과. TC-WEB-006 실제 확대·스크린리더·기기 터치 검사는 기기 환경이 없어 미실행이며 W11-B2는 진행 중이다.
- 다음 의존 작업: W11-C PWA 공개 정적 캐시·오프라인 경계 구현·검증. W11-B2를 끝내려면 TC-WEB-006 실제 기기 검사가 필요하다.
