# W20-A 셀프 칭찬 태그

- 날짜·담당: 2026-10-15 / Codex 구현, Claude 리뷰·재검증
- 목적: 개인판 주인의 셀프 칭찬에 고정 태그 0~1개를 추가한다. 태그 없는 요청의 기존 멱등 해시와 회차·개수·권한은 유지한다.
- 참조: REQ-003·REQ-007 / POL-PRAISE-001·002 / TC-PRAISE-TAG-001 / createPraise·editSelfPraise·listBoardPraises
- 기준 소스: `cf54261746459e3faa98b397df9f8a4ba33c3c43` + 미커밋 변경, `codex/W20-A-praise-tags`
- 산출물: [구현 브리프](../plans/W20-A-praise-tags.md), 새 마이그레이션 `20261008025000_praise_tag.sql`, 서버 검증·응답 제한, 계약·정책·ERD, 단위·pgTAP·로컬 API 검사 코드.
- 정책·데이터: self 태그 5종 또는 null, peer/취소는 null. 기존 행은 null로 유지하고 새 열의 SELECT/INSERT/UPDATE는 RPC 소유자에만 부여한다.
- 환경: Windows PowerShell 샌드박스, Node 24.19.0, 실제 PATH pnpm 11.25.0(프로젝트 고정 11.19.0과 불일치). Docker/DB 버전은 이번 실행에서 확인하지 못했다.
- 통과: 직접 Biome 97파일·TypeScript, 지정한 격리 해제 unit 120/120, 산출물 75 TC 상호 참조.
- 실패·미실행: 지정 pnpm 명령과 project.ps1 task는 ERR_PNPM_UNSUPPORTED_ENGINE. 직접 DB 명령은 Local database command failed (EPERM), 기존 API는 앱 기동 실패. 직접 build-check는 컴파일 후 TypeScript 단계 spawn EPERM. DB 적용·pgTAP·실제 API 성공 경로·빌드 완료는 미검증.
- 범위 차이: 파일 범위 이탈 없음. pnpm 버전 오류 뒤 동일 설치 도구를 직접 실행해 대체 검사했다. pnpm test·check는 사용자 지시대로 실행하지 않았다.
- 검증: 실행 결과는 [검사 증거](../quality/reports/w20-a-praise-tag-check-2026-10-15.json)에 기록한다.
- Claude 재검증: Claude 리뷰 재검증(Docker 29.1.3, Node 24.19.0): 마이그레이션 47개 적용, pgTAP 297/297(015 태그 40/40), db:praise·praise-result·deletion 통과, api:praise-tag-test 9개 시나리오 통과(정리·fixture 보존), api:praise-test 10/10, api:board-test A/B/C 각 14/14, unit 120/120, lint·typecheck·산출물·build:check 통과.
- 완료 범위: W20-A 구현·DB/API 통합 검증·구현 리뷰(APPROVED) 완료. 실제 Google/OTP 로그인 검증은 W12/W13 범위다.
- 다음: W20-B 목업 기반 화면 구현.
