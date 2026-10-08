# 배포, 운영 환경, Git 형상관리

결정일: 2026-10-07 / 갱신일: 2026-10-08 / 상태: 로컬·원격 Git 연결 완료, CI 워크플로 구성 중, 브랜치 보호·운영 배포 미설정

2026-10-08 사용자 요청으로 로컬 Git의 기능 단위 커밋과 공개 원격 저장소 연결·첫 업로드를 완료했다. 지정한 주소는 https://github.com/nemo9nemo/chagokchan.git 이며 origin/main을 추적한다. W16-C에서 `.github/workflows/ci.yml`에 GitHub Actions 검사 작업을 추가했다. 원격 CI 결과와 브랜치 보호·클라우드 프로젝트·유료 서비스·실제 배포는 아직 설정되지 않았다. 커밋 기준은 [기능 단위 커밋](development/git-workflow.md)을 따른다.

외부 도구 사용은 허용되었다. 플러그인 설치·계정 인증·프로젝트 연결 상태와 도구별 연결 시점은 [외부 도구 연결](external-tools.md)에 기록한다. GitHub 플러그인 설치와 이 앱의 원격 저장소 연결은 구분한다.

## 배포 구성 결정

| 영역 | 결정 |
| --- | --- |
| 첫 서비스 형태 | 모바일 웹/PWA, 사용자용 HTTPS 도메인 |
| 웹·API | Vercel Pro, Next.js Node 런타임, 함수 서울 icn1 |
| 인증·DB | Supabase Pro, PostgreSQL 서울 ap-northeast-2 |
| 스테이징 | 별도 Vercel 프로젝트·고정 도메인 + 별도 Supabase Pro 프로젝트 |
| 로컬 개발 | Node.js 24 LTS, pnpm, Supabase CLI + Docker |
| 인증 메일·봇 방어 | 환경별 Resend 발신 설정, Turnstile 키 |
| 요청 제한 | 환경별 Upstash Redis 또는 엄격히 분리된 키 공간 |
| Git 연결 전 | 로컬 검증 후 CLI로 스테이징, 검증된 버전만 수동 운영 배포 |
| Git 연결 후 | 사용자 지정 공개 GitHub 저장소 연결 완료. Actions + Vercel CLI는 후속 설정 |
| 운영 공개 | DB 마이그레이션 → 운영 빌드·검증 → 도메인 연결 |

