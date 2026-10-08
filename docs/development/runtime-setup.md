# 앱 기반 실행과 로컬 DB 준비

기준일: 2026-10-08 / 작업: W04 완료 / 실제 결과: [앱 기반 검사](../quality/reports/foundation-check-2026-10-08.json)

Next.js 앱의 시작 화면, 환경 검사, 빌드와 로컬 실행을 구현했다. Supabase CLI로 로컬 DB를 기동하고 PostgreSQL 17.11 연결·Auth/API 응답·공개 포트의 127.0.0.1 바인딩을 확인했다. 목표·칭찬·가상 사용자 세션·업무 API는 후속 작업이다. 진행 기준은 [진행표](backlog.md)다.

## 고정한 버전

| 항목 | 버전·역할 |
| --- | --- |
| Node.js | 24.19.0. `.node-version`, `.nvmrc`, engines와 실행 스크립트로 확인 |
| pnpm | 11.19.0. packageManager와 잠금 파일로 고정 |
| Next.js / React | 16.4.0 / 19.3.0. App Router |
| TypeScript | 5.9.3. strict, 별도 타입 검사와 빌드 검사 |
| Tailwind CSS | 4.3.3. 기본 화면 스타일 |
| Biome | 2.5.15. 경고를 실패 처리하는 린트 |
| Supabase CLI | 2.120.0. 프로젝트 개발 의존성으로 설치, 실제 실행 버전 확인 |
| PostgreSQL | 17.11. W05 제품 SQL·기본 RLS·물리 제약 검사 완료 |
| Supabase SDK | 2.117.3. 서버 전용 로컬 Auth 준비에 사용 |
| Docker | CLI·엔진 29.1.3, WSL 2 확인. 차곡찬 서비스 7개 기동 |

