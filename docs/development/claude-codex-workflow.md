# Claude 기획·리뷰 / Codex 구현 분업

기준일: 2026-10-13 / 출처: 사용자 요청

기획·설계와 구현 리뷰는 Claude Code가, 실제 구현은 Codex가 맡는다. 같은 모델이 만든 코드를 같은 모델이 리뷰하면 맹점을 공유하므로, 구현과 리뷰를 서로 다른 도구로 나눈다. 작업 규칙은 두 도구 모두 [AGENTS.md](../../AGENTS.md)를 따른다. Claude Code는 [CLAUDE.md](../../CLAUDE.md)에서 AGENTS.md를 불러온다.

## 흐름

| 단계 | 담당 | 실행 | 산출물 |
| --- | --- | --- | --- |
| 1. 기획 | Claude | `/plan-brief <작업 ID 또는 요구>` | `docs/plans/<작업ID>-<slug>.md` 구현 브리프 |
| 2. 브리프 확인 | 사용자 | 브리프를 읽고 승인 | 브리프 상태 `APPROVED` |
| 3. 구현 | Codex | `/codex-implement <브리프 경로>` 또는 Codex 앱에서 직접 | `codex/<작업ID>-<slug>` 브랜치의 변경·검사 결과 |
| 4. 리뷰 | Claude | `/review-impl <브리프 경로>` | 브리프의 `리뷰 기록`에 판정·지적 |
| 5. 수정 | Codex | 지적 항목을 같은 브리프로 다시 전달 | 수정 diff |
| 6. 완료 | Codex 또는 Claude | [커밋 규칙](git-workflow.md)대로 커밋·PR | 커밋·진행표·변경 기록 |

리뷰·수정은 최대 3라운드로 한다. 3라운드에도 `BLOCKED`가 남으면 구현을 멈추고 브리프의 범위나 설계를 다시 정한다.

## 역할 경계

- **Claude**: 요구·정책·설계 파일을 읽고 범위·제약·완료 기준·검증 명령을 결정해 브리프로 남긴다. 구현 diff를 브리프와 AGENTS.md의 구현 경계 기준으로 리뷰한다. 2파일·30줄 이하이고 새 로직이 없는 수정(오타·문구·링크 등)은 Claude가 직접 처리할 수 있다.
- **Codex**: 승인된 브리프만 입력으로 받아 구현하고, 브리프의 검증 명령을 실제로 실행해 결과를 보고한다. 브리프 범위를 벗어나는 변경이 필요하면 구현하지 않고 보고한다.
- **사용자**: 브리프 승인, 리뷰 의견 충돌 시 최종 판단.

## 브리프 작성 원칙

양식은 [구현 브리프](../templates/implementation-brief.md)다.

- 탐색 과정이 아니라 **결정만** 남긴다. Codex는 브리프만 보고 새 세션에서 시작한다.
- 각 단계에 대상 파일·정확한 작업·검증 명령을 적는다.
- 하지 말 것(적용한 마이그레이션 수정, 브라우저 Supabase 클라이언트, 직접 DML 등 해당 작업에 걸리는 금지 사항)을 명시한다.
- 요구 → 정책 → 설계·계약 → 검증 시나리오 → 구현 → 검사 증거 순서 중 이번 작업이 갱신할 파일을 모두 나열한다.

## Codex 실행 방법

Claude Code 안에서 `/codex-implement`를 쓰면 다음 형태로 Codex를 비대화형 실행한다. 결과 메시지는 Git 제외 경로인 `tmp/codex/`에 남는다.

```bash
R="$USERPROFILE/.cache/codex-runtimes/codex-primary-runtime/dependencies"
PATH="$R/node/bin:$R/bin/fallback:$PATH" codex exec -C "C:\Users\love0\nemo9Dev\chagokchan" -s workspace-write -c windows.sandbox='"unelevated"' -c mcp_servers.node_repl.enabled=false -o tmp/codex/<작업ID>-r<라운드>.md "<브리프 기반 지시>"
```

- `windows.sandbox="unelevated"`: 사용자 설정의 `elevated` 샌드박스는 CLI 실행 시 초기화가 실패해 모든 셸 명령이 거절된다(2026-10-13 확인). unelevated도 workspace-write 쓰기 제한은 유지한다.
- PATH: 고정 Node 24.19.0·pnpm 11.19.0이 Codex 앱 런타임 경로에만 있어 앱 밖에서는 직접 지정한다.

검사 분담: Codex는 샌드박스에서 lint·typecheck·unit(`node --test --test-isolation=none`, 샌드박스가 테스트별 자식 프로세스를 막음)·산출물 검사를 실행한다. `pnpm test`·`check`는 샌드박스에서 `spawn EPERM`으로 실패한다. Docker·DB·API 통합 검사는 리뷰 단계에서 Claude가 샌드박스 밖에서 `project.ps1`로 다시 실행해 결과를 확인한다.

Codex 앱이나 터미널에서 직접 구현할 때는 다음처럼 지시한다.

```text
docs/plans/<작업ID>-<slug>.md 브리프를 구현해. 브리프 범위 밖은 수정하지 말고, 검증 명령을 실행해 결과를 보고해. 커밋은 리뷰 통과 후에 한다.
```

## OpenAI Codex 플러그인

`.claude/settings.json`에 OpenAI 공식 [codex-plugin-cc](https://github.com/openai/codex-plugin-cc) 마켓플레이스와 플러그인을 등록했다. 처음 열 때 Claude Code가 설치 여부를 묻는다. 설치 후 `/codex:setup`으로 로그인 상태를 확인한다.

- `/codex:rescue`: Codex에 작업 위임(백그라운드 가능). `/codex:status`·`/codex:result`로 확인한다.
- `/codex:review`·`/codex:adversarial-review`: Claude가 직접 수정한 소규모 변경을 Codex가 교차 리뷰할 때 쓴다.
- `/codex:setup --enable-review-gate`는 응답마다 Codex 리뷰가 돌아 사용량이 크게 늘어나므로 켜지 않는다.

## 완료 표시

이 분업은 작업 순서만 정한다. 완료 기준은 기존 [개발 절차](README.md)와 [진행표](backlog.md)를 따른다. 브리프 승인·리뷰 통과는 기능 구현·검사 완료가 아니며, 실행한 검사 결과가 있어야 진행표를 DONE으로 바꾼다.
