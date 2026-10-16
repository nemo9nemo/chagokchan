# W20-B 목업 기반 화면 재설계

- 상태: DONE (2026-10-16 구현 리뷰 r2 APPROVED, TC-UI-MOCKUP-001 전체 수락은 W15)
- 작성: Claude / 날짜: 2026-10-15
- 구현 브랜치: codex/W20-B-mockup-ui
- 선행: W20-A(태그 API)가 main에 병합되어 있어야 한다.
- 참조: REQ-002·003·004·011, NFR-002 / TC-UI-003·TC-WEB-004·TC-WEB-005·TC-UX-001, TC-UI-MOCKUP-001(신규) / 진행표 W20-B(신규)
- 근거: 2026-10-14 사용자 결정. 목업 구조를 반영하되 판=목표 1:1, 알 개수는 사용자 설정(기본 20), 공유는 기존 연결·grant 유지, 추가 기능은 태그·메모만 넣는다.
- 기준 관계: 2026-10-15 사용자 결정으로 W20이 기준이다. 로컬 브랜치 `codex/w19-board-centered`의 보드 중심 재기획·W19 지시서(알 15개 고정, 판별 공유 코드, v2 별도 구축, IBM Plex)는 따르지 않는다.
- 목업 원본: claude.ai 디자인 캔버스 「차곡찬 목업」. 소스 사본은 `tmp/mockup/project/*.dc.html`(Git 제외, 로컬 참고용)이다. 아래에 필요한 값을 모두 옮겨 적었으므로 사본이 없어도 구현할 수 있다.

## 목표

1. 첫 화면과 판 화면이 목업의 흑백 바탕·포도 그래픽 구조로 바뀐다. 데이터와 권한 동작은 그대로다.
2. 칭찬 입력은 하단 시트(좁은 폭)와 패널(넓은 폭)에서 자동 표시값, 태그, 메모를 받는다. 저장 중·실패·성공 상태가 목업 규칙대로 보인다.
3. 공유판이 있는 판은 기존 연결 초대 코드와 판 권한 설정으로 이어진다.

## 화면 대응(목업 → 기존 화면)

