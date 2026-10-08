# W08-B2 목표 상태·판 설정·회차 읽기 API

- 작업 ID·제목: W08-B2 — 목표 완료·보관·재개, 판 설정 변경, 회차 목록 조회
- 날짜·담당: 2026-10-08 / Codex
- 변경 목적·전후 동작: 기존 목표 상태 전이·판 설정 업무 RPC에 안전한 서버 경로를 연결하고, 권한이 유효한 판의 회차 요약을 이어 읽는 RPC/API를 추가했다.
- 관련 REQ / POL / TC / API operation: REQ-002, REQ-012 / POL-GOAL-002, POL-CYCLE-001, POL-ACCESS-001, POL-SEC-001 / TC-API-005 / `completeGoal`, `archiveGoal`, `resumeGoal`, `updateBoard`, `listBunches`
- 기준 소스: `a51de4267ee10db85e28a9194f3910cca65a985b` 위에서 작업, 최종 파일 해시는 [검사 보고서](../quality/reports/w08-b2-goal-lifecycle-api-check-2026-10-08.json)에 기록
- 변경 파일·마이그레이션: `20261008024500_bunch_list_rpc.sql`, 새 pgTAP 권한 검사, 목표 전이·판 PATCH·회차 GET route, 요청 검증/응답 allowlist, 단위·실제 로컬 세션 검사, OpenAPI·TC·진행표·개발 문서
- 정책·데이터 영향: 목록 RPC는 `SECURITY DEFINER` 고정 search_path·전용 RPC 소유자·명시 실행권을 사용한다. 본인/현재 공유 권한 구성원만 조회하고 요약 필드만 반환한다. 페이지 cursor는 판 ID에 결합한다. 적용 마이그레이션은 수정하지 않는다.
- 실행 환경·도구 버전: Windows, Node 24.19.0, pnpm 11.19.0, Next.js 16.4.0, PostgreSQL 17.11; Supabase는 127.0.0.1에 바인딩
- 실행 명령 또는 수동 재현 단계: `scripts/project.ps1 -Task db:migrate`, `db:test`, `db:rpc-test`, `db:goal-lifecycle-test`, `api:goal-management-test`를 A/B/C 각각, `check`, `build:check`
- 관찰 결과·증거 파일: pgTAP 9/9·전체 DB 231/231·RPC 180/180·실제 Auth 세션 lifecycle/history 6/6·A/B/C API 각 8/8·unit 69/69·최종 전체 정적 검사·build 통과. probe 계정/세션은 정리하고 기존 fixture 보존. [검사 보고서](../quality/reports/w08-b2-goal-lifecycle-api-check-2026-10-08.json)
- 통과 / 실패 / 미실행: 구현·실행한 검증 통과. 제품 수락 TC 36개, W08-A 목표 create/update API의 성공 route→DB 통합, UI, 실제 Google/OTP 로그인은 미실행으로 유지
- 결함과 해결: 적용 전에 cursor base64 줄바꿈을 제거했고 잘못된 board 결합 cursor 및 마지막 반환 행 기준 keyset 연속성을 실제 DB에서 확인했다. 이 마이그레이션 적용 뒤 SQL 수정 없음.
- 다음 의존 작업: W08-C 개인 칭찬 생성·수정·취소 및 회차 API, 이어 W08-D 기본 UI
