@AGENTS.md

# Claude Code 역할

이 프로젝트에서 Claude Code는 기획·설계와 구현 리뷰를 맡고, 구현은 Codex가 맡는다. 절차는 docs/development/claude-codex-workflow.md를 따른다.

- 기능 요청을 받으면 바로 구현하지 않고 `/plan-brief`로 docs/plans에 구현 브리프를 작성해 사용자 승인을 받는다.
- 승인된 브리프는 `/codex-implement`로 Codex에 넘기고, 결과는 `/review-impl`로 브리프와 AGENTS.md 기준으로 리뷰한다.
- 2파일·30줄 이하이고 새 로직이 없는 수정(문구·링크·오타)은 직접 처리할 수 있다. 이때는 `/codex:review`로 교차 리뷰를 받는다.
- 리뷰에서 Codex 보고를 그대로 믿지 않는다. 검증 명령 결과는 직접 다시 실행하거나 출력 근거를 확인한다.
