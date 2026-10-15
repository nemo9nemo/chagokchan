# W20-A 셀프 칭찬 태그

- 상태: DONE (2026-10-15 PR 리뷰 r2 수정 재검증 APPROVED)
- 작성: Claude / 날짜: 2026-10-15
- 구현 브랜치: codex/W20-A-praise-tags
- 참조: REQ-003·REQ-007 / policies/app-policy.json `praise` / TC-PRAISE-TAG-001(신규) / operation createPraise·editSelfPraise·listBoardPraises / 진행표 W20-A(신규)
- 근거: 2026-10-14 사용자 결정. 목업(claude.ai 디자인 캔버스 「차곡찬 목업」 B05)의 태그를 기존 목표 중심 앱에 넣는다. 사진·캡처 보기는 넣지 않는다.
- 기준 관계: 2026-10-15 사용자 결정으로 W20이 기준이다. 로컬 브랜치 `codex/w19-board-centered`의 보드 중심 재기획(W18 기획·W19 지시서)은 참고 자료이며 이 작업의 기준이 아니다. 그 브랜치의 W18/W19 ID와 겹치지 않도록 W20을 쓴다.

## 목표

1. 개인판 주인이 셀프 칭찬을 만들거나 고칠 때 고정 목록에서 태그 0~1개를 고를 수 있다.
2. 판 칭찬 목록의 owner 응답에 `tag`가 포함된다. 칭찬을 취소하면 태그도 지워진다.
3. 태그 없는 기존 요청의 멱등 재시도 결과는 마이그레이션 전후로 같다.

## 확정한 설계

- 태그는 **셀프 칭찬 전용**이다. peer 칭찬의 tag는 항상 null이다.
- 칭찬 한 건당 태그는 0~1개다. 사용자 정의 태그는 없다.
- 코드와 표시 이름(정책 파일에 기록): `consistency`=꾸준함, `courage`=용기, `care`=배려, `growth`=성장, `rest`=쉼
- DB 열과 제약:
  - 열: `public.praises.tag text null`
  - `praises_tag_code check (tag is null or tag in (위 5개))`
  - `praises_peer_no_tag check (source <> 'peer' or tag is null)`
  - `praises_cancel_clears_tag check (cancelled_at is null or tag is null)`
- 열 권한: `grant select (tag), insert (tag), update (tag) on public.praises to chagokchan_rpc`만 추가한다. 기존 열 권한 방식(`20261008021400`의 12~15줄)을 따른다. `authenticated`·`anon`·`service_role`에는 주지 않는다.
- 취소: `cancel_praise`는 기존 UPDATE 한 문장에서 `message`·`occurred_on`과 함께 `tag = null`로 바꾼다. UPDATE를 둘로 나누면 중간 상태에서 제약에 걸린다.
- 작성자 계정 삭제 워커는 바꾸지 않는다. 워커가 익명화해 남기는 행은 peer뿐이고, peer 행의 tag는 이미 null이다. 셀프 기록은 삭제된다.
- 멱등 해시: `create_praise`의 `canonical_input`에 `tag` 키는 **tag가 null이 아닐 때만** 넣는다. 태그 없는 요청은 기존 해시와 같아야 한다. message 정규화, `occurred_on`, operation `createPraise`는 그대로 둔다.
- 오류 표기 구분:
  - DB 예외: 생성은 `PT400 invalid_praise_input`, 수정은 `PT400 invalid_praise_patch`, 멱등 불일치는 `PT409 idempotency_conflict`.
  - HTTP: 기존 변환대로 `INVALID_INPUT`(400)과 `IDEMPOTENCY_CONFLICT`(409).

## 범위

