# W09-D 공유판 집계와 보낸 칭찬 취소 결함 수정

- 날짜·담당: 2026-10-16, Codex / 구현 브랜치 `codex/W09-D-shared-count-cancel-fix`
- 기준 소스: `9d68e2f51f97156c56070d3c897c4048f9b1e49a` + 미커밋 변경. SQL·검사 파일 SHA-256은 [검사 증거](../quality/reports/w09-d-shared-count-cancel-check-2026-10-16.json)에 기록한다.
- 참조: REQ-004·REQ-007·REQ-009·REQ-012 / POL-CYCLE-001·POL-PRAISE-001·POL-PRAISE-002 / TC-SHARED-COUNT-001·TC-CYCLE-001·TC-CYCLE-002·TC-PRAISE-002 / create_peer_praise·cancel_praise

## 변경과 영향

기여자 자신의 행만 세던 공유판 집계를 전용 `chagokchan_counter`의 내부 헬퍼로 바꿨다. 새 역할은 NOLOGIN·BYPASSRLS와 지정 열 권한만 갖는다. 잠금 헬퍼가 세션·작성자를 확인한 뒤 목표와 회차를 잠그므로, 연결이나 판 권한이 끝난 작성자도 자기 기록 취소를 진행할 수 있다. 취소 RPC는 이어서 칭찬을 잠그고 삭제 검사를 replay보다 먼저 한다. 타인 기록은 존재 여부를 숨기는 404다. 본문·실천일·태그는 한 UPDATE에서 지운다.

순서형 `20261008025100_shared_count_and_sender_cancel.sql`에 역할·헬퍼 2개·대상 RPC 2개·기존 회차 보정을 넣었다. 기존 마이그레이션·RLS 정책·create_praise·제외 RPC·보낸함 RPC·서버/브라우저·API 계약은 수정하지 않았다. 회차 보정은 원본 칭찬·권한·개인/공유 독립성을 보존하고 소식을 재생성하지 않는다. 상한 초과 데이터는 마이그레이션을 실패시킨다. 운영 적용 시 구버전 호출 종료와 무트래픽을 요구한다.

신규 pgTAP 016의 39개 assertion, [ADR-0006](../decisions/ADR-0006-shared-cycle-counter-role.md), 제품 정책·배포 메모·TC·검증 계획·진행표·등록부·브리프 구현 보고를 갱신했다. ERD에는 DB 역할/권한 목록이 없어 브리프의 조건부 수정 대상에 해당하지 않는다. 기존 검사에는 취소의 `praise_not_author`/403 기대가 없어 수정하지 않았다. 범위 밖 변경은 없으며 W10-D 브리프도 수정하지 않았다.

## 검사와 남은 일

Windows PowerShell 샌드박스, Node 24.19.0, Biome 2.5.15, TypeScript 5.9.3에서 지정한 직접 실행 방식으로 lint·typecheck·unit 126/126을 통과했다. 산출물 구조·상호 참조 검사 결과와 명령 원문은 [증거](../quality/reports/w09-d-shared-count-cancel-check-2026-10-16.json)에 남긴다. `git diff --check`도 통과했다.

Docker는 `permission denied while trying to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine`으로 실패했다. DB migrate/test 및 공유·개인·개인 결과·연결·탈퇴·생명주기, board/tag API 검사를 각각 시도했으나 환경 확인·앱 기동 단계에서 실패했다. 신규 마이그레이션 적용, pgTAP 39개와 기존 DB/API 업무 회귀·실제 경합은 모두 미실행이다. 과거 통과 수를 새 SQL의 통과로 재사용하지 않는다.

W09-D와 W09는 `IN_PROGRESS`, TC-SHARED-COUNT-001은 `not_run`으로 남긴다. 다음은 Claude의 샌드박스 밖 DB 적용·회귀와 구현 리뷰다. 사용자 지시에 따라 커밋·push는 하지 않았다.
- Claude 재검증(2026-10-16, Docker 29.1.3, Node 24.19.0): 로컬 DB를 초기화(fixture 매니페스트 백업)한 뒤 loopback으로 다시 띄우고 시드를 넣었다. 마이그레이션 48개를 처음부터 적용했고, 헬퍼 ACL은 chagokchan_rpc만 실행 가능하다. pgTAP 336/336(016 39/39), db:shared·praise·praise-result·connection·lifecycle·deletion 통과, api:board-test A/B/C 각 14/14, api:praise-tag-test 통과, lint·typecheck·unit 126/126·build:check 통과. 초기화 직후 Auth 기동 중에 돌린 첫 회차에서는 db:praise-test·db:deletion-test가 실패했고, 다시 돌리자 같은 순서로 전부 통과했다.
- 완료: 구현 리뷰 r3 APPROVED.
