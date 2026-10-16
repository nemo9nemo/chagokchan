# W10-D 소식·보낸 칭찬 화면(UI09)

- 상태: DONE (2026-10-16 구현 리뷰 r1 APPROVED)
- 작성: Claude / 날짜: 2026-10-16
- 구현 브랜치: codex/W10-D-news-sent-ui
- 참조: REQ-008·REQ-009 / POL-PRAISE-002 / TC-NOTIFY-001(제품 수락, 범위 밖), TC-UI-NEWS-001(신규) / operation listNotifications·markNotificationRead·listSentPraises·cancelPraise / 진행표 W10-D(신규)
- 선행: W10-A API, W20-B 화면 구조, W09-D(공유판 집계·연결 종료 후 작성자 취소 수정, PR #7) — 모두 main에 있음

## 목표

1. 메뉴에 "소식"이 생기고, 받은 소식과 내가 보낸 칭찬을 본다.
2. 소식을 읽음으로 표시할 수 있고, 연결 관련 소식에서 연결 관리 화면으로 이동할 수 있다.
3. 보낸 칭찬 중 `can_cancel`인 기록을 확인 후 취소할 수 있다. 연결이 끊긴 뒤에도 내 기록이면 취소할 수 있다(POL-PRAISE-002).

## 확정한 설계

- **메뉴:** `WorkspaceView`에 `"news"`를 추가하고 주요 메뉴 5번째에 "소식" 버튼을 둔다. 첫 페이지에 읽지 않은 소식이 있으면 버튼 옆에 점과 숨김 텍스트 "읽지 않은 소식 있음"을 붙인다. 개수는 보이지 않는다(첫 페이지만 알 수 있어 틀릴 수 있음). 확인 시점은 화면 진입 때와 앱 첫 로드 때뿐이다. 폴링하지 않는다.
- **화면 구성:** 제목 "소식". 그 아래 전환 버튼 두 개 "받은 소식"·"보낸 칭찬"(`aria-pressed`, 기존 board-tabs 스타일)을 둔다.
- **받은 소식 목록**(`GET /api/v1/notifications?limit=20`, `next_cursor`로 "더 보기"):
  - 문구는 타입별로 정한다:
    - `praise_received`: "새 칭찬을 받았어요"
    - `bunch_completed`: "포도 한 송이를 다 채웠어요"
    - `connection_requested`: "연결 요청이 왔어요"
    - `connection_accepted`: "연결이 수락됐어요"
    - 모르는 타입: "새 소식이 있어요"
  - 시간은 `created_at`을 기존 `shortDate` 형식으로 보여 준다.
  - 읽지 않음은 굵은 글씨와 "새 소식" 배지로 표시한다(색만으로 구분하지 않음).
  - 행 동작:
    - 미읽음이면 "읽음으로 표시" 버튼이 있다. `PATCH /api/v1/notifications/{id}`에 body `{ "read": true }`, CSRF는 기존 `mutate`로 보낸다. 성공하면 목록을 다시 읽는다. 화면 값을 직접 바꾸지 않는다.
    - 연결 관련 두 타입에는 "연결 관리로" 버튼이 있다. 누르면 미읽음인 경우 같은 PATCH 성공 뒤 `setWorkspaceView("connections")`로 이동한다. PATCH가 실패해도 이동은 하고 오류는 표시하지 않는다(읽음은 다음에 다시 시도).
    - 칭찬·완성 소식에는 이동 버튼이 없다. API가 대상 판을 알려 주지 않기 때문이고, 목표·판을 추측해서 열지 않는다.
  - 빈 상태: "아직 소식이 없어요."
- **보낸 칭찬 목록**(`GET /api/v1/sent-praises?limit=20`, "더 보기"):
  - 표시: 메시지(없으면 "칭찬 1건"), `recorded_at`, 취소된 기록은 "취소한 칭찬" 배지와 본문 없음.
  - 받은 사람·판·개수는 보여 주지 않는다. 응답에 없고, 정책상 상대의 현재 상태는 비노출이다.
  - `can_cancel`이 true면 "취소" 버튼을 둔다. 누르면 기존 기록 취소 확인 시트(W20-B의 확인 시트 패턴)를 연다.
    - 문구: "이 칭찬을 취소할까요?", "취소하면 본문이 지워지고 받은 사람의 개수에서도 빠져요. 되돌릴 수 없어요."
    - 확인하면 `POST /api/v1/praises/{id}/cancel`(body `{}`)을 보낸다. 성공하면 목록을 다시 읽는다. 진행 중에는 버튼을 비활성화하고 "취소하는 중…"으로 바꾼다.
  - 빈 상태: "아직 보낸 칭찬이 없어요."
- **오류:** 목록 조회 실패는 기존 W11-B1 패턴(오류 문구 + "다시 불러오기")을 따른다. 변경 실패는 행 근처 `role="alert"`로 알리고 목록은 그대로 둔다. 응답이 불확실해도 재시도는 같은 요청이다. 두 API 모두 서버가 멱등이며, 다시 누르면 `replayed`로 끝난다.
- **로딩:** 각 목록에 `aria-busy`와 "불러오고 있어요" 상태 문구를 둔다.
- **문구 규칙:** 화면 문구는 한국어만 쓴다. 이 화면에 영어 eyebrow를 새로 만들지 않는다.

## 범위

- `src/app/client-app.tsx`: 뷰 추가, 메뉴 버튼, 상태(목록·커서·로딩·오류·전환 탭·취소 대상), 데이터 로드·변경 함수.
- 신규 `src/app/news-panel.tsx`: 두 목록과 행 렌더링. 데이터 호출은 props 콜백으로 받는다. 기존 `SharePanel` 패턴처럼 모듈 수준 함수나 안정된 콜백을 쓴다.
- 신규 `src/app/news-labels.mjs` + `scripts/grape-layout.test.mjs`와 같은 위치의 `scripts/news-labels.test.mjs`: 타입→문구·이동 가능 여부 순수 함수와 단위 테스트(5개 타입 + 미지 타입). `package.json` `test` 목록에 추가한다.
- `src/app/globals.css`: 필요한 최소 스타일(읽지 않음 점·배지 재사용 우선).

## 하지 말 것

- 서버 API·DB·마이그레이션·`contracts/openapi.json`을 수정하지 않는다. 필요한 데이터가 없으면(예: 소식 대상 판 이름) 만들지 말고 보고한다.
- 브라우저에 Supabase 클라이언트나 키를 두지 않는다. `/api/v1/*`와 기존 `apiJson`·`mutate`만 쓴다.
- 소식·보낸 칭찬 응답을 `localStorage`·`sessionStorage`·쿠키·서비스 워커 캐시에 저장하지 않는다.
- 성공 응답 전에 읽음 표시·취소 상태를 화면에 미리 반영하지 않는다.
- 상대의 닉네임·판·개수·숨김/제외 상태를 표시하거나 추측하지 않는다.
- 폴링·푸시·소리를 넣지 않는다.
- 기존 W20-B 화면, 기존 영어 eyebrow 정리, W20-B 리뷰의 참고 항목은 이번 범위가 아니다.

## 구현 단계

1. `src/app/news-labels.mjs` + `scripts/news-labels.test.mjs`, `package.json` test 목록. 검증: `node --test --test-isolation=none scripts/news-labels.test.mjs`
2. `src/app/news-panel.tsx`: 두 목록, 전환, 빈·로딩·오류 상태, 더 보기, 취소 확인 시트. 검증: lint·typecheck
3. `src/app/client-app.tsx`: `"news"` 뷰, 메뉴 버튼과 미읽음 점, 로드·읽음·취소 함수 연결. 검증: lint·typecheck·unit 전체
4. 문서 갱신:
   - `docs/design/user-flows.md` UI09 행과 설명을 "화면 구현"으로 고친다.
   - `docs/quality/test-cases.json`에 `TC-UI-NEWS-001`(local_ui_browser_smoke, REQ-008·REQ-009, POL-PRAISE-002)을 추가한다. 내용: 메뉴 진입, 두 목록 렌더, 빈·오류·더 보기, 읽음 PATCH 후 재조회, 연결 이동, 취소 확인·재조회, 5개 폭 무넘침·44px. status는 not_run이다.
   - `docs/quality/verification-plan.md` TC 수를 고친다.
   - `docs/development/backlog.md`: W10-D 행을 추가하고 W10 상위 행을 갱신한다.
   - `docs/development/artifact-register.json` 단계를 갱신한다.
   - 변경 기록 `docs/changes/<날짜>-w10-d-news-sent-ui.md`, 검사 증거 `docs/quality/reports/w10-d-news-sent-ui-check-<날짜>.json`을 쓴다.

## 함께 갱신할 기준 파일

docs/design/user-flows.md, docs/quality/test-cases.json, docs/quality/verification-plan.md, docs/development/backlog.md, docs/development/artifact-register.json, docs/development/codex-project-handoff.md, 변경 기록·검사 증거

## 완료 기준

- [ ] "소식" 메뉴로 진입해 받은 소식·보낸 칭찬을 전환해 볼 수 있다.
- [ ] 읽음 표시는 PATCH 성공 뒤 재조회 결과로만 바뀐다.
- [ ] 연결 관련 소식에서 연결 관리 화면으로 이동한다.
- [ ] `can_cancel` 기록만 취소 버튼이 있다. 취소는 확인 시트를 거치고 성공 뒤 재조회로 "취소한 칭찬"이 된다.
- [ ] 상대 정보·개수·판을 표시하지 않는다.
- [ ] 320/360/393/768/1280px에서 소식 화면 가로 넘침이 없고 노출 조작부가 44px 이상이다(Claude 브라우저 측정).

## 검증 명령

```
.\scripts\project.ps1 -Task check
.\scripts\project.ps1 -Task build:check
.\scripts\project.ps1 -Task api:news-test
.\scripts\project.ps1 -Task api:praise-test
```

Codex 샌드박스에서는 `node_modules/.bin`의 biome·tsc, `node --test --test-isolation=none <package.json test 목록>`, `node scripts/verify-artifacts.mjs`를 실행한다. 빌드·API 통합·브라우저 검사는 리뷰 단계에서 Claude가 샌드박스 밖에서 실행한다.

## Codex 구현 보고

- 구현 결과: 소식 메뉴·미읽음 점, 받은 소식/보낸 칭찬 전환·커서 목록, 읽음 후 재조회, 연결 관리 이동, can_cancel 확인 시트·취소 후 재조회, 빈/로딩/오류/재시도와 한국어 문구를 구현했다. 서버·DB·계약 변경은 없다.
- 상태: W10-D와 W10은 IN_PROGRESS다. 코드와 샌드박스 검사를 마쳤으며 Claude의 빌드·API·브라우저 검사와 구현 리뷰가 남았다. TC-UI-NEWS-001은 not_run이며 완료 기준의 실제 화면 동작·폭 측정은 통과로 표시하지 않았다. 커밋·push하지 않았다.

변경 파일:

- `src/app/client-app.tsx`: news 뷰·다섯 번째 메뉴·첫 페이지 미읽음, 두 목록/커서/오류/취소 상태·로드·읽음·연결 이동·취소 함수. 변경 성공 뒤 펼친 페이지 재조회, 조회 순번과 ID 중복 방지.
- `src/app/news-panel.tsx`(신규): 목록 전환·행·날짜·배지, 로딩/오류/더 보기, 취소 확인 시트. API 호출은 부모 콜백으로 받는다.
- `src/app/news-labels.mjs`(신규), `scripts/news-labels.test.mjs`(신규): 네 소식 타입과 미지 타입의 문구/연결 이동 여부, 객체 속성 이름 등의 미지 타입 방어를 6개 테스트로 검증한다.
- `src/app/globals.css`: 소식 점·목록·행 최소 스타일. 기존 board-tabs·badge·확인 시트·44px 규칙을 재사용한다.
- `package.json`: 새 테스트를 test 목록에 추가했다.
- `docs/design/user-flows.md`, `docs/quality/test-cases.json`, `docs/quality/verification-plan.md`: UI09 구현 범위·TC-UI-NEWS-001 not_run·총 78개 시나리오·미실행 검사 기록.
- `docs/development/backlog.md`, `docs/development/artifact-register.json`, `docs/development/codex-project-handoff.md`: W10-D IN_PROGRESS·구현/샌드박스 검사와 리뷰 대기를 구분해 갱신했다.
- `docs/changes/2026-10-16-w10-d-news-sent-ui.md`, `docs/quality/reports/w10-d-news-sent-ui-check-2026-10-16.json`(신규): 변경·검사 명령/결과·소스 근거·남은 검사.
- `docs/plans/W10-D-news-sent-ui.md`: 이 구현 보고를 작성했다.

실행 환경: Windows PowerShell workspace-write 샌드박스, Node 24.19.0, Biome 2.5.15, TypeScript 5.9.3. 기준 HEAD `2b0ae6724eb1adf671d654dbd430189abd7ab878` + 미커밋 변경, 브랜치 `codex/W10-D-news-sent-ui`.

| 실제 실행 명령 | 결과 |
| --- | --- |
| `.\node_modules\.bin\biome.cmd lint --error-on-warnings .` | 종료 0, 105개 파일 검사 통과 |
| `.\node_modules\.bin\tsc.cmd --noEmit` | 종료 0, 오류 없음 |
| `node --test --test-isolation=none <package.json test 전체 목록, scripts/news-labels.test.mjs 포함>` | 종료 0, 132/132 통과·실패/건너뜀 0, 신규 6/6 |
| `node scripts/verify-artifacts.mjs` | 종료 0, 계획 TC 78개·10개 구조/참조 검사 통과 |
| `git diff --check` | 종료 0, 공백 오류 없음 |

전체 테스트는 다음 PowerShell 명령으로 package.json의 현재 목록을 읽어 실행했다. 확장된 파일 목록도 [검사 증거](../quality/reports/w10-d-news-sent-ui-check-2026-10-16.json)에 기록한다.

```powershell
$chagokTests = ((Get-Content -Raw -Encoding utf8 package.json | ConvertFrom-Json).scripts.test -replace '^node --test ', '') -split ' '
node --test --test-isolation=none @chagokTests
```

실행하지 못한 검사와 이유:

- `.\scripts\project.ps1 -Task build:check`: 사용자 지시에 따라 샌드박스에서 미실행.
- `.\scripts\project.ps1 -Task api:news-test`, `.\scripts\project.ps1 -Task api:praise-test`: 사용자 지시 및 샌드박스 제약으로 로컬 앱·DB API 통합 미실행.
- 브라우저 `TC-UI-NEWS-001`: 사용자 지시에 따라 미실행. 두 목록의 빈/오류/더 보기, 읽음 PATCH 성공·실패/응답 유실·재조회, 연결 이동, 취소·동일 요청 재시도·연결 종료 뒤 본인 취소, 320/360/393/768/1280px 가로 넘침·44px·초점/닫기는 Claude가 샌드박스 밖에서 검사해야 한다.
- 제품 수락 `TC-NOTIFY-001`: 브리프 범위 밖이므로 실행·통과 처리하지 않았다.

브리프와 다르게 한 부분:

- 기능·파일 범위 변경 없음. 변경한 추가 페이지의 기록이 사라지지 않도록 읽음·취소 성공 후 이미 펼친 페이지까지 재조회하는 세부 구현을 보완했다.
- 사용자와 브리프의 샌드박스 지침에 따라 project.ps1 check 대신 직접 biome·tsc·격리 없는 node:test·산출물 검사를 실행했다. 빌드·API·브라우저 완료를 주장하지 않는다.

## 리뷰 기록

- 브리프 리뷰 r1 (2026-10-16, Codex read-only): P1 2건(연결 종료 후 취소 불가, peer 취소 집계 오류)은 기존 DB 결함이었다. W09-D로 먼저 고쳐 main에 병합했으므로 이 브리프는 그대로 진행한다.
- 구현 리뷰 r1 (2026-10-16, Claude) — 판정: **APPROVED**. 범위 밖 변경 없음, 화면 문구는 한국어만(가나 0건), 성공 응답 뒤 재조회만 하고 미리 반영하지 않음. Claude 리뷰 확인(2026-10-16, Node 24.19.0, Docker 29.1.3): lint 105파일·typecheck·unit 132/132·verify-artifacts·build:check 통과, api:news-test A/B/C 각 11/11·api:praise-test 통과. 브라우저(로컬 A): 실제 API에서 빈 상태 확인. 이어 GET 응답을 합성 목록으로 바꾸고 PATCH·POST는 가로채 DB 쓰기 없이 검사했다. 미읽음 점과 숨김 문구, 320/360/393/768/1280px 가로 넘침 0·44px 미만 조작부 0, 읽음 PATCH {read:true} 뒤 목록 재조회·배지 해제, 연결 관리로 이동, 취소 확인 시트 문구와 POST 뒤 재조회·'취소한 칭찬' 표시, 조회 503 오류 문구와 다시 불러오기 회복, 더 보기 cursor 요청과 항목 추가를 확인했다.
