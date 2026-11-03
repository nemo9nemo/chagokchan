# 웹앱 출시 전환·서버와 DB 재조사

날짜: 2026-11-03 / 작업: W27-A / 기준 소스: `aad1ef59e683ad5c0a75582f0ececcb0e2ab2e94`

## 변경과 이유

사용자의 명시 요청에 따라 반응형 웹앱 공개로 출시 범위를 변경하고 PWA는 선택 기능으로 유지했다. W23/W24 스토어 작업은 재요청 전까지 범위 밖이다. 요구·개발 마일스톤·기술/배포 설명·출시 실행안·검증 계획·진행표/등록부·인계를 동기화했다. 이전 조건부 검토와 스토어 관련 비교는 과거 기록으로 표시했다.

Vercel/Cloudflare/Lightsail/Render, Supabase/Neon/직접 운영과 메일·Redis·정기 작업·독립 원장·백업을 공식 자료로 재조사했다. Vercel + Supabase를 우선 검증 후보로 권고하되 비용/운영 입력과 실제 개설은 미정으로 유지했다. Node 정확 버전 검사와 플랫폼의 patch 업데이트, production loopback 바인딩을 W27-B의 검증 항목으로 남겼다.

관련 REQ-001/010/011·NFR-001~005·POL-SEC-001/POL-OPS-001, TC-AUTH/WEB/CACHE/OPS. 배포 채널만 변경하므로 가입 정책 0.2.0·API·ERD·SQL·제품 코드는 유지했다.

## 검사와 제한

실행 명령·환경·문서/정책 정합성 결과는 [검사 증거](../quality/reports/w27-a-webapp-transition-check-2026-11-03.json)에 기록한다. Codex가 변경 diff와 과거/현재 범위, 가격 산술, 상호 참조와 비밀 제외를 직접 검토한다. PR·필수 quality CI·병합 결과는 해당 GitHub 기록을 따른다.

unit 199·DB 406·실제 로그인 0은 이전 소스의 저장된 근거이며 이번 실행 수치와 구분한다. DB/API/실기기/운영 부하/복원·실제 로그인 수락·클라우드 개설/배포는 이번 작업에서 실행하지 않았다. 제품 소스/SQL 변경이 없는 문서 작업이므로 해당 수락 상태를 변경하지 않는다.

다음은 W27-B 배포 호환성 기반, W12-C/D 실제 인증·탈퇴, W27-C 공개 안내/검색 경계와 W14 운영 입력이다. [시장조사](../webapp-infrastructure-research-2026-11-03.md) · [ADR-0010](../decisions/ADR-0010-webapp-release.md)