| 목업 | 구현 위치 | 내용 |
| --- | --- | --- |
| B01 판 고르기 | UI02 내 목표 | 판이 하나도 없을 때: 제목 "판 고르기", 문구 "아직 판이 없어요. 판을 하나 골라 시작해요.", 포도판 카드(작은 포도 그래픽, "포도판", "알을 눌러 칭찬을 쌓아요") → B02. 판이 있을 때는 판 카드 목록과 "새 판 만들기"를 둔다. 카드에는 판 이름, `기록 n / 목표`, 공유 켬 배지를 넣는다. 목업의 도토리판·사과나무판 "검토 중" 카드는 **넣지 않는다**(없는 기능 노출 금지). |
| B02 판 만들기 | UI03 목표 생성 | 선택한 판(포도판), 이름(=목표 title, 필수 1~80자), 알 개수(=personal_target_count, 기본 20, 1~100, 숫자 입력), 공유 토글(기본 끔). 끔: "끄면 공유판을 만들지 않아요." 켬: "켜면 이 판의 공유판이 함께 만들어져요. 지인은 연결한 뒤 이 판에 초대해야 칭찬할 수 있어요." 켬이면 `shared_board: { title: 이름, target_count: 알 개수 }`로 `POST /goals` 한 번에 만든다. 기존 목표 생성 화면의 개인 메모·공유 설명 입력은 "더 보기" 접힘 안에 유지한다. 공유는 이 화면에서만 켤 수 있다고 안내한다("나중에 켤 수 없어요"). 이름 오류: "이름을 확인해 주세요" + `aria-invalid`·`aria-describedby`. |
| B03 공유 코드 | 판 화면의 공유 배지 → 공유 패널 | 배지는 공유판이 있으면 "공유 켬", 없으면 "공유 끔"이다. **기존 목표에 공유판을 나중에 추가하는 API(`createSharedBoard`)는 미구현이므로**, "공유 끔" 배지는 버튼이 아니라 상태 표시이고 툴팁·보조 문구로 "공유판은 판을 만들 때 켤 수 있어요"를 보여 준다. "공유 켬" 배지를 누르면 패널이 열린다. 패널 구성: ① **연결 코드** 영역: 문구 "이 코드로 연결한 사람만, 아래에서 허용하면 이 판에 칭찬할 수 있어요." 코드는 사용자 연결용이며 판 권한을 주지 않는다는 점을 숨기지 않는다. 패널을 열 때 `GET /connection-invites`에서 미사용·미폐기·미만료 초대가 있으면 메타만 보여 준다(코드 원문은 생성 응답에서만 받을 수 있으므로 "코드는 만들 때 한 번만 볼 수 있어요"). "새 코드 만들기"는 `POST /connection-invites`로 만들고 응답의 코드를 마스킹(`●●●●●●`)·보기/숨기기·복사로 보여 준다. 문구는 "코드는 비밀번호처럼 다뤄 주세요. 아무에게나 보여 주지 마세요." 이전 초대는 자동으로 폐기하지 않고, 각 활성 초대 옆의 "폐기" 버튼으로 기존 `DELETE /connection-invites/{id}`를 호출한다. 활성 초대 상한(5)에 걸리면 서버 오류를 "사용 중인 코드가 많아요. 이전 코드를 폐기한 뒤 만들어 주세요."로 보여 준다. 생성 응답이 유실되면 목록을 다시 읽어 새 초대 메타를 확인하되 코드 원문은 복구하지 않는다는 안내를 보여 준다. 사용 완료(`invite_already_used`)·만료·폐기는 각각 "이미 사용된 코드예요", "만료된 코드예요", "폐기한 코드예요"로 구분한다. ② **이 판에 칭찬할 수 있는 사람**: 기존 UI07 grant/revoke를 그대로 옮긴다. 코드 원문은 컴포넌트 상태에만 두고 패널을 닫으면 지운다. "공유 중지"는 API가 없어 넣지 않는다. |
| B04 내 판 | UI04 목표 상세 | 헤더: "판 고르기"(목록으로), "차곡찬", 공유 배지. 본문: "포도판" 라벨, 판 이름 h1, `기록 {valid_count}` + `/ {target_count}`. 포도 그래픽 섹션과 "최근 기록" 목록이 넓은 폭에서는 나란히(flex 3:2, wrap), 좁은 폭에서는 위아래로 놓인다. 개인 기록 / 받은 칭찬 전환과 지난 회차는 기존 기능을 유지해 그래픽 위 탭으로 둔다. |
| B05 칭찬 입력 | UI05 개인 기록 작성 | 760px 이하는 하단 시트(위 모서리 24px, 상단 2px 테두리, 손잡이 막대), 그 이상은 그래픽 옆 패널. 항목: 판 이름과 `n번째 알`(=valid_count+1), 자동값 2칸(날짜·시간=현재 시각 표시, 작성자=내 닉네임, 각각 "자동" 배지, 편집 컨트롤 없음), 태그(선택) 단일 선택 칩 5개(`aria-pressed`), 메모(선택) textarea(placeholder "짧게 적어 보세요", 최대 1000자), 저장 버튼. 기존 "실천한 날" 입력은 **유지**한다. 자동값 칸 아래 "다른 날로 기록" 접힘 버튼 안에 둔다(정책 `self_occurred_on_backdate_days_max` 유지). 사진 버튼은 넣지 않는다. |
| B06 저장 상태 | UI05 | 저장 중: 버튼 "저장 중…" + 회전 아이콘, 입력 비활성, 그래픽·개수 변화 없음. 실패: `role="alert"` "저장하지 못했어요 / 연결이 끊겼어요. 입력한 내용은 그대로 있어요."와 버튼 "다시 저장". 기존 idempotent 재시도 키를 그대로 쓴다. 성공 확인 뒤에 응답의 `bunch_id`로 판·회차·칭찬 목록을 **다시 조회**하고(현재 `submitPraise` 흐름 유지), 조회된 `valid_count`로 그래픽을 그린다. 화면 값에 1을 더하지 않는다(다른 탭의 변경·회차 전환·재확인 replay 대비). 응답 praise `id`가 목록 맨 위에 있으면 "방금" 배지와 0.4초 pop 애니메이션을 1회 보여 준다. 같은 praise id(replay 포함)에는 애니메이션을 다시 재생하지 않는다(마지막으로 재생한 id를 메모리에 둔다). 회차가 완성되어 새 회차로 넘어간 경우에는 pop 대신 기존 완성 안내를 보여 준다. `prefers-reduced-motion: reduce`이면 애니메이션 없이 정지 링과 "저장됨" 배지를 보여 준다. 상태 문구는 `aria-live="polite"`로 알린다. |
| B07 기록 상세 | 최근 기록 항목 → 상세 패널 | 판 이름, `n번째 알`, 메모(없으면 "칭찬 1건"), 태그 칩, 작성자, 날짜·시간 정의 목록. 기존 셀프 메모 수정·취소·peer 숨김/제외 동작을 이 패널로 옮긴다. 취소 확인은 하단 시트: "이 기록을 취소할까요?", 기존 취소 효과 안내 문구, 취소/확인 버튼. |
| 반응형 | 전체 | 320·360·393·768·1280px에서 가로 넘침이 없어야 한다. 기능은 폭과 관계없이 같다. |
| 캡처 보기 | — | 넣지 않는다. |

