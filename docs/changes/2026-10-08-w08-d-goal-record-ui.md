# W08-D 목표·개인 기록 기본 UI

- 작업 ID·제목: W08-D — 목표·개인 기록 기본 화면
- 날짜·담당: 2026-10-08 / Codex
- 변경 목적·전후 동작: 준비 안내 화면을 목표 목록·상세·설정·개인 기록 흐름으로 바꾸고 W08 서버 API와 연결했다.
- 관련 REQ / POL / TC / API operation: REQ-002, REQ-003, REQ-007, REQ-012 / POL-GOAL-001, POL-GOAL-002, POL-CYCLE-001, POL-PRAISE-002, POL-API-001 / TC-UI-003 / goal list/detail/create/update/transition, board settings/bunches, board praise list/create/edit/cancel
- 기준 소스: `4a2f426f78ec591fc295b6a0c0835bfd2e88549e` W08-C 위에서 작업; W08-D 최종 파일 해시는 [검사 보고서](../quality/reports/w08-d-goal-record-ui-check-2026-10-08.json)에 기록한다.
- 변경 파일·마이그레이션: 목표·판·회차·개인 기록 client 화면, 반응형 CSS, 멱등 재시도 helper·unit, 화면 흐름 설계 상태, TC·추적·진행표·개발 인계·검증 기록. DB migration 추가 없음.
- 정책·데이터 영향: 개인/공유 개수를 합치지 않고 개인 메모를 공유판 API projection으로 내보내지 않는다. mutation은 기존 서버 API의 CSRF·세션·업무 RPC 경계를 통과한다. 화면은 개인정보를 localStorage/cache에 쓰지 않는다.
- 실행 환경·도구 버전: Windows, Node 24.19.0, pnpm 11.19.0, Next.js 16.4.0, React 19.3.0, PostgreSQL 17.11 local Supabase on loopback.
- 실행 명령 또는 수동 재현 단계: `scripts/project.ps1 -Task check`, `scripts/project.ps1 -Task build:check`; loopback local dev에서 기존 Auth A fixture로 GET 화면을 열고 개인/공유판·목표 생성 입력·목표 설정 UI를 확인한다.
- 관찰 결과·증거 파일: unit 82/82, Biome·typecheck·산출물 검사·production-mode build-check 통과. 브라우저 smoke는 API 조회 200·폼/빈 회차 표시를 확인했고 기존 fixture 제품 데이터를 변경하지 않았다. [W08-D 검사 보고서](../quality/reports/w08-d-goal-record-ui-check-2026-10-08.json)
- 통과 / 실패 / 미실행: UI02~UI05 기본 화면과 `TC-UI-003` 읽기 전용 smoke 통과. UI 폼의 실제 성공 submit→화면 갱신과 네트워크 불확실 재시도 E2E, 실제 제품 수락 TC, 기기·스크린리더·PWA는 미실행이다. 멱등 키·본문 snapshot 단위 검사는 통과했으며 W08-C 실제 Auth/RPC 생성 경계도 통과했다.
- 결함과 해결: 첫 칭찬 전 `current_bunch`가 `null`인 목표에서는 초기 입력 폼이 숨고 렌더링 중 null 참조가 발생할 수 있었다. 현재 회차가 없더라도 active 개인판 입력을 허용하고 완료 여부 검사도 nullable current bunch에 안전하도록 고쳤다.
- 다음 의존 작업: W09 연결·판 권한·공유 칭찬. W08-A route→DB 성공의 실제 fixture write 검사는 기존 fixture 보존 상태에서 별도 검증 여부를 추적한다.
