---
name: review-impl
description: Codex가 구현한 변경을 docs/plans 브리프와 AGENTS.md 기준으로 리뷰하고 판정(APPROVED/WARNING/BLOCKED)을 브리프에 기록한다.
argument-hint: <브리프 경로>
---

# Codex 구현 리뷰

대상 브리프: $ARGUMENTS

1. 브리프 전체와 'Codex 구현 보고'를 읽는다. 구현 브랜치의 변경을 빠짐없이 본다: 커밋된 변경 `git diff main...HEAD`, staged `git diff --cached`, unstaged `git diff`, 그리고 `git status --porcelain`의 untracked 파일은 본문을 직접 읽는다(Codex는 커밋하지 않으므로 새 파일·마이그레이션이 untracked로 남는다).
2. 다음 기준으로 검토한다.
   - 브리프 범위: 범위 밖 파일 변경, 빠진 구현 단계, 함께 갱신할 기준 파일 누락
   - AGENTS.md 구현 경계: 브라우저 Supabase 클라이언트·관리 키, 직접 DML, 세션·권한 검사 누락, 트랜잭션 분리, 개인/공유 개수 합산, SECURITY DEFINER 조건, 사용자 데이터 캐시, 적용한 마이그레이션 수정
   - 정확성: 권한 없음·중복·동시성·권한 회수 경합 경로, 오류 응답이 계약(contracts/openapi.json)과 일치하는지
   - 보안: 로그에 본문·이메일·토큰·Cookie 출력, 비밀이 diff에 포함
   - 증거: 보고한 검사 결과가 실제 출력과 맞는지. 핵심 검증 명령은 직접 다시 실행한다. Codex 샌드박스에서 못 돌린 `pnpm check`(격리 모드 unit 포함)와 Docker·DB·API 통합 검사는 여기서 반드시 실행한다. 고정 Node·pnpm은 PATH 앞에 `$USERPROFILE/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin`과 `.../dependencies/bin/fallback`을 넣어 쓴다. DB가 필요한 검사는 `db:status`로 상태를 먼저 확인하고, Docker가 꺼져 있으면 미실행으로 기록한다.
3. 브리프 '리뷰 기록'에 라운드 번호와 판정을 추가한다.
   - BLOCKED: 정확성·보안·경계 위반. 반드시 수정
   - WARNING: 높은 위험이나 누락. 수정 권장
   - 그 외 사소한 의견은 '참고'로 적고 수정 여부는 사용자가 정한다
   - 지적마다 파일:줄, 문제, 재현 또는 근거, 기대 동작을 적는다
4. 판정에 따라:
   - BLOCKED·WARNING이 있으면 사용자에게 요약하고 `/codex-implement <브리프> fix`를 제안한다. 3라운드째에도 BLOCKED이면 브리프 재설계를 제안한다.
   - APPROVED이면 브리프 상태를 DONE 직전으로 두고, docs/development/git-workflow.md에 따른 커밋·진행표·변경 기록 갱신을 제안한다.

리뷰 중 코드를 직접 고치지 않는다.
