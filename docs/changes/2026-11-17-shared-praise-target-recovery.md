# 공유 칭찬 대상·초안·늦은 응답 보호

2026-11-17 / W09-E / F-01·G-07 최소 / REQ-004·REQ-006 / POL-PRAISE-001·POL-SEC-001 / TC-PEER-RETRY-001

A판의 실패한 요청을 B판 URL로 재전송할 수 있던 경로를 고쳤다. 미전송 초안도 판 ID로 분리하고, 전송 중 중복 submit·화면 이동과 늦은 응답의 현재 화면 덮어쓰기를 막았다. 권한 회수 오류가 목록 새로고침에 사라지는 경로를 보완했다. 공통 멱등 도우미·RPC·API·DB 권한/집계는 변경하지 않았다.

재현 가능한 Playwright 1.65.1 회귀를 추가했다. 별도 loopback 개발 서버는 실제 env/fixture를 읽지 않고 모든 제품 API를 합성 응답으로 가로챈다. 테스트 출력은 production 빌드와 다른 디렉터리다. CI에 Chromium 설치와 해당 회귀를 추가했다.

실행: scripts/project.ps1의 check·build:check·db:test·db:shared-test·api:board-test·api:praise-test·api:connection-test, node scripts/test-security-headers-http.mjs, 고정 pnpm test:ui. 전체 단위 264·DB 426·HTTP 보안 20·데스크톱/모바일 브라우저 26 통과. 로컬 Auth 공유 RPC의 합성 사용자/세션 정리·기존 fixture 보존도 통과했다. 소스·호출부·비동기 순서·개인정보/요청 키 경계를 Codex가 직접 검토했다. 독립 교차 리뷰나 Claude 승인으로 표시하지 않는다.

브라우저 API/DB 성공 저장·실제 Google·배포 HTTPS/물리 기기·호스팅 삭제/복원은 미실행이며 공개 수락으로 집계하지 않는다. [세부 증거](../quality/reports/w09-e-shared-praise-recovery-check-2026-11-17.json) · [범위](../plans/W09-E-shared-praise-recovery.md). PR/CI 상태는 GitHub 기록을 따른다.