- 새 마이그레이션 `supabase/migrations/<20261008024900보다 큰 타임스탬프>_praise_tag.sql`:
  1. 열, 제약 3개, 열 권한을 추가한다.
  2. `public.create_praise`를 `(p_request_key uuid, p_board_id uuid, p_message text default null, p_occurred_on date default null, p_tag text default null)`로 새로 만든다. 본문은 최신 정의 `20261008021600_verified_actor_completion_notice.sql`을 기준으로 tag 검증·해시·INSERT만 추가한다. 그다음 옛 `create_praise(uuid,uuid,text,date)`를 drop한다. 새 함수에도 기존과 같은 owner `chagokchan_rpc`, `revoke all … from public, anon, authenticated, service_role`, `grant execute … to authenticated`, 고정 `search_path`, 스키마 한정을 적용한다.
  3. `public.create_personal_praise`(`20261008024600`)를 같은 방식으로 5인자로 다시 만든다. 내부 호출은 `public.create_praise(p_request_key, p_board_id, p_message, p_occurred_on, p_tag)`로 바꾸고, 옛 4인자를 drop한 뒤 owner·revoke·grant를 다시 적용한다. 순서: 새 `create_praise` 생성 → 새 wrapper 생성 → 옛 wrapper drop → 옛 `create_praise` drop.
  4. `public.edit_self_praise(p_praise_id uuid, p_patch jsonb)`의 **시그니처는 유지**한다(`create or replace`).
     - 허용 키에 `tag`를 추가한다: `p_patch - 'message' - 'occurred_on' - 'tag'`.
     - `tag` 키가 있을 때만 변경한다. 키가 없으면 유지, JSON null이면 삭제, 문자열이면 5개 코드 검사를 한다. 그 밖의 값은 `invalid_praise_patch`다.
     - no-op/replayed 판정에 tag 비교를 추가한다. 지금은 message·occurred_on만 비교한다.
  5. `public.cancel_praise`를 `create or replace`해 취소 UPDATE에 `tag = null`을 넣는다.
  6. `public.list_board_praises`(최신 `20261008022900`)를 `create or replace`한다. owner 투영에만 `tag`를 추가하고, contributor 투영에는 넣지 않는다(peer는 늘 null이고 응답을 최소로 유지하기 위함).
- `src/server/praise-api.mjs`:
  - 생성 요청 검증에 `tag`(생략 가능, null 또는 5개 코드)를 추가하고 `create_personal_praise`에 `p_tag`로 전달한다.
  - peer 판에 non-null tag가 오면 400 `INVALID_INPUT`이다. 판 종류는 기존 라우팅에서 판별하는 지점을 그대로 쓴다.
  - 수정 요청 검증에 `tag` 키를 허용하고 `p_patch`에 그대로 넣는다.
  - `projectOwnerPraise`의 fields에 `tag`를 추가한다. 검증 조건: null 또는 5개 코드, `source='peer'`이면 null, `cancelled_at`이 있으면 null.
  - `projectContributorPraise`는 바꾸지 않는다.
- `contracts/openapi.json`:
  - `PraiseTag` enum 스키마를 추가한다.
  - `CreatePraise`·`EditSelfPraise`에 `tag: PraiseTag | null`을 넣는다.
  - `PraiseOwner`에 required nullable `tag`를 넣는다. `PraiseContributor`는 그대로 둔다.
  - 설명에 셀프 전용임을 적는다.
- 기존 pgTAP 수정(허용 범위):
  - `supabase/tests/004_business_rpc_praise.test.sql` 17·23줄 부근: 함수 시그니처 문자열을 `(uuid,uuid,text,date,text)`로 바꾼다.
  - `supabase/tests/011_business_rpc_personal_praise_result.test.sql` 8~11줄 부근: 4인자 OID 배열과 권한 검사 문자열을 5인자로 바꾼다.
  - 계획된 테스트 수(`plan(n)`)가 바뀌면 함께 맞춘다.
  - 기존 `scripts/test-local-*.mjs`의 인자 이름 기반 RPC 호출은 `p_tag default null` 덕분에 그대로 동작하므로 고치지 않는다.
- 신규 `supabase/tests/015_business_rpc_praise_tag.test.sql`(pgTAP).
- 신규 `scripts/test-local-praise-tag-api.mjs`: 실제 로컬 Auth 세션 A로 다음을 확인한다.
  - 태그를 넣어 생성 → 판 칭찬 목록에서 tag 확인 → 수정으로 tag 변경·null 삭제 → 취소 후 tag null.
  - 같은 키·다른 tag 재전송은 409.
  - 만든 행은 기존 API 테스트처럼 합성 데이터로 정리하거나 fixture snapshot 보존 규칙을 따른다.

  `package.json`에 `api:praise-tag-test`를 추가하고, `scripts/project.ps1`의 ValidateSet에도 추가한다.
- `scripts/praise-api.test.mjs`: tag 입력 검증, owner allowlist의 tag 조건, peer 거절, 수정 패치의 tag 전달을 단위 테스트로 추가한다.

## 하지 말 것

- 적용된 마이그레이션 파일(`20261008024900` 이하)을 수정하지 않는다. 함수 변경은 새 마이그레이션에서만 한다.
- `praises`에 `authenticated` 직접 DML이나 열 권한을 주지 않는다. 업무 RPC로만 쓴다.
- SECURITY DEFINER 함수의 owner·고정 `search_path`·스키마 한정·내부 권한 검사·명시적 execute grant를 약하게 만들지 않는다. 옛 시그니처와 그 grant가 남지 않게 한다.
- `create_peer_praise`·계정 삭제 워커·`list_sent_praises`는 수정하지 않는다.
- 브라우저 코드(`src/app`)는 고치지 않는다(W20-B 범위).
- 태그를 개수 집계·회차 완성·소식에 쓰지 않는다.
- 사진·캡처·다중 태그·사용자 정의 태그를 만들지 않는다.