서울은 DB와 서버 함수의 배치 기준이다. CDN·Google 로그인·인증 메일·로그 등 모든 처리 위치가 국내로 제한된다는 뜻은 아니다. 서비스 개설 시 각 서비스의 실제 처리·보관 설정을 운영 기록에 남긴다. [Vercel 리전](https://vercel.com/docs/regions), [Supabase 리전](https://supabase.com/docs/guides/platform/regions)

운영은 유료 플랜을 기준으로 잡는다. Vercel Hobby는 개인의 비상업적 용도에 제한되며, Supabase Free는 비활성 일시 중지와 백업 접근 제한이 있다. 스테이징도 운영과 같은 Auth 세션 정책을 검증할 수 있게 Pro로 잡는다. 도메인·메일·Redis·추가 프로젝트 비용을 포함한 실제 예산은 개설 시 기록한다. 이 문서 작성은 결제 승인이 아니다. [Vercel Hobby](https://vercel.com/docs/plans/hobby), [Supabase 운영 전 확인](https://supabase.com/docs/guides/deployment/going-into-prod)

## 환경 분리

| 환경 | 데이터 | 허용 용도 |
| --- | --- | --- |
| local | 로컬 DB와 가상 A/B/C 사용자·서버 준비 세션 | 로그인 화면 없이 개발, 스키마 초기화, 권한·동시성 테스트 |
| preview | 기본은 가상 데이터. 필요 시 별도 폐기 가능한 테스트 DB | 신뢰된 PR의 화면 검토 |
| staging | 별도 DB의 테스트 계정과 합성 기록 | 실제 로그인·초대·칭찬·마이그레이션·배포 검증 |
| production | 실제 사용자 데이터 | 정식 서비스 |

Preview에는 운영 자격증명을 넣지 않는다. 로그인·DB 검증의 기준은 고정된 스테이징 주소다. Preview에서 DB 변경을 검증해야 하면 별도 테스트 DB를 준비하고 사용 후 종료한다. 공유 스테이징 DB에 PR마다 임의 마이그레이션을 적용하지 않는다.

2026-10-08 사용자 결정으로 실제 로그인 연동·테스트는 오픈 준비 때 시작한다. 그 전에는 [로컬 개발 정책](development/local-development.md)을 적용한다. 로컬의 `APP_AUTH_MODE=local_fixture`는 배포에서 허용하지 않는다. Preview·staging·production은 `supabase_session`을 명시하고 가상 자동 로그인 경로·자격증명과 로컬 DB 주소를 거절한다. Preview의 가상 화면 검토는 정적 예시 또는 인증된 독립 테스트 환경으로 제공하며 무로그인 업무 API를 공개하지 않는다. 실제 계정 로그인·세션·권한 검사를 통과해야 운영 공개로 진행한다.

운영·스테이징은 서로 다른 Supabase 프로젝트, OAuth 자격증명, Auth 콜백 목록, 메일·CAPTCHA 설정을 사용한다. 운영 콜백은 정확한 HTTPS 주소만 등록한다. 로컬 콜백은 개발 프로젝트에만 등록한다. 광범위한 Preview URL 와일드카드를 운영 Auth에 허용하지 않는다.

Vercel의 프로젝트·환경별 설정을 구분하고 빌드 시작 전에 APP_BASE_URL과 Supabase 프로젝트 식별자가 목표 환경에 맞는지 검사한다. 계정·메일·리다이렉트·CAPTCHA 설정은 SQL 마이그레이션과 별도로 재현 가능한 설정 목록에 기록하며 비밀값은 제외한다. [환경 변수](https://vercel.com/docs/environment-variables), [Supabase 환경 관리](https://supabase.com/docs/guides/deployment/managing-environments)

## 비밀과 환경 변수

구현 시 .env.example에는 변수명·용도·가상 값만 적는다. 실제 값은 .env.local, 배포 서비스의 비밀 저장소, GitHub 환경별 Secrets에서 관리한다.

| 설정 | 위치·범위 |
| --- | --- |
| APP_BASE_URL | 서버 설정. 해당 환경의 고정 기본 주소 |
| SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY | 앱 서버의 일반 사용자 DB·Auth 연결 |
| UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN | 앱 서버의 요청 제한 |
| TURNSTILE_SECRET_KEY | 서버 검증. 공개 site key와 분리 |
| `CSRF_SIGNING_SECRET`·제한 키용 HMAC 비밀 | 앱 서버. CSRF 키는 배포 환경별 32바이트 이상 난수로 생성·교체하며 local fixture 키를 재사용하지 않음 |
| Resend SMTP 자격증명 | Supabase Auth SMTP 설정. 브라우저·Git에 포함하지 않음 |
| Supabase 관리 토큰 / DB 연결 자격증명 | 지정된 마이그레이션·관리 작업만 사용 |
| Vercel 배포 자격증명 | 지정된 배포 작업만 사용. 환경·프로젝트 접근 최소화 |
| Supabase service role/secret key | 필요가 확인된 관리자 작업에만 별도 부여. 일반 앱 경로에서 미사용 |

공개 Turnstile site key처럼 공개가 필요한 값만 클라이언트 설정에 넣는다. NEXT_PUBLIC_* 변수에 비밀을 넣지 않는다. Supabase publishable key 자체는 비밀키가 아니지만, 이 앱은 서버 API를 사용하도록 구성한다. 사용자 데이터 보호는 키를 숨기는 것과 별도로 RLS·권한 검사로 보장한다.

스테이징과 운영의 자격증명을 재사용하지 않는다. 로그·CI 출력·빌드 산출물 검사에 토큰 원문을 출력하지 않는다. 배포 산출물·릴리스 기록에도 .env나 관리 키를 포함하지 않는다.

## Git 연결 전 개발·배포

1. 현재 docs를 유지하고 앱을 생성한다. 패키지 잠금 파일, .env.example, .gitignore, DB 마이그레이션부터 함께 만든다.
2. 로컬 Supabase를 시작하고 마이그레이션으로 DB를 구성한다. 초기화 명령은 폐기 가능한 로컬 DB에만 사용한다.
3. 타입·린트·핵심 규칙·DB 권한·사용자 흐름을 검증하고 로컬 빌드가 성공하는지 확인한다.
4. 릴리스할 소스 사본과 잠금 파일, 마이그레이션 목록, 소스 SHA-256, 검사 결과를 기록한다. 비밀과 사용자 데이터를 제외하고 접근이 제한된 위치에 보관한다.
5. 스테이징 DB에 마이그레이션을 적용하고 CLI로 스테이징 프로젝트에 배포한다. 실제 두 계정으로 로그인·연결·판별 권한·칭찬·취소를 확인한다.
6. 운영 배포는 같은 검증된 소스에서 환경에 맞게 다시 빌드하고 아래 운영 절차를 따른다. 스테이징의 환경값이 들어 있는 빌드를 그대로 운영으로 올리지 않는다.

Git 없이도 Vercel CLI 배포는 가능하다. 초기 배포를 할 때도 프로젝트와 환경을 명시하고 기본 자동 선택에 맡기지 않는다. [Vercel 배포](https://vercel.com/docs/deployments/overview)

## Git 연결 결과와 후속 결정

초기 설계는 비공개 저장소를 권장했으나 사용자가 지정한 실제 저장소는 **공개(public) nemo9nemo/chagokchan**이다. 2026-10-08 조회한 공개 범위를 유지해 연결했다. 기본 브랜치는 **main**, 업스트림은 **origin/main**이다. 이후 협업·CI 검토 흐름에는 **feat/*·fix/*·docs/**와 PR을 사용하고 검증된 변경을 main에 반영한다.

저장소 소유자는 nemo9nemo로 확인했다. 실제 GitHub 가입 플랜·보호 규칙·환경별 배포 비밀은 미확인·미설정이다. 비공개 저장소로 변경할 경우 보호 기능과 필요한 플랜을 다시 확인한다. [보호 브랜치](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)

### 첫 연결 때 할 일

1. 포함할 파일과 비밀 제외 목록을 확인하고 기존 문서를 첫 커밋에 포함한다.
2. 로컬 main을 준비하고 사용자가 지정한 원격 저장소를 연결한다.
3. 원격 공개 범위와 업로드 파일을 확인한 다음 첫 push를 한다.
4. main의 직접 push·강제 push·삭제를 제한하고 필수 CI 결과를 지정한다. 관리자 우회도 기본 허용하지 않는다.
5. 1인 개발에서는 PR 설명·검사 결과를 본인이 검토한다. 협업자가 생기면 최소 1명의 다른 리뷰어를 요구하고 인증·권한·배포 변경에 CODEOWNERS를 적용한다.
6. staging·production 환경과 비밀을 분리하고 운영 배포 권한자는 최소 인원으로 지정한다.

첫 연결의 1~3번을 완료했다. GitHub CLI 계정 nemo9nemo의 쓰기 권한, 빈 원격 저장소, 기존 세 커밋의 제외 경로·자격증명 패턴, origin 주소·push·업스트림·원격 SHA 일치를 확인했다. [실행 증거](quality/reports/git-remote-connection-2026-10-08.json)를 남겼다. W16-C가 CI 워크플로를 구성 중이며 4번의 브랜치 보호·필수 CI 확인과 6번의 환경별 배포 설정은 완료되지 않았다. 1인 개발이므로 별도 승인 리뷰는 요구하지 않고, PR 자체와 `quality` CI를 main 병합 조건으로 둔다. 배포 도메인은 미정이다.

### W16-C GitHub Actions 품질 검사

`.github/workflows/ci.yml`은 `main` 대상 PR·push와 수동 실행에서 읽기 전용 `contents` 권한으로 동작한다. Actions는 전체 커밋 SHA로 고정하고 저장소 인증정보를 checkout 이후 보존하지 않는다. `.node-version`의 Node.js 24.19.0, pnpm 11.19.0, frozen lockfile 설치를 사용한 뒤 `pnpm check`와 `pnpm build:check`를 순서대로 실행한다. `quality`는 필수 상태 검사 이름으로 사용한다. 운영 비밀·DB 자격증명은 CI에 전달하지 않는다. 원격 실행 성공과 main 보호 규칙 적용은 확인 전까지 완료로 기록하지 않는다.

### 포함·제외 기준

| Git에 포함 | Git에서 제외 |
| --- | --- |
| docs, 소스, 설정 템플릿, .gitignore | 실제 .env 파일, 인증서·개인키·토큰 |
| pnpm-lock.yaml, package.json, 런타임 버전 설정 | node_modules, .next, .vercel, Supabase 임시 파일 |
| supabase/migrations, 권한·회귀 테스트 | DB 덤프·백업, 사용자 기록·로그, 운영 복원 데이터 |
| CI·배포 설정, 릴리스 기록 | 비밀을 포함한 빌드 설정·관리 도구 출력 |

기능 변경과 관련 기획·권한·마이그레이션 문서를 같은 PR에서 수정한다. 릴리스는 v0.1.0 같은 태그로 남기고 커밋 SHA, 적용한 마이그레이션, 배포 ID, 검사 결과를 연결한다.

## Git 연결 후 CI/CD

Vercel의 Git push 자동 배포는 끄고 GitHub Actions가 CLI 배포 순서를 관리한다. DB와 앱의 배포가 서로 다른 경로에서 먼저 진행되지 않게 하기 위한 선택이다. 구현 시 vercel.json에 다음 기준을 적용한다.

```json
{
  "git": { "deploymentEnabled": false },
  "regions": ["icn1"]
}
```

이 예시는 문서의 설정 기준이며 현재 파일로 설치한 상태가 아니다. [Vercel Git 배포 설정](https://vercel.com/docs/project-configuration/git-configuration)

| 시점 | 실행 내용 | 비밀 사용 |
| --- | --- | --- |
| PR | 잠금 파일 설치, 타입·린트, 핵심 테스트, 로컬 DB/RLS 테스트, 빌드, 비밀·의존성 검사 | 운영 비밀 없음 |
| 신뢰된 PR의 Preview | 검증된 코드로 화면 배포, 가상 데이터 또는 독립 테스트 환경 | 운영 비밀 없음 |
| main 병합 | 같은 커밋 재검증 → 스테이징 마이그레이션 → 스테이징 배포 → E2E | 스테이징 비밀만 |
| 운영 릴리스 | 권한자의 workflow_dispatch → 검증된 main 커밋 확인 → 운영 절차 | 해당 운영 작업에만 |

운영 작업은 main의 워크플로와 지정된 릴리스 권한자만 실행하도록 검사한다. 입력된 커밋이 main의 검증된 버전이며 스테이징 테스트를 통과했는지 확인한다. 환경의 배포 브랜치도 main으로 제한한다.

GitHub Pro·Team의 비공개 저장소에서 required reviewers 같은 모든 배포 승인 기능을 쓸 수 있다고 가정하지 않는다. 기본은 제한된 권한자의 수동 실행과 보호된 main이다. 별도 승인 기능은 지원되는 플랜을 사용하는 경우에 추가한다. [GitHub 환경과 플랜](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)

CI 기본 토큰은 최소 읽기 권한으로 두고 꼭 필요한 작업에만 추가 권한을 준다. 외부 Actions는 검증한 전체 커밋 SHA로 고정한다. 신뢰되지 않는 PR 코드를 비밀이 있는 pull_request_target·workflow_run 경로에서 실행하지 않는다. 배포는 GitHub가 제공하는 임시 실행 환경을 사용한다. [Actions 보안](https://docs.github.com/en/actions/reference/security/secure-use)

환경별 배포·마이그레이션은 하나의 concurrency 그룹으로 직렬화한다. DB 적용 중인 실행을 새 배포가 강제로 취소하지 않는다. 실패한 배포의 부분 적용 여부와 마이그레이션 이력을 확인한 뒤 재시도한다.

## 운영 릴리스 순서

1. 스테이징을 통과한 소스 커밋, 잠금 파일, 마이그레이션 목록과 최근 백업을 확인한다.
2. 운영 환경값으로 빌드를 준비한다. 빌드가 운영 데이터 조회·변경을 실행하지 않게 한다.
3. 기존 운영 앱과 호환되는 추가형 마이그레이션을 한 번 적용하고 이력을 확인한다.
4. 운영 환경으로 빌드한 앱을 Vercel에 배포하되 운영 도메인 자동 연결을 보류한다. CLI의 --prod --skip-domain 기준을 사용한다.
5. 해당 배포 ID의 상태·정적 자산·비파괴 API 검사를 확인한다. 운영 사용자 데이터를 테스트 목적으로 변경하지 않는다. 로그인 전체 흐름은 고정 스테이징에서 사전에 검증한다.
6. 검증된 운영 배포 ID를 promote해 도메인을 연결한다. Preview 환경 빌드를 직접 승격하지 않는다.
7. 로그인 실패·권한 오류·API 오류율·응답 시간·DB 부하·메일 제한을 관찰하고 릴리스 기록을 남긴다.

CLI의 --skip-domain은 운영 도메인 자동 연결을 미루고 promote는 배포를 현재 버전으로 연결하는 데 사용한다. 구현 시 선택한 CLI 버전을 고정하고 실제 프로젝트의 배포 보호 설정도 검증한다. [CLI 배포](https://vercel.com/docs/cli/deploy), [CLI promote](https://vercel.com/docs/cli/promote)

## DB 변경과 롤백

스키마·제약·RLS·GRANT/REVOKE·RPC 변경은 날짜/순번이 있는 SQL 마이그레이션으로 관리한다. 적용한 파일을 수정하거나 운영 Dashboard에서 수동으로 스키마를 바꾸지 않는다. 수정은 새 마이그레이션으로 남긴다. 긴급 변경도 복구 후 코드와 이력을 일치시킨다. [Supabase 마이그레이션](https://supabase.com/docs/guides/deployment/database-migrations)

필드 추가 → 구버전·신버전 동시 호환 → 앱 배포 → 충분히 확인한 다음 후속 릴리스에서 제거하는 순서를 기본으로 삼는다. 이름 변경·삭제·대량 변환을 앱 교체와 한 번에 수행하지 않는다.

앱 오류는 호환되는 이전 운영 배포로 되돌린다. DB는 무조건 역마이그레이션하거나 초기화하지 않는다. 추가한 컬럼을 유지한 상태로 수정 마이그레이션을 적용하는 것이 기본이다. 데이터 손상 복원은 별도 DB에 먼저 검증하고 필요한 범위를 정한다.

## 백업·복원·관찰

| 항목 | 초기 기준 |
| --- | --- |
| 운영 DB 백업 | Supabase Pro 일일 백업, 최근 7일 |
| 별도 보관 | 주 1회 암호화 DB 내보내기, 접근 제한된 별도 저장소, 30일 후 폐기 |
| 데이터 손실 목표 RPO | 일일 백업 기준 최대 24시간을 목표로 설정 |
| 복원 목표 RTO | 4시간을 목표로 설정, 출시 전 실제 복원 시간 측정 |
| 복원 연습 | 출시 전 1회, 이후 월 1회 스테이징에서 확인 |
| 비용 관찰 | 월 예산 50%·80%·100% 알림, 메일·DB·함수·Redis 각각 확인 |

RPO·RTO는 운영 목표이며 보장된 서비스 수준이 아니다. 일일 백업보다 짧은 손실 범위가 필요해지면 PITR을 도입한다. Supabase DB 백업은 Storage 객체 자체를 포함하지 않으므로 사진을 도입하면 파일 백업도 별도로 정한다. Auth 제공자·SMTP·도메인·환경 설정도 DB 백업 밖에서 재현 가능하게 관리한다. [Supabase 백업](https://supabase.com/docs/guides/platform/backups)

복원된 사용자 기록은 테스트 환경의 실제 서비스 기능·메일 발송과 분리한다. 접근을 제한하고 복원 확인 후 테스트 사본을 폐기한다. 비용 알림은 지출 차단을 보장하지 않으므로 API 제한과 사용량 관찰을 함께 유지한다.

## 구현·연결 단계의 완료 기준

- 환경과 비밀이 분리되고 OAuth·OTP·초대가 스테이징에서 동작한다.
- [보안 출시 기준](security-threat-model.md)이 통과하고 현재 결과가 릴리스 기록에 남는다.
- 마이그레이션·배포·앱 롤백·백업 복원을 실제로 재현한다.
- Git 연결 시 문서·소스·잠금 파일·마이그레이션·검사가 같은 커밋으로 관리된다.
- 서비스 소유자, 실제 도메인, 프로젝트 식별자, 적용 플랜과 월 예산을 비밀 없이 기록한다.

로컬 앱 기반·DB 물리 스키마·초기 데이터·로컬 및 원격 Git은 구축·검증했다. 운영 환경·실제 로그인·통합 수락 검사·배포·복원은 위 기준에 따라 후속 단계에서 수행한다.
