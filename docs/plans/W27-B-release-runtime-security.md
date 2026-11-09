# W27-B — 공개 전 런타임 보안과 배포 호환성

시작: 2026-11-03 / 사용자 일시 중단 뒤 2026-11-09 재개. 당시 24시간 목표는 과거 기록이며 실제 공개는 필수 수락 통과 뒤 진행한다.

관련: REQ-001/011·NFR-001/004/005, POL-SEC-001·POL-OPS-001, TC-DEV-001/002·TC-SEC-HEADERS-001, 신규 TC-DEPLOY-RUNTIME-001.

사용자는 개인 운영·계정 보유·지원 메일/도메인 미보유·월 예산 미정이며 운영비 없는 구성을 우선한다고 답했다. 외부 유료 서비스·도메인 구매·유료 플랜 전환은 실행하지 않는다. 무료 플랜의 이용 범위·휴면·초과 시 동작·백업을 확인하고 선택한다. 이전 $55안은 유료 비교 기록이다.

## 구현 범위

1. Node 24.19.0 고정을 보안 패치 24.22.1로 올려 로컬/CI 재현 환경을 복구한다. 10-21 공식 보안 릴리스의 24.x 수정 버전이다. [Node 보안 공지](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)
2. 로컬/CI는 정확 버전, 배포 build/start는 같은 24 메이저의 최소 보안 버전 이상을 요구한다. 플랫폼이 patch/minor를 자동 갱신해도 동작하되 구버전·다른 메이저·prerelease는 거절한다.
3. Next.js 16.4.5의 실제 npm 버전/peer 호환성을 확인하고 잠금 파일을 함께 갱신한다. 기존 16.4.2는 10-14 수정 하한 16.4.1보다 높았으며 이번 갱신을 미확인 취약점의 해결로 과장하지 않는다. [공식 보안 공지](https://nextjs.org/blog/nextjs-security-update-october-14-2026)
4. 배포 Node 서비스에 한해 APP_BIND_HOST와 PORT를 명시적으로 검증한다. 개발 가상 사용자 모드는 loopback을 유지하고 환경·실행 모드·DB/앱 URL 가드를 완화하지 않는다.
5. Windows의 Turbopack CSS worker가 sandbox 안팎 모두 연결 전에 종료한 실제 오류를 확인했다. 설치된 Next CLI가 지원하는 `next build --webpack`을 로컬/CI/배포에 동일 적용하고 production CSP/nonce·정적 자산을 다시 검사한다. 컴파일/타입/보안 검사를 생략하는 fallback은 사용하지 않는다.
6. webpack의 서버 번들에서 개발 정책을 `fs.readFileSync(new URL(...))`로 읽는 기존 코드가 정적 asset URL로 치환되어 빌드 후 라우트 로딩에 실패했다. 같은 정책 JSON을 정적 import로 읽어 번들 호환성을 확보하고 기존 환경 가드 회귀를 실행한다.

11-09 재개 시 [공식 v16.4.5 릴리스](https://github.com/vercel/next.js/releases/tag/v16.4.5)의 11-03 보안 수정 목록도 확인했다. npm audit 통과와 공식 릴리스 점검을 별도로 수행했다.

## 완료 조건

최소 버전/메이저/로컬 정확 버전·fixture 외부 바인딩 거절·유효/잘못된 PORT·입력 비노출 검사, 전체 check·production-check build·보안 HTTP·의존성 high/critical audit, Codex 직접 검토·PR 필수 CI·병합을 실행하고 근거를 기록한다.

이 단위는 실제 Google/OTP·탈퇴·분산 제한/CAPTCHA·운영 DB·백업/원장·실기기·공개 배포의 완료를 뜻하지 않는다. 다음 단위에서 구현·수락한다. 보안 검사를 일정 때문에 생략하지 않는다.
