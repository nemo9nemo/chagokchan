# W09-A 연결·초대·차단 API

날짜: 2026-10-08 / 상태: API 구현·기술 경계 검증 완료

## 작업

연결·초대·연결 요청·차단의 14개 HTTP method 경로를 기존 Auth-scoped 업무 RPC에 연결했다. 포함 경로는 연결/초대/요청/차단 목록, 초대 발급·미리보기·요청 생성·수락/거절/철회, 초대 폐기, 연결 해제, 차단/해제다. 응답은 최소 projection allowlist와 no-store를 적용하고, 초대 원문 비밀은 발급 응답에서만 제공한다.

## 이유

W06에서 검증한 관계·권한 RPC를 제품 API에서 세션 경계와 CSRF 입력 경계로만 호출할 수 있게 한다. 연결 수락과 목표별 contributor 부여의 권한은 독립적으로 유지한다.

## 검증

- `scripts/connection-api.test.mjs`: 8/8 unit tests.
- `scripts/project.ps1 -Task api:connection-test`: 실제 local Auth A/B/C 각각 12/12 읽기·거절 경계 검사 통과.
- 기존 fixture DB 쓰기 0건.
- 관계 업무 RPC 세션 검증은 W06-C1 13/13을 별도 보고서에서 확인했다.
- 전체 check/build 실행 결과와 source hash는 [검사 증거](../quality/reports/w09-a-connection-api-check-2026-10-08.json)에 기록한다.

## 범위 밖

owner board-member grant/revoke, contributor board projection, peer 칭찬 생성/숨김/제외 API는 W09-B다. UI06~UI08은 W09-C다. 유효한 초대 발급·소비/수락 API의 route→DB 성공은 기존 fixture를 변경하지 않도록 이 작업의 A/B/C smoke에서 실행하지 않았다. 제품 수락 테스트·실제 로그인·UI 쓰기 E2E를 통과 처리하지 않는다.

## 참조

W09-A / REQ-005·REQ-006 / POL-CONNECT-001·POL-CONNECT-002·POL-ACCESS-001·POL-SEC-001 / TC-API-007