연결(UI06)·지인의 공유판(UI08)·휴지통(UI10) 화면은 구조를 바꾸지 않고 새 토큰과 컴포넌트 스타일만 적용한다. 지인의 공유판에서도 포도 그래픽을 보여 준다(읽기 전용, peer 입력은 기존 메모만 받는다).

## 시각 규칙(목업 값)

- 바탕 #FFFFFF, 글자·선 #000000. 테두리는 1.5px solid #000, 강조 카드 2px. 모서리는 카드 20px, 입력·목록 14px, 배지 999px.
- 포도 토큰(테마 `grape`): 기록 알 `--unit-filled #5B2A8C`, 빈 알 `--unit-empty #EEE5F7` + `--unit-filled` 점선 테두리, 성공 링 `--unit-success #7A44B8`, 줄기 `--stem #5A3A22`, 잎 `--leaf #3E7B3A`. 기록 유무는 채움과 점선으로도 구분한다(색 외 구분).
- 기본 버튼: 검정 바탕·흰 글자, 높이 54~56px, 모서리 14px. 보조 버튼: 흰 바탕·검정 테두리. 모든 조작부는 44px 이상.
- 포커스: `outline 3px solid #000; outline-offset 3px`.
- 글꼴: 이번 작업에서는 웹폰트를 받지 않는다. 시스템 글꼴 스택을 유지한다(빌드의 네트워크 의존을 피하기 위함). IBM Plex Sans KR 도입은 후속 결정으로 남긴다.
- 테마: W11-A의 의미 토큰 구조와 정원/포도 전환을 유지하되 **기본값을 `grape`로** 바꾼다. 정원 테마에도 위 `--unit-*` 토큰(녹색 계열, 대비 기준 충족)을 정의한다. 테마 전환은 계속 저장하지 않는다.
- 아이콘은 인라인 stroke SVG이며 `aria-hidden="true"`. 이모지·장식 문자(✳ ♡ ↗ 등)는 제거한다.

## 포도 그래픽 컴포넌트

- 새 파일 `src/app/grape-cluster.tsx`. props: `target: number`, `filled: number`, `state: "idle" | "saving" | "success"`, `reducedMotion` 또는 CSS 미디어쿼리, `onNext?: () => void`.
- 배치: 1~100개. 행 크기 k를 `k(k+1)/2 ≥ target`을 만족하는 최소 정수로 정하고, 위에서부터 k, k-1, …개를 배치한다. 마지막에 넘치는 자리는 버린다. 각 행은 가운데 정렬하고 행 간격은 지름×0.92, 알 간격은 지름×1.1이다. 지름은 컨테이너 폭/(k×1.1)로 정하되 최대 56px이다. SVG 하나로 그리고 줄기·잎을 위에 둔다(목업 Grape 비율: 줄기 폭 d×0.14·높이 d×0.95, 잎 d×1.0×0.5, -14° 회전).
- 앞에서부터 `filled`개를 채운다. 회차의 알 순서는 순차다. 목업처럼 임의의 알을 고르는 방식은 쓰지 않는다. 기존 모델이 칭찬 1건 = 다음 1알이기 때문이다.
- 그래픽 전체는 `role="img"`이고 `aria-label="포도판, {target}알 중 {filled}알 기록"`이다. 다음 빈 알 하나만 포인터 클릭으로 `onNext`를 호출하고 `tabindex=-1`이다. 키보드·읽기 도구용 주 조작은 그래픽 아래 전폭 버튼 "칭찬 남기기"(44px 이상)다.
- 회차가 완성되면(`progress_state=complete`) 버튼 대신 기존 완성 안내와 다음 회차 흐름을 유지한다.

## 범위

- `src/app/client-app.tsx`: 위 화면 대응대로 마크업과 상태를 재구성한다. 컴포넌트 분리는 아래 신규 파일 수준으로 제한한다.
- `src/app/globals.css`: 토큰과 컴포넌트 스타일을 다시 작성한다.
- 신규: `src/app/grape-cluster.tsx`, `src/app/praise-sheet.tsx`(B05·B06 입력 시트/패널), `src/app/share-panel.tsx`(B03).
- 신규 단위 테스트 `scripts/grape-layout.test.mjs`: 배치 함수를 순수 함수(`src/app/grape-layout.mjs`)로 분리하고 1·15·20·100개 배치 수와 행 구성을 검사한다. `package.json`의 `test` 목록에 추가한다.

