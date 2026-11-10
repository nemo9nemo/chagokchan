# 비밀 탐지·의존성 알림과 Git 반영 확인

W15-B·W16-D / NFR-001·NFR-004 / POL-SEC-001

검사 시작 시 개발 HEAD·업스트림·origin/main은 모두 `219601f991f93a59205e39b18648f71854c4026b`였으며 PR #24는 quality 성공 후 병합돼 있었다. 로컬 main도 이 버전으로 fast-forward했다. 현재 개발 산출물의 원격 반영과 과거 별도 설계 보관 이력을 구분한다.

미추적 `.claude/launch.json`은 개인 PC의 절대 실행 경로를 포함한 도구 설정이다. 파일을 보존하고 `.gitignore`에 그 파일만 추가했다. 향후 이 저장소의 커밋 작성자 이메일은 GitHub noreply로 설정했다. 과거 커밋의 작성자 정보는 재작성하지 않았다. 저장소는 기존 public 상태를 유지한다.

정식 Gitleaks 8.30.1의 배포 파일 SHA-256을 검증하고 로컬에서 접근 가능한 전체 96개 커밋을 검사했다. 최초 generic-api-key 9건은 원문 위치를 검토해 합성 테스트 값 2개·검사 파일 해시 6개·코드 표현식 1개로 분류했다. `.gitleaksignore`는 해당 과거 커밋/경로/규칙/행만 제외한다. 새 커밋·새 값·같은 파일의 다른 위치를 포괄 제외하지 않는다. 이후 잔여 탐지 0건이며, 별도 폐기 가능한 로컬 Git 저장소의 합성 자격증명은 탐지해 실패하는 것을 확인했다. 값과 작성자 이메일은 출력하지 않는다. 이 검사는 전체 취약점 수락·외부 로그/PR/아티팩트 검사를 대신하지 않는다.

필수 quality에 전체 Git 이력 비밀 검사를 추가했다. 일일 보안 검사 워크플로와 주간 Dependabot npm/Actions 업데이트를 구성했다. 스캐너 버전·Linux 바이너리 SHA-256·기존 Actions 전체 SHA를 고정했다. 새로운 권한이나 운영 비밀을 CI에 주지 않는다. GitHub 취약점 알림과 자동 보안 수정 PR을 활성화한 뒤 재조회했으며 열린 Dependabot 경고는 0건이었다. 원격 스케줄 실행 여부는 워크플로 병합 후 별도로 확인한다.

로컬 전용 예전 W19 설계/stash의 6개 커밋은 현재 출시 코드에 병합하지 않았다. `.cache/git-backups/w19-design-and-stash-20261110.bundle`로 로컬 보관하고 `git bundle verify`를 통과했다. 이 과거 보관본을 공개 원격에 새로 업로드하려던 작업은 자동 승인 검토가 거절했으며 구체적 공개 범위에 대한 사용자 확인 전에는 원격 업로드하지 않는다. 원격 미반영 이력을 숨기거나 전체 원격 백업 완료로 표시하지 않는다.

[검사 증거](../quality/reports/w15-b-security-git-check-2026-11-10.json) · [Gitleaks 릴리스](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1) · [GitHub 비밀 탐지](https://docs.github.com/en/code-security/concepts/secret-security/about-alerts)