## 구현 단계

1. 정책·문서:
   - `policies/app-policy.json`에 `praise.tags_enabled_for: ["self"]`, `praise.tags_per_praise_max: 1`, `praise.tag_catalog`(5개 code/label)를 추가하고 `updated_on`을 갱신한다.
   - `docs/policies/product-rules.md`의 칭찬 절에 태그 규칙(셀프 전용, 0~1개, 취소 시 삭제, 집계 무관)을 적는다.
   - `docs/requirements/mvp-requirements.md` REQ-003 범위에 "태그(선택, 고정 목록 1개)"를 넣고 수락 기준에 "태그 유무가 개수에 영향 없음"을 넣는다.
   - `docs/data-erd.md`와 praises가 나오는 `docs/diagrams/*.mmd`에 `tag`를 넣는다.

   검증: `node scripts/verify-artifacts.mjs`
2. 마이그레이션 작성. 검증: `.\scripts\project.ps1 -Task db:migrate`
3. 기존 pgTAP `004`·`011`을 수정하고 `015`를 추가한다. `015`에서 확인할 것:
   - 새 열의 열 권한이 `chagokchan_rpc`에만 있음
   - tag 저장
   - 잘못된 코드 거절
   - 같은 키·같은 tag 재시도는 replay
   - 같은 키·다른 tag는 `idempotency_conflict`
   - tag 없는 요청의 `input_hash`가 `canonical_input`(tag 키 없음) 해시와 같음
   - edit로 tag 변경(replayed=false), 같은 tag 재전송(replayed=true), null 삭제, 키 생략 시 유지, 잘못된 값은 `invalid_praise_patch`
   - peer 행 tag 금지
   - cancel 후 tag null
   - owner 목록에 tag 있고 contributor 목록에 tag 키 없음
   - 옛 4인자 `create_praise`·`create_personal_praise`가 `pg_proc`에 없음

   검증: `db:test`, `db:praise-test`, `db:praise-result-test`, `db:deletion-test`
4. `src/server/praise-api.mjs`·`contracts/openapi.json`을 수정하고 단위 테스트를 추가한다. 검증: `check`
5. `scripts/test-local-praise-tag-api.mjs`와 task를 추가한다. 검증: `api:praise-tag-test`, `api:praise-test`, `api:board-test`
6. `docs/quality/test-cases.json`에 `TC-PRAISE-TAG-001`(REQ-003·REQ-007)을 추가한다. 실행 결과에 맞춰 status·evidence를 넣는다. `docs/quality/verification-plan.md`의 TC 개수를 갱신한다. 검사 증거 `docs/quality/reports/w20-a-praise-tag-check-<날짜>.json`과 변경 기록 `docs/changes/<날짜>-w20-a-praise-tag.md`를 쓴다.
7. `docs/development/backlog.md`:
   - 메인 표에 W20 행(목업 기반 화면 재설계·칭찬 태그, 의존 W08~W11)을 추가한다.
   - 하위 표에 W20-A·W20-B 행을 추가하고 W20-A 상태를 갱신한다.
   - `artifact-register.json`의 `current_stage`와 S06 상태를 맞춘다.

## 함께 갱신할 기준 파일