## 하지 말 것

- 서버 API·DB·마이그레이션·`contracts/openapi.json`을 수정하지 않는다. W20-A 계약을 그대로 쓴다. 필요한 API가 없으면 구현하지 말고 보고한다.
- 브라우저에 Supabase 클라이언트·키를 두지 않는다. 모든 데이터는 `/api/v1/*`로만 다룬다.
- 성공 응답 전에 개수·알·목록을 낙관적으로 바꾸지 않는다. 실패 시 입력을 보존하고 같은 멱등 키로 재시도한다.
- 개인/공유 개수를 합산하거나 같은 그래픽에 섞지 않는다. 판 전환 탭으로 분리한다.
- 테마 선택·초대 secret·사용자 데이터를 `localStorage`·`sessionStorage`·쿠키·서비스 워커 캐시에 저장하지 않는다.
- 웹폰트·UI 라이브러리 등 의존성을 추가하지 않는다.
- 목업의 사진·캡처 보기·도토리판/사과나무판·공유 중지·작성자 변경 UI를 만들지 않는다.
- 기존 접근성 장치(본문 건너뛰기, `aria-busy`, 오류 재시도, 44px 조작부)를 없애지 않는다.

## 구현 단계

1. `src/app/grape-layout.mjs` + `scripts/grape-layout.test.mjs`: 배치 순수 함수와 테스트를 만든다. 검증: `node --test --test-isolation=none scripts/grape-layout.test.mjs`
2. `src/app/grape-cluster.tsx`: SVG 렌더링, 상태 애니메이션, reduced-motion 처리. 검증: `.\scripts\project.ps1 -Task check`
3. `src/app/globals.css`: 토큰 재작성(기본 grape, garden 대응값), 버튼·카드·배지·시트·포커스 스타일, 760px 이하 시트 배치, 320px 대응. 검증: `check`
4. `src/app/client-app.tsx` UI02/UI03: 판 고르기(빈 상태)·판 목록 카드·판 만들기 폼(이름·알 개수·공유 토글). 검증: `check`
5. UI04/UI05/B06/B07: 판 화면, `praise-sheet.tsx`(태그 칩은 W20-A의 `tag`로 전송, 날짜 접힘), 최근 기록·상세 패널, 취소 확인 시트. 검증: `check`, `build:check`
6. `src/app/share-panel.tsx`: 초대 코드 생성·보기·복사·다시 만들기, 연결된 사람 grant/revoke. 검증: `check`
7. UI06/UI08/UI10에 새 스타일을 적용하고 UI08에 읽기 전용 포도 그래픽을 넣는다. 검증: `check`, `build:check`
8. 문서(진행표 W20-B 행 갱신 포함): `docs/design/user-flows.md` 화면 표와 설명을 판 용어·목업 대응으로 갱신한다. `docs/quality/test-cases.json`에 `TC-UI-MOCKUP-001`(화면 대응·성공 전 미반영·reduced-motion·5개 폭 무넘침·44px)을 추가한다. W11-A 관련 TC의 기본 테마 문구도 갱신한다. 변경 기록 `docs/changes/<날짜>-w20-b-mockup-ui.md`를 쓰고, 진행표 W20-B와 등록부를 갱신한다.

## 함께 갱신할 기준 파일

docs/design/user-flows.md, docs/quality/test-cases.json, docs/quality/verification-plan.md, docs/development/backlog.md, docs/development/artifact-register.json, docs/development/codex-project-handoff.md, 변경 기록·검사 증거

## 완료 기준

