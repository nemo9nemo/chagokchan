# W09-B 공유판 권한·peer 칭찬 API

날짜: 2026-10-08 / 상태: 로컬 API 구현·DB/RPC/경계 검증 완료

## 작업

역할별 판 상세와 owner 전용 멤버 목록, owner grant/revoke, contributor 공유 칭찬 생성, peer praise 수신자 hide/unhide/exclude API를 기존 DB 업무 RPC에 연결했다. moderation RPC용 `20261008024700` 순서 마이그레이션을 추가해 수신자·peer 조건 RLS를 적용하고 `hidden_at`·`excluded_at`만 새롭게 업데이트할 수 있게 했다. 제외 상태 변경은 해당 bunch의 유효 칭찬 수와 완료 상태를 같은 트랜잭션에서 다시 계산한다.

## 이유

지인 연결만으로 목표 접근을 열지 않고 목표 주인이 명시한 판 권한만 인정한다. 개인판과 공유판 집계를 독립적으로 유지하면서 공유 칭찬을 받을 목표 주인에게 숨김/집계 제외 제어를 제공한다.

## 검증

- `scripts/board-api.test.mjs`와 `scripts/praise-api.test.mjs`를 포함한 전체 unit 99/99, Biome lint, typecheck 통과.
- `scripts/project.ps1 -Task db:migrate`: 로컬 Supabase에 마이그레이션 `20261008024700` 적용 확인.
- `scripts/project.ps1 -Task db:test`: 전체 pgTAP 247/247, W09-B 전용 10/10 통과.
- `scripts/project.ps1 -Task db:shared-test`: 실제 Auth가 발급한 합성 세션 owner/contributor/outsider 검사 7/7 통과. 숨김·해제·제외 반복, 집계 재계산, 권한 회수/차단 경합을 확인했고 임시 계정·세션 정리 및 기존 fixture 보존을 확인.
- `scripts/project.ps1 -Task api:board-test`: A/B/C 각각 12/12. 역할별 조회와 mutation CSRF 선행 차단을 확인하고 기존 제품 fixture 쓰기는 0건.
- `scripts/project.ps1 -Task build:check`: 통과, 30개 route entry 빌드.
- `TC-API-008` 기술 경계 완료. 제품 수락 TC, 실제 API route mutation→DB 성공 통합, 제품 UI E2E와 실제 Google/OTP 로그인은 미실행으로 구분한다.
- SHA-256 파일별 소스 근거와 실행 환경은 [W09-B 검사 증거](../quality/reports/w09-b-shared-board-praise-api-check-2026-10-08.json)에 기록한다.

## 다음 의존 작업

W09-C에서 연결·공유판 UI06~UI08을 API에 연결한다. 배포 Auth session adapter는 W12, 실제 로그인 검증은 W13에서 수행한다.

## 참조

W09-B / REQ-004·REQ-006·REQ-007·NFR-001 / POL-CONNECT-002·POL-ACCESS-001·POL-PRAISE-002·POL-SEC-001 / TC-API-008 / getBoard·listBoardMembers·grantBoardMember·revokeBoardMember·createPraise·hidePraise·unhidePraise·excludePraise