린트와 타입 검사를 분리했다. Biome은 소스·설정·스크립트를 검사하며, 기존 산출물 검사기의 정규식 공백과 일부 표현 스타일은 파일별 예외로 둔다. 타입 검사는 TypeScript와 Next.js 빌드에서 수행한다. [Biome 구성](../../biome.json), [공식 시작 안내](https://biomejs.dev/guides/getting-started/)

## 실행 순서

Node와 pnpm의 고정 버전을 준비한 뒤 프로젝트 루트에서 실행한다. Windows에서는 `scripts/project.ps1`이 고정 버전의 Node를 찾아 PATH에 적용한다. 별도 설치 위치는 `CHAGOKCHAN_NODE_PATH`에 지정할 수 있다.

```powershell
pnpm install --frozen-lockfile
if (-not (Test-Path -LiteralPath .env.development.local)) {
    Copy-Item -LiteralPath .env.example -Destination .env.development.local
}
.\scripts\project.ps1 -Task db:init
.\scripts\project.ps1 -Task db:start
.\scripts\project.ps1 -Task dev
```

이미 있는 `.env.development.local`은 복사 명령으로 덮어쓰지 않는다. 로컬 앱 URL은 `http://127.0.0.1:3000`, DB API는 `http://127.0.0.1:54321`로 설정한다. 이번 작업에서 개발용 환경 파일은 준비했다. DB 시작 성공 시 스크립트가 로컬 API 주소와 publishable 키를 이 파일에 기록하고 비밀 값을 출력하지 않는다. A/B/C Auth 계정과 초기 데이터 준비는 W05에서 구현했다. [DB 실행 순서](database-foundation.md)의 db:migrate → db:seed → db:test를 실행한다. 사용자 세션·API 연결은 W07에서 구현한다.

앱 실행 주소는 `http://127.0.0.1:3000`이다. 개발 서버는 loopback에 바인딩하며 설정한 포트가 사용 중이면 실패한다. 현재 화면은 준비 안내를 제공한다.

```powershell
.\scripts\project.ps1 -Task check
.\scripts\project.ps1 -Task build:check
.\scripts\project.ps1 -Task db:status
.\scripts\project.ps1 -Task db:stop
```

`build:check`는 외부 서비스 연결 없이 정적 앱을 컴파일하는 검사다. `.invalid` 주소와 실제 세션 모드로 만든 합성 빌드 설정을 사용한다. 운영 배포나 실제 로그인 성공의 증거가 아니다. 실제 `build`·`start`에는 해당 배포 환경의 설정이 필요하다.

## 로컬 모드와 배포 모드

서버 설정 검사는 [개발 정책](../../policies/development-policy.json)을 읽는다. 로컬 모드는 환경·개발 실행·앱/DB 주소·포트·바인딩·A/B/C 선택을 함께 확인한다. 잘못된 모드나 외부 주소는 시작을 실패시킨다. 배포 모드는 `supabase_session`과 HTTPS 주소 및 환경별 32바이트 이상 CSRF 서명 키를 요구하고 local fixture 설정·키를 거절한다. W07에서 local 세션 `/me`와 개발용 CSRF/요청 guard 기반을 구현했다. 실제 배포 로그인·flow/session binding은 W12에서 진행한다.

개발 설정은 `.env.development.local`에 두며 Git에서 제외한다. 일반 앱 실행에 관리 키를 추가하지 않는다. `next-env.d.ts`, `.next`, 설치 결과와 임시 로그도 Git에서 제외한다. `agentRules: false`로 개발 서버가 프로젝트의 AGENTS.md를 자동 변경하는 동작을 끈다. [설치 버전의 구성 설명](https://nextjs.org/docs/app/api-reference/config/next-config-js/agentRules)

## DB 기동과 다음 단계

`db:init`은 실제 CLI로 설정을 생성한다. 새 테이블의 자동 공개를 끄고 JWT 만료를 900초로 설정했다. 자동 seed는 계속 비활성화하며 W05의 가상 계정 준비는 db:seed로 명시적으로 실행한다.

`db:start`는 Docker 엔진을 확인한 뒤 프로젝트 전용 네트워크를 사용한다. Windows Docker Desktop에서 네트워크의 기본 바인딩 설정만으로는 실제 공개 포트가 제한되지 않아, CLI 실행 동안 전용 임시 named pipe를 통해 컨테이너 생성 요청의 HostIp를 127.0.0.1로 설정한다. 전용 pipe는 시작이 끝나면 닫는다. 설정·자격증명·CLI 출력은 기록하지 않는다. 실행 후 모든 공개 포트를 다시 검사하고, 전체 인터페이스나 외부 주소에 열린 포트를 발견하면 이 프로젝트 서비스를 중지하고 실패한다. [포트 강제·검사 코드](../../scripts/docker-loopback-proxy.mjs)

DB·Auth·REST·Kong·Studio·DB 메타데이터·테스트 메일 서비스만 시작한다. Realtime·Storage·Edge·분석 등은 필요한 기능을 구현할 때 추가한다. 첫 구동에서는 서비스 이미지를 내려받아 시간이 더 걸릴 수 있다.

이번 환경에서는 Docker의 임시 소켓 오류를 먼저 해결해야 했다. 사용자의 실행 승인 후 0바이트 소켓만 있는 실행 폴더를 백업 이름으로 보존하고 Docker Desktop을 재시작했다. 백업 위치는 검사 JSON에 기록했다. 같은 증상에 대한 [Docker 이슈의 보고](https://github.com/docker/desktop-feedback/issues/554)를 참고했으며, 이 머신에서 엔진 정상 응답을 직접 확인했다.

W05에서 ERD의 물리 제약·인덱스·마이그레이션과 합성 A/B/C 초기 데이터를, W06에서 업무 RPC/RLS·동시성을, W07에서 local adapter·API security 기반을 구현·검증했다. 다음 작업은 W08 개인 목표·칭찬 API/UI다. 실제 Google/OTP 연동과 실제 로그인 검사는 오픈 준비 단계에서 수행한다.