- [ ] 판이 없을 때 판 고르기 → 판 만들기 → 판 화면으로 이어지고, 공유 켬이면 공유판이 함께 생성된다. 공유판 없는 판에는 공유를 켜는 조작이 없다.
- [ ] 포도 그래픽이 1~100개 목표에서 넘침 없이 그려지고, 채운 알 수가 현재 회차 `valid_count`와 같다.
- [ ] 칭찬 저장 성공 전에는 알·개수·목록이 바뀌지 않는다. 성공 후 값은 재조회 결과와 같다. 실패 시 입력이 남고 "다시 저장"이 같은 멱등 키를 쓴다. replay에는 애니메이션이 다시 재생되지 않는다.
- [ ] 태그 0~1개와 메모가 저장되고 최근 기록·상세에 보인다.
- [ ] reduced-motion에서 애니메이션 없이 "저장됨"이 보인다.
- [ ] 320/360/393/768/1280px에서 가로 넘침이 없고 노출된 조작부가 44px 이상이다(브라우저 측정).
- [ ] 두 테마 모두 본문 글자 4.5:1, 24px 이상 3:1 대비를 통과한다.
- [ ] 공유 패널의 초대 코드 원문이 저장소·URL에 남지 않고, 패널을 닫으면 메모리에서 지워진다. 코드가 판 권한을 주는 것처럼 표시하지 않는다.
- [ ] 초대 상한·사용 완료·만료·폐기·생성 응답 유실 상태를 구분해 안내한다.

## 검증 명령

```
.\scripts\project.ps1 -Task check
.\scripts\project.ps1 -Task build:check
.\scripts\project.ps1 -Task api:praise-test
.\scripts\project.ps1 -Task api:goal-test
.\scripts\project.ps1 -Task api:connection-test
```

브라우저 검사(5개 폭 레이아웃, 대비, reduced-motion, 성공 전 미반영)는 리뷰 단계에서 Claude가 로컬 fixture로 실행해 `docs/quality/reports/w20-b-mockup-ui-check-<날짜>.json`에 기록한다. 실기기 검사는 W15의 TC-WEB-006에 남는다.

## Codex 구현 보고

- 구현일: 2026-10-15 / 소스 기준: `c391d8f073bec68b08935377e61336f2703cbcad` + 미커밋 변경 / 브랜치: `codex/W20-B-mockup-ui`
- 상태: **구현·샌드박스 검사 완료, 통합/브라우저 검사·Claude 리뷰 대기. W20-B IN_PROGRESS.** 사용자 지시로 커밋·push하지 않았다. 아래 브라우저 완료 조건은 아직 통과 처리하지 않았다.

### 변경 파일

| 파일 | 변경 |
| --- | --- |
| `src/app/client-app.tsx` | B01~B04 판 목록/생성/상세, 태그·자동 닉네임 연결, 성공 bunch_id/목록 재조회·replay pop 억제, B07 상세/취소 시트, 공유 패널/기존 권한 관리, UI08 읽기 전용 포도 그래픽 |
| `src/app/globals.css` | 흑백 바탕·기본 포도/정원 의미 토큰·포커스·44px 조작부·반응형 시트/패널·pop/reduced-motion |
| `src/app/grape-layout.mjs`, `scripts/grape-layout.test.mjs` | 순수 배치 함수, 1/15/20/100 행·개수 및 1~100 전체의 폭/경계 검사 6개 |
| `src/app/grape-cluster.tsx` | 단일 SVG·줄기/잎·순차 알·다음 빈 알 단축 조작·상태 링/애니메이션 |
| `src/app/praise-sheet.tsx` | native dialog의 좁은 폭 modal 시트/넓은 폭 패널, 자동 시각/실제 닉네임·고정 태그·메모·실천일 접힘·재시도 |
| `src/app/share-panel.tsx` | 초대 메타·마스킹/보기/복사·개별 폐기·생성 실패 재조회·닫을 때 secret 제거 |
| `package.json` | 기존 test 목록 끝에 grape-layout 테스트 추가, 의존성 변경 없음 |
| `docs/design/user-flows.md`, `docs/quality/test-cases.json`, `docs/quality/verification-plan.md` | 화면 대응·TC-UI-MOCKUP-001(not_run)·기본 포도 테마·검증 계획/한계 |
| `docs/development/backlog.md`, `docs/development/artifact-register.json`, `docs/development/codex-project-handoff.md` | W20-B IN_PROGRESS·검사 범위·다음 Claude 리뷰 인계 |
| `docs/changes/2026-10-15-w20-b-mockup-ui.md`, `docs/quality/reports/w20-b-mockup-ui-check-2026-10-15.json`, 이 브리프 | 변경/명령/오류/소스 증거와 구현 보고 |

### 실행 명령과 결과

환경: Windows PowerShell 샌드박스, Node `24.19.0`, pnpm 실제 `11.25.0`/고정 `11.19.0`, Biome `2.5.15`, TypeScript `5.9.3`.