policies/app-policy.json, docs/policies/product-rules.md, docs/requirements/mvp-requirements.md, docs/data-erd.md, docs/diagrams/*.mmd, contracts/openapi.json, docs/quality/test-cases.json, docs/quality/verification-plan.md, docs/development/backlog.md, docs/development/artifact-register.json, package.json, scripts/project.ps1, 변경 기록·검사 증거

## 완료 기준

- [ ] 셀프 칭찬 생성·수정에서 5개 코드 중 하나 또는 null이 저장되고 owner 목록 응답에 나온다.
- [ ] 알 수 없는 코드는 DB(PT400)와 API(400 `INVALID_INPUT`)에서 거절된다.
- [ ] peer 판에 tag를 보내면 400이고, DB에도 peer 행의 tag가 저장될 수 없다.
- [ ] 취소한 칭찬의 tag는 null이다.
- [ ] 같은 요청 키의 tag 불일치는 409이고, tag 없는 요청의 해시는 기존과 같다.
- [ ] 회차 개수·완성 결과가 태그와 무관하다.
- [ ] 옛 4인자 함수와 그 grant가 남지 않고, tag 열 권한은 `chagokchan_rpc`에만 있다.
- [ ] 실제 로컬 세션으로 생성→조회→수정→취소 경로를 통과한다.

## 검증 명령

```
.\scripts\project.ps1 -Task check
.\scripts\project.ps1 -Task db:migrate
.\scripts\project.ps1 -Task db:test
.\scripts\project.ps1 -Task db:praise-test
.\scripts\project.ps1 -Task db:praise-result-test
.\scripts\project.ps1 -Task db:deletion-test
.\scripts\project.ps1 -Task api:praise-tag-test
.\scripts\project.ps1 -Task api:praise-test
.\scripts\project.ps1 -Task api:board-test
.\scripts\project.ps1 -Task build:check
```

Codex 샌드박스에서는 lint·typecheck·unit(`node --test --test-isolation=none …`)·`node scripts/verify-artifacts.mjs`만 실행한다. DB·API 통합 검사와 빌드는 리뷰 단계에서 Claude가 샌드박스 밖에서 다시 실행한다. 실행하지 않은 검사는 미실행으로 보고한다.

## Codex 구현 보고

2026-10-15 / 기준 HEAD `cf54261746459e3faa98b397df9f8a4ba33c3c43` / 브랜치 `codex/W20-A-praise-tags`. 구현 코드 작성과 가능한 샌드박스 검사를 마쳤다. DB 적용·pgTAP·실제 API 성공 경로·빌드 완료·Claude 구현 리뷰는 미검증이다. W20-A는 `IN_PROGRESS`, TC-PRAISE-TAG-001은 `not_run`으로 남겼다. 커밋·push는 하지 않았다.

### 변경 파일

- 정책·요구: `policies/app-policy.json`, `docs/policies/product-rules.md`, `docs/requirements/mvp-requirements.md` — self 태그 5종·0~1개·수정 키 생략/명시적 null·취소 삭제·집계 무관 규칙.
- 설계·계약: `docs/data-erd.md`, `docs/diagrams/data-erd-core.mmd`, `docs/diagrams/data-erd-connections.mmd`, `docs/diagrams/data-erd-operations.mmd`, `docs/diagrams/data-erd-full.mmd`, `contracts/openapi.json` — nullable tag, owner 필수 응답, peer/취소 시 null 및 TC 연결. contributor 스키마는 유지.
- DB: `supabase/migrations/20261008025000_praise_tag.sql` — 열·제약 3개·RPC 소유자 열 권한, 생성 함수 5인자 전환/옛 시그니처 제거, edit/cancel/owner 목록 변경. 태그가 null이면 기존 canonical input을 유지한다. 적용된 마이그레이션은 수정하지 않았다.
- 서버: `src/server/praise-api.mjs` — self 생성·수정·owner 응답 검증, peer non-null tag 거절. contributor 투영은 유지.
- 검사: `supabase/tests/004_business_rpc_praise.test.sql`, `supabase/tests/011_business_rpc_personal_praise_result.test.sql` — 허용된 함수 시그니처·OID 변경만 적용. 신규 `supabase/tests/015_business_rpc_praise_tag.test.sql`에 40개 DB assertion. `scripts/praise-api.test.mjs`는 18개(신규 태그 시나리오 5개 포함). 신규 `scripts/test-local-praise-tag-api.mjs`는 실제 서버 A 세션·합성 목표의 생성→조회→수정→취소·409·집계 불변과 제품 fixture snapshot 보존을 검사하도록 작성했다.
- 실행 task: `package.json`, `scripts/project.ps1` — `api:praise-tag-test` 추가. 의존성 변경 없음.
- 추적·증거: `docs/quality/test-cases.json`, `docs/quality/verification-plan.md`, `docs/development/backlog.md`, `docs/development/artifact-register.json`, `docs/quality/reports/w20-a-praise-tag-check-2026-10-15.json`, `docs/changes/2026-10-15-w20-a-praise-tag.md`, 이 브리프의 구현 보고.

총 25개 파일이며 브리프 범위 밖 파일은 수정하지 않았다. 기존 미추적 파일 `docs/plans/W20-B-mockup-ui.md`도 수정하지 않았다.

### 실행 명령과 결과

환경: Windows PowerShell 샌드박스, Node `24.19.0`, PATH pnpm `11.25.0`(프로젝트 고정값 `11.19.0`과 다름), 설치된 Biome `2.5.15`, TypeScript `5.9.3`. Docker/DB 실제 버전은 이번에 확인하지 못했다.

사용자가 지정한 아래 순서로 실제 시도했다. pnpm 실패 뒤에는 프로젝트 설정을 바꾸지 않고 같은 설치 도구를 직접 실행했다.

| 순서 | 명령 | 결과 |
| --- | --- | --- |
| 1 | `pnpm lint` | exit 1, `[ERR_PNPM_UNSUPPORTED_ENGINE] Unsupported environment (bad pnpm and/or Node.js version)` — 고정 pnpm 불일치. 임시 환경 변수/CLI engine-strict=false 재시도도 같은 오류 |
| 1 대체 | `.\node_modules\.bin\biome.cmd lint --error-on-warnings .` | exit 0, 97파일, 경고·오류 없음 |
| 2 | `pnpm typecheck` | exit 1, 같은 `ERR_PNPM_UNSUPPORTED_ENGINE` |
| 2 대체 | `node node_modules/typescript/bin/tsc --noEmit` | exit 0 |
| 3 | 아래 전체 unit 명령 | exit 0, 120/120 통과, 실패·skip 0 |
| 4 | `pnpm check:artifacts` | exit 1, 같은 `ERR_PNPM_UNSUPPORTED_ENGINE` |
| 4 대체 | `node scripts/verify-artifacts.mjs` | exit 0, 75 TC·REQ/POL/API·ERD 원본/내장 일치·JSON·문서 링크 통과. 최종 문서 갱신 뒤 다시 확인 |

```powershell
node --test --test-isolation=none scripts/runtime-environment.test.mjs scripts/docker-loopback-proxy.test.mjs scripts/local-fixture-manifest.test.mjs scripts/local-user-session.test.mjs scripts/api-security.test.mjs scripts/goal-api.test.mjs scripts/praise-api.test.mjs scripts/board-api.test.mjs scripts/connection-api.test.mjs scripts/news-api.test.mjs scripts/idempotent-request.test.mjs scripts/service-worker.test.mjs
```

아래 `project.ps1` 명령도 위에서 아래로 각각 실제 시도했으며 모두 exit 1이다. 공통 오류 첫 줄은 `[ERR_PNPM_UNSUPPORTED_ENGINE] Unsupported environment (bad pnpm and/or Node.js version)`이다. 이어서 표의 직접 명령도 각각 시도했다.

| 브리프 명령 | 직접 시도한 명령 | 직접 실행 결과·오류 첫 줄 |
| --- | --- | --- |
| `.\scripts\project.ps1 -Task db:migrate` | `node scripts/database-task.mjs migrate` | exit 1, `Local database migrate failed. Check the local setup and SQL assertion output; raw command output is withheld.` |
| `.\scripts\project.ps1 -Task db:test` | `node scripts/database-task.mjs test` | exit 1, `Local database test failed. Check the local setup and SQL assertion output; raw command output is withheld.` |
| `.\scripts\project.ps1 -Task db:praise-test` | `node scripts/test-local-personal-praise.mjs` | exit 1, `Local database command failed (EPERM).` |
| `.\scripts\project.ps1 -Task db:praise-result-test` | `node scripts/test-local-personal-praise-result-rpc.mjs` | exit 1, `Local database command failed (EPERM).` |
| `.\scripts\project.ps1 -Task db:deletion-test` | `node scripts/test-local-account-deletion.mjs` | exit 1, `local_environment: Local database command failed (EPERM).` |
| `.\scripts\project.ps1 -Task api:praise-tag-test` | `node scripts/test-local-praise-tag-api.mjs` | exit 1, local_environment에서 `Local database command failed (EPERM).`, 성공 시나리오 0개 실행 |
| `.\scripts\project.ps1 -Task api:praise-test` | `node scripts/test-local-personal-praise-api.mjs` | exit 1, `Error: The local app exited before the personal-praise API check.` |
| `.\scripts\project.ps1 -Task api:board-test` | `node scripts/test-local-board-api.mjs` | exit 1, `Error: Local app exited before board API checks completed.` |
| `.\scripts\project.ps1 -Task build:check` | `node scripts/app.mjs build-check` | exit 1, 컴파일 성공(9.1초) 후 TypeScript 단계 `spawn EPERM`. 빌드 완료 아님 |

`git diff --check`도 통과했다. source diff·변경 경로를 확인했으며 실제 비밀·로컬 자격증명·사용자 기록을 산출물에 넣지 않았다. 상세 실행 증거는 [검사 보고](../quality/reports/w20-a-praise-tag-check-2026-10-15.json), 진행 상태는 [진행표](../development/backlog.md)에 기록했다.

### 실행하지 못한 검사와 이유

- 마이그레이션 적용, pgTAP 40개와 기존 DB 회귀, 실제 Auth 기반 DB/API 성공 경로 및 fixture 정리 성공은 환경 점검에서 중단되어 미실행이다. Docker 호출 EPERM을 확인했으며 샌드박스 밖 실행으로 우회하지 않았다. 기존 회귀 스크립트의 환경 실패 보고에 표시되는 fixture/cleanup 값은 제품 데이터 변경의 증거가 아니다. 검사 setup에 도달하지 않았다.
- API 두 회귀는 로컬 앱이 먼저 종료되어 성공 경로를 실행하지 못했다. `build-check`의 TypeScript 하위 프로세스도 EPERM이므로 전체 빌드는 통과 처리하지 않았다. 별도 `tsc --noEmit`만 통과했다.
- 고정 pnpm `11.19.0` 환경과 Docker 접근이 가능한 샌드박스 밖에서 Claude가 브리프 DB/API·빌드 명령을 다시 실행하고 구현 리뷰해야 한다. 실제 Google/OTP 로그인은 이 작업 범위가 아니며 검증 완료로 기록하지 않았다.

### 브리프와 다르게 한 부분

- 파일·기능 범위 이탈 없음. 브라우저 코드·peer 생성 RPC·계정 삭제 워커·보낸함 RPC를 수정하지 않았다.
- 사용자 지시에 따라 `check`·`pnpm test` 대신 lint→typecheck→격리 해제 unit→산출물 순서로 실행했다. pnpm 자체 버전 오류가 있어 설치된 도구 직접 실행을 추가했으며, 버전 고정 설정·잠금 파일은 변경하지 않았다.
- DB/API 검증을 시도했지만 환경 오류로 실행하지 못해 완료 기준 체크박스는 남겨 두었다. 구현 승인·커밋은 후속 리뷰 단계이며 이번에는 수행하지 않았다.

### r2 수정

2026-10-15 / 기준 HEAD `4313d2b2bdcf8a0a5bea0bcb9116d44253ab40bb` / 브랜치 `codex/W20-A-praise-tags` / W20-A·REQ-003·REQ-007·POL-PRAISE-001·002·TC-PRAISE-TAG-001. 최신 PR 리뷰 r2에는 BLOCKED가 없고 WARNING 1번과 참고(P3) 2·3번을 수정했다. 기존 리뷰 기록과 작업 시작 전 브리프 변경은 보존했다. 커밋·push는 하지 않았다.

변경 파일:

- `scripts/test-local-praise-tag-api.mjs`: A의 `rate_usage` 전체 삭제·재삽입을 제거했다. 성공·비 replay 응답과 요청별 예상 scope 증가량(+1)이 일치할 때만 행 ID·scope·window별 검사 증가분을 누적한다. 재시도·409는 증가량 0을 요구한다. 요청 전후 다른 증가·행 삭제·메타데이터 변경, 실패·유실 응답은 안전한 귀속으로 인정하지 않는다. 정리는 `SHARE ROW EXCLUSIVE` 잠금 아래 현재 A 사용량과 마지막 확인값을 비교한 뒤, 기존 행은 검사 증가분만 차감하고 `updated_at`을 보존하며 검사가 새로 만든 행만 지운다. 불일치·귀속 불명 시 복원하지 않고 실패를 보고한다.
- `contracts/openapi.json`: createPraise의 `x-database-rpcs`를 `create_personal_praise(uuid,uuid,text,date,text)`로 바로잡았다.
- `docs/development/artifact-register.json`, 이 브리프: 칭찬 API unit 수를 19에서 실제 18로 수정했다. 등록부·`docs/development/backlog.md`의 W20-A는 r2 통합 재검증·리뷰 대기(`IN_PROGRESS`)로 맞췄다. 기존 r1 통합 검증 결과는 과거 실행 근거로 보존했다.
- `docs/quality/reports/w20-a-praise-tag-check-2026-10-15.json`, `docs/changes/2026-10-15-w20-a-praise-tag.md`: r2 변경·소스·실행 근거와 미실행 범위를 추가했다.

실행 환경: Windows PowerShell 샌드박스, Node `24.19.0`, PATH pnpm `11.25.0`(고정 `11.19.0`과 불일치). 아래 순서로 실제 실행했으며 pnpm 버전 오류 직후 동일 설치 도구로 대체했다.

| 순서 | 실행 명령 | 결과 |
| --- | --- | --- |
| 1 | `pnpm lint` | exit 1, `[ERR_PNPM_UNSUPPORTED_ENGINE] Unsupported environment (bad pnpm and/or Node.js version)` |
| 1 대체 | `.\node_modules\.bin\biome.cmd lint --error-on-warnings .` | exit 0, 97파일, 경고·오류 없음 |
| 2 | `pnpm typecheck` | exit 1, 같은 버전 오류 |
| 2 대체 | `.\node_modules\.bin\tsc.cmd --noEmit` | exit 0 |
| 3 | 아래 지정 unit 명령 | exit 0, 120/120, 실패·skip 0 |
| 4 | `pnpm check:artifacts` | exit 1, 같은 버전 오류 |
| 4 대체 | `node scripts/verify-artifacts.mjs` | exit 0, 75 TC·JSON·링크·계약·상호 참조 통과. 최종 문서 갱신 뒤에도 재확인 |
| 5 | `.\scripts\project.ps1 -Task api:praise-tag-test` | exit 1, 같은 버전 오류 |
| 5 직접 | `node scripts/test-local-praise-tag-api.mjs` | exit 1, `local_environment`에서 중단. 오류 첫 줄: `Local database command failed (EPERM).`, 성공 시나리오 0개 |

```powershell
node --test --test-isolation=none scripts/runtime-environment.test.mjs scripts/docker-loopback-proxy.test.mjs scripts/local-fixture-manifest.test.mjs scripts/local-user-session.test.mjs scripts/api-security.test.mjs scripts/goal-api.test.mjs scripts/praise-api.test.mjs scripts/board-api.test.mjs scripts/connection-api.test.mjs scripts/news-api.test.mjs scripts/idempotent-request.test.mjs scripts/service-worker.test.mjs
```

보조 검사: `node --test --test-isolation=none scripts/praise-api.test.mjs`는 18/18. `node --input-type=module`에 PowerShell here-string으로 전달한 일회 메모리 harness는 실제 스크립트의 증가량 판별·mutation·cleanup 코드를 추출해 17개 검사를 통과했다. 기존/새 window·누적 차감량, replay 무증가, 동일 scope 동시 증가·다른 scope 변경·행 삭제·메타데이터 변경 거절, 요청 사이 경합, 응답 유실·실패·replay의 귀속 거절과 정리 차단을 확인했다. SQL은 잠금→비교→한정 삭제/차감 순서의 정적 확인만 했으며 실제 PostgreSQL 실행·경합 통과를 뜻하지 않는다. `git diff --check`도 통과했다.

실행하지 못한 검사와 이유: Docker 호출이 샌드박스 `EPERM`으로 차단되어 수정된 정리 SQL, 실제 로컬 A 세션 API 9개 시나리오, 동시 요청·새 window 경합과 fixture 보존은 재검증하지 못했다. pnpm task의 첫 오류는 위 버전 오류다. 기존 r1의 DB·API·빌드 통과를 이번 수정의 통과로 기록하지 않았다. 나머지 DB 회귀·빌드는 이번 사용자 지정 검증 순서에 없으므로 다시 실행하지 않았다.

다르게 한 부분: 파일·기능 범위 이탈 없음. A의 실제 로컬 세션을 유지하면서 검사 증가분 추적과 경합 시 실패 방식을 택했다. 사용자 지시에 따라 `pnpm test`·`check`는 실행하지 않았고, pnpm 버전 실패 시 설치 도구 직접 실행을 사용했다. 의존성·버전 고정·잠금 파일은 수정하지 않았다. r2 수정은 통합 재검증과 Claude 리뷰를 기다린다.

## 리뷰 기록

- 브리프 리뷰 r1 (2026-10-15, Codex read-only): P1 3건(열 권한, 기존 pgTAP 004/011, W19 기준 충돌)과 P2·P3 지적을 이 판에 반영했다. W19 충돌은 사용자 결정(W20 기준)으로 해소했다.

- 구현 리뷰 r1 (2026-10-15, Claude) — 판정: **보류**. 코드 지적은 없고, 핵심 DB·API 통합 검사를 실행하지 못해 APPROVED를 보류한다.
  - 직접 재실행(기준 HEAD `cf54261` + 미커밋 변경, Node 24.19.0):
    - `biome lint --error-on-warnings .`: exit 0, 97파일
    - `tsc --noEmit`: exit 0
    - `node --test`(격리 모드, package.json `test` 목록): 120/120
    - `node scripts/verify-artifacts.mjs`: passed
    - `node scripts/app.mjs build-check`: exit 0, 빌드 완료
  - 미실행: `db:migrate`, `db:test`(pgTAP 015 포함), `db:praise-test`, `db:praise-result-test`, `db:deletion-test`, `api:praise-tag-test`, `api:praise-test`, `api:board-test`. 이유: Docker Desktop 엔진 미기동(`failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine`).
  - 확인한 내용:
    - 마이그레이션 함수 5개를 직전 정의(021600·021400·022900·024600)와 diff했다. 차이는 tag 관련 줄뿐이다.
    - owner·고정 `search_path`·revoke/grant가 유지되고, 옛 4인자는 새 함수를 만든 뒤 drop한다.
    - 열 권한은 `chagokchan_rpc`에만 준다.
    - 취소는 한 UPDATE에서 tag를 null로 바꾼다.
    - tag 없는 요청의 해시는 기존과 같다.
    - 응답 allowlist·OpenAPI(`PraiseTag`, `PraiseOwner.tag` required, contributor 미포함)가 브리프와 일치한다.
    - 범위 밖 파일 변경과 비밀 포함은 없다.
  - 참고: Codex 런타임의 pnpm이 11.25.0으로 바뀌어 `project.ps1`이 `ERR_PNPM_UNSUPPORTED_ENGINE`으로 실패한다. 프로젝트 고정값은 11.19.0이다. 이번에는 package.json 스크립트 본문을 고정 Node로 직접 실행했다. 실행 환경 정리 여부는 사용자가 정한다.
- 구현 리뷰 r1 보완 (2026-10-15, Claude) — 판정: **APPROVED**. Docker Desktop 29.1.3을 기동해 r1에서 미실행이던 검사를 모두 실행했다. 코드 변경은 없다.
  - `node scripts/database-task.mjs migrate`: 마이그레이션 47개 적용(`20261008025000` 포함).
  - `node scripts/database-task.mjs test`: pgTAP 297/297. 그중 015 태그 40/40, 수정한 004 26/26, 011 6/6.
  - `db:praise-test`·`db:praise-result-test`·`db:deletion-test`: 모두 exit 0.
  - `api:praise-tag-test`: passed. 실제 로컬 A 세션으로 9개 시나리오(생성·조회, replay, 409, 수정·replay, null 삭제, 집계 불변, 취소 시 삭제)를 통과했고, 정리 성공과 fixture snapshot 보존을 확인했다.
  - `api:praise-test`: 10/10. `api:board-test`: A/B/C 각 14/14, fixture 쓰기 0.
  - 남은 일: 진행표 W20-A, TC-PRAISE-TAG-001 상태, 검사 증거 JSON, 변경 기록의 미실행 표기를 실제 결과로 갱신한 뒤 커밋한다.
- PR 리뷰 r2 (2026-10-15, Codex read-only, PR #4 `cf54261..4313d2b`) — 판정: **WARNING**. Claude가 세 항목을 모두 직접 확인했다. 코드 경로의 보안·정확성 문제는 없고, 테스트 정리 방식과 기록 불일치를 고쳐야 한다.
  1. WARNING `scripts/test-local-praise-tag-api.mjs:197,212-213`
     - 문제: 정리 단계가 A의 `rate_usage` 전체를 지우고 테스트 전 값으로 되돌린다. `lastRates`는 매 요청 뒤 DB 현재값이라, 검사 중 다른 A 요청이 늘린 카운터도 함께 덮어쓴다.
     - 근거: 다른 로컬 검사(`test-local-account-deletion.mjs:147`)는 합성 계정의 사용량만 지운다.
     - 기대: 이 검사가 쓴 증가분만 되돌린다(테스트 전후 차이를 scope·window별로 빼기). 또는 합성 probe 계정을 쓰고 그 계정의 사용량만 지운다. 다른 요청과 겹치면 덮어쓰지 말고 실패로 보고한다.
  2. 참고(P3) `contracts/openapi.json:2738`
     - 문제: createPraise의 `x-database-rpcs`가 삭제된 `create_personal_praise(uuid,uuid,text,date)`를 가리킨다.
     - 기대: `(uuid,uuid,text,date,text)`로 고친다.
  3. 참고(P3) `docs/development/artifact-register.json:155`와 이 브리프 구현 보고
     - 문제: 칭찬 API 단위 테스트를 19개로 적었다.
     - 근거: `node --test scripts/praise-api.test.mjs`는 18/18이다.
     - 기대: 18로 고친다.
- PR 리뷰 r2 수정 확인 (2026-10-15, Claude) — 판정: **APPROVED**.
  - WARNING 1: 사용량을 검사 증가분만 scope·window별로 차감하고, 정리는 잠금 아래 한 트랜잭션에서 마지막 확인값과 비교한 뒤 진행한다. 다른 요청이 끼어들면 덮어쓰지 않고 실패로 보고한다.
  - P3 2·3: 반영을 확인했다.
  - 재실행: `api:praise-tag-test` 2회 연속 통과(정리 성공, rate_usage 포함 전체 snapshot 보존), unit 120/120, lint·typecheck·산출물 통과.
