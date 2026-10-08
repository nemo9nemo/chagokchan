# W11-B1 키보드 본문 이동·비동기 상태·조회 오류 재시도

- 작업 ID·제목: W11-B1 키보드 본문 이동·비동기 상태·조회 오류 재시도
- 날짜·담당: 2026-10-08 / Codex
- 변경 목적·전후 동작: 화면의 반복 메뉴를 건너뛰는 키보드 링크가 없고, 비동기 화면의 바깥 영역이 진행 중 상태를 보조기기에 알리지 않았다. 첫 Tab 본문 건너뛰기와 목표·연결·공유·휴지통 목록의 `aria-busy`를 구현하고 조회 장애 때 오류 안내·다시 불러오기를 검증한다.
- 관련 REQ / POL / TC: REQ-011·NFR-002 / POL-SEC-001 / TC-WEB-004
- 정책·데이터 영향: 화면 상태와 읽기 요청만 다룬다. 목표·칭찬·집계·권한은 변경하지 않으며 오류 시 fixture 기록은 보존한다.
- 실행 환경·도구 버전: Windows local fixture actor A, Node 24.19.0, pnpm 11.19.0, Next.js 16.4.0
- 실행 명령 또는 수동 재현 단계: `Tab` 후 본문 건너뛰기 링크 Enter; 목표·연결·공유판·휴지통 `aria-busy` source 확인; local Supabase Kong 중지 후 연결 화면 조회; Kong 복구 후 다시 불러오기 실행; `scripts/project.ps1 -Task check`; `scripts/project.ps1 -Task build:check`.
- 관찰 결과·증거 파일: 전체 check(90 lint files, typecheck, unit 109/109, 산출물 71 TC·473 링크)와 `build:check`(36 route entries)를 통과했다. 첫 Tab 포커스와 skip target 포커스를 확인했다. Supabase API 게이트웨이 중단 중 연결 API GET 오류와 재시도 버튼이 보였고, 게이트웨이를 다시 시작한 뒤 버튼으로 다섯 연결 GET이 200으로 돌아왔다. GET 외 제품 API 요청·fixture 데이터 변경은 없었다. [W11-B1 검사 증거](../quality/reports/w11-b1-accessibility-recovery-check-2026-10-08.json)
- 통과 / 실패 / 미실행: TC-WEB-004 통과. 실제 기기 스크린리더·색상 대비·작은 화면 검사는 미실행이며 W11-B2에 남긴다.
- 다음 의존 작업: W11-B2 실기기 읽기 도구·색상 대비·작은 화면, W11-C PWA 공개 정적 캐시·오프라인 경계.