| 순서·명령 | 실제 결과 |
| --- | --- |
| 1. `pnpm lint` | 버전 검사 실패. 첫 오류: `[ERR_PNPM_UNSUPPORTED_ENGINE] Unsupported environment (bad pnpm and/or Node.js version)` |
| 1 대체. `.\node_modules\.bin\biome.cmd lint --error-on-warnings .` | 초기 lint 지적 수정 후 통과, 102파일·오류/경고 0 |
| 2. `pnpm typecheck` | 같은 pnpm 버전 오류로 실패 |
| 2 대체. `.\node_modules\.bin\tsc.cmd --noEmit` | 통과 |
| 3. `node --test --test-isolation=none <package.json scripts.test의 전체 13개 파일>` | 새 grape-layout 6개 포함 **126/126 통과**, 실패/skip 0. 실제 전체 인자는 검사 증거 JSON에 기록 |
| 4. `pnpm check:artifacts` | 같은 pnpm 버전 오류로 실패 |
| 4 대체. `node scripts/verify-artifacts.mjs` | JSON·링크·REQ/POL/TC·등록부·개발 상태 구조 검사 통과. 문서 갱신 뒤 재실행 결과도 증거에 기록 |
| `.\scripts\project.ps1 -Task check` | pnpm 버전 오류. 사용자 지시에 따라 pnpm test/check 우회는 위 직접 lint/type/unit/artifact로 수행 |
| `.\scripts\project.ps1 -Task build:check` | pnpm 버전 오류 |
| `.\scripts\project.ps1 -Task api:praise-test` | pnpm 버전 오류 |
| `.\scripts\project.ps1 -Task api:goal-test` | pnpm 버전 오류 |
| `.\scripts\project.ps1 -Task api:connection-test` | pnpm 버전 오류 |
| `node scripts/app.mjs build-check` | Next 16.4.0 컴파일 성공 뒤 TypeScript 단계 실패. 첫 오류: `spawn EPERM`. 빌드 완료 아님 |
| `node scripts/test-local-personal-praise-api.mjs` | 검사 전 앱 종료. 첫 오류: `Error: The local app exited before the personal-praise API check.` |
| `node scripts/test-local-goal-api.mjs` | 검사 전 앱 종료. 첫 오류: `Error: The local app exited before the goal API check.` |
| `node scripts/test-local-connection-api.mjs` | 검사 전 앱 종료. 첫 오류: `Error: Local app exited before connection API checks completed.` |
| `docker version --format '{{.Client.Version}} / {{.Server.Version}}'` | CLI 29.1.3, 엔진 조회 실패. 첫 오류: `permission denied while trying to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine` |

### 실행하지 못한 검사와 이유

- 빌드 전체와 실제 DB/API 통합: 위 명령을 실제 시도했으나 샌드박스/pnpm 제약으로 완료하지 못했다. DB 버전·적용 상태·실제 제공자 로그인 검증을 이번 결과로 주장하지 않는다.
- TC-UI-MOCKUP-001 브라우저 검사: 브리프가 Claude 리뷰 단계에서 수행하도록 지정한 5개 폭 넘침/44px/대비·reduced-motion·저장 전 미반영/후 재조회·실패 입력/같은 키·replay·초대 secret 검사는 미실행. 기존 W11 통과 기록으로 대체하지 않았다.
- 실기기 TC-WEB-006/TC-CACHE-001: 기존 W15 범위로 유지.

### 브리프와 다르게 한 부분·범위 밖 필요 사항

- 기존 서버가 `active_invite_limit`, `invite_already_used`, 만료/폐기 세부 사유를 `STATE_CONFLICT` 또는 `OBJECT_NOT_AVAILABLE`로 통합한다. 서버/계약 변경은 범위 밖이므로 수정하지 않았다. 목록 메타의 사용 완료/만료/폐기는 구분하고 생성 409 뒤 활성 초대 5개를 확인할 때 상한 문구를 표시한다. 받은 코드의 실패 사유를 HTTP 응답만으로 항상 구분하는 완료 조건은 충족했다고 표시하지 않았다. 세부 오류 노출이 필요하면 별도 서버 브리프가 필요하다.
- 불확실한 칭찬 재시도 중에는 같은 본문/키가 다른 판으로 전송되지 않도록 판·메뉴 전환을 잠근다. 완성 회차는 기존 다음 칭찬 시 새 회차 생성 모델에 맞춰 “다음 회차 시작하기”에서 입력을 연다.
- 성공 응답의 과거 bunch_id가 첫 회차 페이지 밖이면 찾을 때까지 다음 페이지를 읽는다. 공유 초대/연결도 페이지 끝까지 읽어 오래된 활성 초대와 연결을 누락하지 않는다.
- 목업 사본은 읽기 참고만 했고, 서버·DB·마이그레이션·API 계약·정책·의존성/잠금 파일은 변경하지 않았다.

