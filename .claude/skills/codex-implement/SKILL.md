---
name: codex-implement
description: 승인된 docs/plans 구현 브리프를 Codex CLI(codex exec)에 넘겨 구현시킨다. 리뷰 지적 사항을 Codex에 다시 넘겨 수정시킬 때도 사용한다.
argument-hint: <브리프 경로> [fix]
disable-model-invocation: true
---

# Codex 구현 위임

인자: $ARGUMENTS

1. 브리프를 읽고 상태가 APPROVED 또는 IN_REVIEW인지 확인한다. DRAFT이면 멈추고 승인을 요청한다.
2. `git status`로 작업 공간을 확인한다. 관련 없는 미커밋 변경이 있으면 사용자에게 알리고 멈춘다.
3. 브리프의 구현 브랜치가 없으면 시작점을 main으로 지정해 만든다(`git switch -c codex/<작업ID>-<slug> main`). 현재 HEAD에서 만들면 이전 미병합 작업이 섞인다. 있으면 그 브랜치로 전환한다.
4. `tmp/codex/`를 만들고 Codex를 백그라운드로 실행한다(run_in_background). 최초 구현:

   ```bash
   R="$USERPROFILE/.cache/codex-runtimes/codex-primary-runtime/dependencies"
   PATH="$R/node/bin:$R/bin/fallback:$PATH" codex exec -C "C:\Users\love0\nemo9Dev\chagokchan" -s workspace-write -c windows.sandbox='"unelevated"' -c mcp_servers.node_repl.enabled=false -o "tmp/codex/<작업ID>-r<라운드>.md" "AGENTS.md를 따르고 <브리프 경로> 브리프를 구현해. 브리프 범위 밖 파일은 수정하지 마. 범위 밖 변경이 필요하면 구현하지 말고 보고해. 검증은 샌드박스에서 pnpm lint, pnpm typecheck, node --test --test-isolation=none <package.json test 스크립트의 파일들>, pnpm check:artifacts 순서로 실제 실행해(pnpm test·check는 샌드박스에서 spawn EPERM으로 실패한다). Docker·DB가 필요한 브리프 검증 명령도 시도하고, 실패하면 미실행과 오류 첫 줄을 적어. 커밋하지 마. 끝나면 브리프의 'Codex 구현 보고' 절에 변경 파일, 실행 명령과 결과, 실행하지 못한 검사와 이유, 브리프와 다르게 한 부분을 적어."
   ```

   `fix` 인자이면 지시를 "<브리프 경로>의 '리뷰 기록' 최신 라운드에서 BLOCKED·WARNING 항목을 수정해. 나머지 규칙은 같다."로 바꾼다.
5. 완료 알림을 받으면 결과 파일과 `git diff --stat`을 요약해 보여주고, `/review-impl <브리프 경로>`로 리뷰를 진행한다.

실행 옵션의 이유(2026-10-13 확인):
- `windows.sandbox="unelevated"`: 사용자 설정의 `elevated` 샌드박스는 CLI 실행 시 초기화(setup refresh)가 `node_repl.exe` 권한 변경에서 os error 32로 실패해 모든 셸 명령이 `helper_unknown_error`로 거절된다. unelevated 샌드박스는 workspace-write 제한을 유지하면서 셸이 동작한다.
- `mcp_servers.node_repl.enabled=false`: 구현에 쓰지 않는 Codex 앱용 MCP 서버를 띄우지 않는다.
- PATH: 고정 Node 24.19.0과 pnpm 11.19.0은 Codex 앱 런타임 경로에만 있어, 앱 밖에서는 `project.ps1`이 pnpm을 찾지 못한다.
- 테스트: unelevated 샌드박스는 `node --test`의 테스트 파일별 자식 프로세스 생성을 막는다(spawn EPERM). `--test-isolation=none`이면 통과한다. Docker·DB 통합 검사의 샌드박스 내 동작은 아직 확인하지 않았으므로, 리뷰 단계에서 Claude가 `/review-impl` 절차대로 직접 실행한다.

샌드박스를 끄는 옵션(`danger-full-access`)은 사용자가 명시적으로 허용하기 전에는 쓰지 않는다.

Codex 실행이 로그인·샌드박스 문제로 실패하면 출력의 오류를 그대로 보여주고, Codex 앱에서 같은 지시로 실행하는 방법을 안내한다. Claude가 대신 구현하지 않는다.
