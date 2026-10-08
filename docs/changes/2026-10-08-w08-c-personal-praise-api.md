# W08-C 개인 칭찬 API

- 작업 ID·제목: W08-C — 개인 칭찬 목록·생성·수정·취소 API
- 날짜·담당: 2026-10-08 / Codex
- 변경 목적·전후 동작: 기존 W06 칭찬 업무 RPC만 있던 상태에서 서버 API의 역할별 목록 projection과 개인 칭찬 변경 경로를 추가했다.
- 관련 REQ / POL / TC / API operation: REQ-003, REQ-007, REQ-012 / POL-PRAISE-001, POL-PRAISE-002, POL-CYCLE-001, POL-ACCESS-001, POL-SEC-001 / TC-API-006 / `listBoardPraises`, `createPraise`, `editSelfPraise`, `cancelPraise`
- 기준 소스: `e6d3ef6d57e6edec80b3882f06334c5398c00549` 위에서 작업, 최종 파일 해시는 [검사 보고서](../quality/reports/w08-c-personal-praise-api-check-2026-10-08.json)에 기록
- 변경 파일·마이그레이션: `20261008024600_personal_praise_result_rpc.sql`, pgTAP 011, praise API validator/projection/route, unit·Auth session/API boundary 검증, OpenAPI·TC·진행표·인계·개발 문서
- 정책·데이터 영향: 개인 생성·수정·취소는 기존 인증 세션의 업무 RPC에 위임한다. 새 wrapper는 생성된 self praise 행과 정확한 bunch ID를 결합한다. 공개 칭찬 테이블 SELECT 권한은 주지 않는다. 공유 peer 쓰기 및 숨김/제외 route는 W09에 남긴다.
- 실행 환경·도구 버전: Windows, Node 24.19.0, pnpm 11.19.0, Next.js 16.4.0, PostgreSQL 17.11; Supabase는 127.0.0.1에 바인딩
- 실행 명령 또는 수동 재현 단계: `scripts/project.ps1 -Task db:migrate`, `db:test`, `db:rpc-test`, `db:praise-result-test`, `api:praise-test`를 A/B/C 각각, `check`, `build:check`
- 관찰 결과·증거 파일: pgTAP 6/6·전체 DB 237/237·RPC 186/186·실제 Auth session 3/3·A/B/C API 각 10/10·unit 79/79·build:check 및 최종 산출물 검사 통과. synthetic account/session 정리 및 기존 fixture 보존. [검사 보고서](../quality/reports/w08-c-personal-praise-api-check-2026-10-08.json)
- 통과 / 실패 / 미실행: 구현·실행한 검증 통과. 제품 수락 TC, API route의 성공적인 쓰기 end-to-end, UI, shared peer write/hide/exclude, 실제 Google/OTP 로그인은 미실행 또는 W09/W12 이후로 유지
- 결함과 해결: 기존 적용 `create_praise`는 id/replayed만 반환했지만 API 계약은 bunch_id도 요구했다. 기존 migration을 바꾸지 않고 후속 wrapper RPC에서 동일 actor·board의 self praise 행에 저장된 불변 bunch_id를 읽어 원자적 결과로 반환했다.
- 다음 의존 작업: W08-D 목표·개인 기록 기본 화면; 공유 peer 작성·숨김/제외 API는 W09
