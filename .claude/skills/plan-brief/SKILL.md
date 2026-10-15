---
name: plan-brief
description: 차곡찬 작업(진행표 W 작업 ID 또는 기능 요구)을 Codex가 구현할 수 있는 구현 브리프로 작성한다. 기능 구현 요청을 받았을 때 구현 전에 사용한다.
argument-hint: <작업 ID 또는 요구 설명>
---

# 구현 브리프 작성

대상: $ARGUMENTS

1. 기준을 읽는다: AGENTS.md, docs/development/backlog.md의 해당 행, 관련 REQ(docs/requirements/mvp-requirements.md), 정책(policies/app-policy.json, docs/policies), ERD·API 계약(docs/data-erd.md, contracts/openapi.json), 화면(docs/design/user-flows.md), TC(docs/quality/test-cases.json).
2. 실제 코드와 기존 마이그레이션·검사 스크립트를 확인해 수정할 파일과 재사용할 패턴을 정한다. 추측으로 파일 경로를 적지 않는다.
3. 기준 파일 사이에 모순이 있거나 사용자 결정이 필요한 선택이 있으면 브리프 작성 전에 사용자에게 묻는다.
4. docs/templates/implementation-brief.md 양식으로 `docs/plans/<작업ID>-<slug>.md`를 만든다. 상태는 DRAFT.
   - 탐색 과정이 아니라 결정만 적는다. Codex는 이 파일만 보고 시작한다.
   - 구현 단계마다 대상 파일·정확한 작업·검증 명령을 둔다.
   - "하지 말 것"에 이 작업에 걸리는 AGENTS.md 구현 경계를 구체적으로 적는다.
   - 검증 명령은 `.\scripts\project.ps1 -Task <task>` 형식을 쓴다.
5. 브리프를 사용자에게 요약해 보여주고 승인을 요청한다. 승인되면 상태를 APPROVED로 바꾸고 `/codex-implement`를 안내한다.

코드는 수정하지 않는다.
