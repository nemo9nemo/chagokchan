# W10-D 소식·보낸 칭찬 화면(UI09)

- 날짜·담당: 2026-10-16, Codex / 브랜치 `codex/W10-D-news-sent-ui`
- 기준 소스: `2b0ae6724eb1adf671d654dbd430189abd7ab878` + 미커밋 변경. 소스 SHA-256과 실제 명령은 [검사 증거](../quality/reports/w10-d-news-sent-ui-check-2026-10-16.json)에 기록한다.
- 참조: REQ-008·REQ-009 / POL-PRAISE-002 / TC-UI-NEWS-001 / listNotifications·markNotificationRead·listSentPraises·cancelPraise

소식 메뉴를 다섯 번째에 추가했다. 첫 소식 페이지에 미읽음이 있으면 점과 숨김 텍스트만 표시한다. 받은 소식·보낸 칭찬을 전환하고 각각 20건씩 커서로 더 볼 수 있다. 타입별 한국어 문구·날짜·새 소식 배지, 빈·로딩·조회 오류/재시도를 제공한다. 두 연결 타입만 연결 관리로 이동한다. 이동 시 읽음 요청 실패는 표시하지 않고 이동한다.

읽음과 취소는 기존 CSRF 변경 요청을 사용한다. can_cancel인 보낸 기록만 확인 시트 후 취소하며, 진행 중 비활성화와 취소하는 중 안내를 표시한다. 성공 전 상태를 바꾸지 않고 펼친 페이지까지 다시 읽은 결과를 반영한다. 변경 실패는 행 근처 알림과 같은 ID/본문 재시도를 제공하고 목록을 보존한다. 취소 본문과 상대 정보·판·개수·숨김/제외 상태를 표시하지 않는다. 응답은 메모리에만 유지한다.

브리프의 코드·문서 범위 안에서 구현했다. 순수 문구/이동 함수와 테스트 6개, package.json test 목록, UI09 설계·TC·검증 계획·진행표·등록부·인계·브리프 보고를 함께 갱신했다. 서버·DB·마이그레이션·API 계약 변경은 없다.

Node 24.19.0 / Biome 2.5.15 / TypeScript 5.9.3의 Windows PowerShell 샌드박스에서 lint·tsc·unit 132/132(새 함수 6/6)을 통과했다. 산출물 구조 검사와 diff 확인 결과도 검사 증거에 남긴다. 빌드·api:news-test·api:praise-test·브라우저는 사용자 지시와 샌드박스 제약으로 미실행이다. 320/360/393/768/1280px 무넘침·44px·실제 읽음/연결/취소 성공·실패는 Claude가 샌드박스 밖에서 확인해야 한다.

W10-D와 W10은 IN_PROGRESS, TC-UI-NEWS-001은 not_run이다. 제품 수락 TC-NOTIFY-001은 이번 범위에 포함하지 않는다. 구현 리뷰 대기이며 사용자 지시로 커밋·push하지 않았다.
- Claude 리뷰 확인(2026-10-16, Node 24.19.0, Docker 29.1.3): lint 105파일·typecheck·unit 132/132·verify-artifacts·build:check 통과, api:news-test A/B/C 각 11/11·api:praise-test 통과. 브라우저(로컬 A): 실제 API에서 빈 상태 확인. 이어 GET 응답을 합성 목록으로 바꾸고 PATCH·POST는 가로채 DB 쓰기 없이 검사했다. 미읽음 점과 숨김 문구, 320/360/393/768/1280px 가로 넘침 0·44px 미만 조작부 0, 읽음 PATCH {read:true} 뒤 목록 재조회·배지 해제, 연결 관리로 이동, 취소 확인 시트 문구와 POST 뒤 재조회·'취소한 칭찬' 표시, 조회 503 오류 문구와 다시 불러오기 회복, 더 보기 cursor 요청과 항목 추가를 확인했다.
- 완료: 구현 리뷰 r1 APPROVED.
