# 직접 입력하는 칭찬 태그 기획

작업: W25-A / REQ-003·REQ-007 / POL-PRAISE-001·POL-PRAISE-002 / UI05

사용자가 `#`로 시작하는 값을 쓰고 공백으로 확정하면 위쪽 칩 영역으로 옮기는 흐름을 요청했다. [기획](../plans/W25-custom-praise-tags.md)에 작성·수정·삭제·IME·붙여넣기·마지막 토큰 저장·중복/제한·실패 보존과 기존 데이터 전환 방향을 정리했다. 요구·정책 설명·화면·검증 계획·진행표·인계를 연결했다.

Codex가 직접 검토한다. 문서의 실행 상태와 변경 요구를 구분하며, 현재 정책 JSON·OpenAPI·소스·적용 SQL은 변경하지 않는다. W25-B~D 기능 검사와 TC-PRAISE-TAG-002 실행은 미실행이다.

검증 환경: Windows PowerShell, 고정 Node 24.19.0. 소스 기준 main `ec9f28f` 이후의 W25-A 문서 변경분이다.

| 검사 | 결과 |
| --- | --- |
| `scripts/project.ps1 -Task check:artifacts` | 실행 전 인자 검증 실패: 해당 Task가 wrapper 허용 목록에 없음. 설정을 바꾸지 않고 아래 직접 명령으로 수행 |
| 고정 Node로 `scripts/verify-artifacts.mjs` 실행 | exit 0. 최종 문서 기준 JSON 48개, 로컬 문서 링크 620개, API 작업 56개·로컬 참조 713개, REQ/POL/TC/API 참조·정책/계약·ERD 원본·등록부 경로 확인 통과 |
| `git diff --check` | 통과 |
| Codex 직접 문서 리뷰 | 공백 확정·IME·마지막 입력 포함 저장·중복·오류 시 원문 보존·구형 요청 호환·데이터 보존과 기획/구현 상태 구분 확인. 발견한 해결되지 않은 문서 결함 없음 |
| 앱·DB·브라우저 기능 검사 | 미실행. 실행 소스·정책 JSON·계약·SQL 변경이 없는 기획 작업 |

W25-A만 DONE이며 W25-B~D는 TODO다. 기존 로그인·출시 미완료 항목은 [진행표](../development/backlog.md)를 따른다. PR 필수 CI의 결과는 GitHub에서 별도로 확인한다.