### r2 수정

- 수정일: 2026-10-16 / 기준: 구현 리뷰 r1의 WARNING 1건 / 소스: `c391d8f073bec68b08935377e61336f2703cbcad` + 기존 미커밋 변경 / 브랜치: `codex/W20-B-mockup-ui`.
- 변경 파일: `src/app/share-panel.tsx`, `docs/plans/W20-B-mockup-ui.md`(이 보고). 코드 생성 성공 뒤 목록 재조회 실패 문구를 정확히 "코드를 만들었어요. 사용 중인 코드 목록을 다시 불러와 주세요."로 바꿨다. 참고 2~4번과 기존 미커밋 변경은 수정하지 않았다. 커밋·push하지 않았다.
- 화면 문구 점검: `node` 표준 입력 스크립트로 TypeScript AST의 JSX 본문·문자열·템플릿·접근성/입력 안내 속성을 확인하고, 메타데이터·PWA/오프라인 문구·태그 이름·CSS 생성 문구도 읽었다. `src`와 `public`의 소스 58개를 문자권별로 검색해 수정 후 일본어(히라가나·가타카나·한자), 키릴·아랍·그리스·데바나가리 문자 일치 0건을 확인했다. 사용자 입력과 실제 브라우저 표시 전체를 검증한 결과는 아니다.
- 추가 발견(점검만): `src/app/client-app.tsx`에 기존 영어 보조 제목 11곳이 남아 있다. `PEOPLE & PERMISSIONS`(58), `ONE-TIME INVITE`(64), `REQUESTS`(83), `CONNECTIONS`(92), `INVITES`(100), `BLOCKED`(111), `GOAL TRASH`(124), `SHARED WITH ME`(146), `A WORD FOR YOUR FRIEND`(162), `PRAISES I SENT`(165), `GOAL SETTINGS`(1196). WARNING 수정 외에는 문구 점검만 수행했으므로 변경하지 않았고, 한국어 아닌 화면 문구가 전혀 없다고 판정하지 않았다. 브랜드 영문 `Chagokchan`도 기존 표기를 유지한다.

환경: Windows PowerShell 샌드박스, Node `24.19.0`, Biome `2.5.15`, TypeScript `5.9.3`. 사용자 지정 검증을 실제 실행했다.

| 실행 명령 | 결과 |
| --- | --- |
| `.\node_modules\.bin\biome.cmd lint --error-on-warnings .` | 통과(exit 0), 102파일, 오류·경고 0, 자동 수정 없음 |
| `.\node_modules\.bin\tsc.cmd --noEmit` | 통과(exit 0) |
| 아래 전체 13파일의 `node --test --test-isolation=none ...` | 126/126 통과(exit 0), 실패·취소·skip·todo 0 |
| `node scripts/verify-artifacts.mjs` | 통과(exit 0), JSON 42개·로컬 Markdown 링크 532개·등록 산출물 306개·REQ/POL/TC/개발 상태 구조 검사. 보고 추가 후에도 재실행 |

실제 단위 테스트 명령(파일 목록은 `package.json`의 `scripts.test`에서 읽음):

```powershell
node --test --test-isolation=none scripts/runtime-environment.test.mjs scripts/docker-loopback-proxy.test.mjs scripts/local-fixture-manifest.test.mjs scripts/local-user-session.test.mjs scripts/api-security.test.mjs scripts/goal-api.test.mjs scripts/praise-api.test.mjs scripts/board-api.test.mjs scripts/connection-api.test.mjs scripts/news-api.test.mjs scripts/idempotent-request.test.mjs scripts/service-worker.test.mjs scripts/grape-layout.test.mjs
```

미실행: 빌드·DB/API 통합·브라우저·실기기 검사는 이번 문구 수정에서 재실행하지 않았다. 사용자 지정 검증 4종과 소스 문구 점검을 수행했으며, 이전 리뷰 결과를 이번 실행 결과로 대체하지 않았다.

| 작업 | 상태 | 완료 범위·다음 행동 |
| --- | --- | --- |
| W20-B r2 | IN_PROGRESS | WARNING 문구 수정·지정 검사 통과·화면 문구 점검 완료. 영어 보조 제목 잔존 보고, Claude 재리뷰 대기. 상위 작업 상태와 완료 체크는 변경하지 않음 |

## 리뷰 기록

- 브리프 리뷰 r1 (2026-10-15, Codex read-only): 나중에 공유판을 추가하는 경로 없음(P1), 초대 코드의 의미·상한·실패 구분(P2), 성공 후 +1 대신 재조회(P2), W19 기준 충돌을 반영했다.
- 구현 리뷰 r1 (2026-10-15, Claude) — 판정: **WARNING**. 동작·경계 위반은 없고, 사용자에게 보이는 문구 1건을 고쳐야 한다.
  - 직접 재실행(기준 `c391d8f` + 미커밋 변경, Node 24.19.0, Docker 29.1.3):
    - lint: 102파일 통과. typecheck 통과.
    - unit(격리 모드): 126/126.
    - verify-artifacts 통과. build:check 통과(빌드 완료).
    - API: `api:praise-test` 10/10, `api:goal-test` 3/3, `api:connection-test` A/B/C 각 12/12, `api:praise-tag-test` 통과.
  - 브라우저(로컬 A, 개발 서버):
    - 판 화면을 320·360·393·768·1280px에서 측정했다. 가로 넘침 0, 노출된 조작부 중 44px 미만 0, 대비 미달 글자 0. 정원 테마도 393px에서 대비 미달 0, 넘침 0.
    - 393px 칭찬 시트와 공유 패널의 배치를 확인했다.
    - 저장 실패 경로: fetch를 가로채 POST만 실패시켜 DB에 쓰지 않고 확인했다. 결과는 다음과 같다.
      - `role=alert`가 표시되고 입력(태그 용기, 메모)이 보존된다.
      - "다시 저장"이 같은 Idempotency-Key·같은 본문을 보낸다.
      - 그래픽 aria-label(20알 중 0알), 최근 기록 0개가 그대로다.
    - 저장 성공 경로는 fixture 보존을 위해 브라우저로 실행하지 않았다. 대신 코드로 확인했다: 성공 후 `openGoal(..., result.bunch_id)`로 다시 조회하고, `lastAnimatedId`로 replay 재생을 막는다. 성공 경로 자체는 `api:praise-tag-test`로 검증된다.
  1. WARNING `src/app/share-panel.tsx:43`
     - 문제: 코드 생성 뒤 목록 재조회가 실패하면 일본어 문구 "コードは作成できました。使用中のコード一覧を再読込してください。"를 보여 준다.
     - 근거: 한국어 서비스이고 AGENTS.md는 한국어 소통을 요구한다. 다른 모든 문구는 한국어다.
     - 기대: "코드를 만들었어요. 사용 중인 코드 목록을 다시 불러와 주세요." 같은 한국어 문구로 바꾼다.
  2. 참고 `src/app/praise-sheet.tsx:4`
     - 문제: 태그 목록을 쓰려고 `policies/app-policy.json` 전체를 브라우저 번들에 넣는다. 한도·rate limit 수치 등 공개 가능한 정책값이라 비밀 노출은 아니다.
     - 대안: 필요한 값(tag_catalog, backdate 일수)만 담은 작은 모듈로 줄이면 번들이 작아진다.
  3. 참고 `src/app/grape-cluster.tsx:29`
     - 문제: success 상태가 저장한 칭찬이 목록 맨 위에 있는 동안 유지된다. 판·회차를 바꿨다 돌아오면 SVG가 다시 마운트돼 pop 애니메이션이 한 번 더 재생될 수 있다.
     - 근거: 브리프는 같은 praise id에 대한 재생을 금지한다. 다만 지금 막는 대상은 요청 replay다.
  4. 참고 (Codex 보고): 초대 생성 실패의 세부 사유(상한·사용 완료·만료·폐기)는 서버가 `STATE_CONFLICT`·`OBJECT_NOT_AVAILABLE`로 합쳐 보내 HTTP 응답만으로 구분할 수 없다. 목록 메타로 구분하고, 409 뒤 활성 초대가 5개면 상한 문구를 보여 준다. 완전한 구분은 서버 브리프가 별도로 필요하다.
- 구현 리뷰 r2 (2026-10-16, Claude) — 판정: **APPROVED**.
  - `share-panel.tsx:43` 문구가 한국어로 바뀐 것을 확인했고, `src` 전체에서 가나 문자가 0건이다.
  - 재실행: lint 102파일, typecheck, unit 126/126, 산출물, build:check 모두 통과.
  - Codex가 보고한 영어 보조 제목 11곳은 W20-B 이전부터 있던 장식용 영문 제목이다(main 19곳에서 줄었다). 이번 범위 밖이라 그대로 두고 참고로 남긴다.
  - r1의 참고 2~4는 수정하지 않았다(사용자 결정 대기).
