# 웹앱 출시 전환과 서버·DB 시장조사

조사일: 2026-11-03 / 작업: W27-A / 기준 소스: `aad1ef59e683ad5c0a75582f0ececcb0e2ab2e94`

사용자가 앱 출시 계획을 웹앱 출시로 변경했다. PC·모바일 브라우저에서 URL로 사용하는 반응형 웹앱을 공개하고 PWA 홈 화면 추가는 선택 기능으로 유지한다. Android/iOS 설치형·스토어·서명·인앱결제·개발자 계정 준비는 현재 출시 범위에서 제외하며 사용자 재요청 전에는 자동 재개하지 않는다. [ADR-0010](decisions/ADR-0010-webapp-release.md) · [진행표](development/backlog.md)

## 현재 진행 상태

| 영역 | 확인한 완료 범위 | 남은 작업 |
| --- | --- | --- |
| 핵심 기능 | 목표·개인/공유판·칭찬·여러 태그·연결/권한·소식·휴지통·반응형 화면·선택 PWA 로컬 구현 | 실제 사용자 전체 수락, 작은 화면/입력/접근성/캐시 실기기 검사 |
| 인증 | 요청별 서버 세션·성인 확인 가입 DB/API·현재/전체 로그아웃 API | Google/OTP·PKCE·가입/로그아웃 UI·갱신 경합·초대 복귀·재인증/탈퇴 |
| DB | 53개 SQL 파일. 10-29 로컬 카탈로그 증거는 PostgreSQL 17.11·제품 18테이블·18/18 RLS forced·직접 DML 권한 0 | 클라우드 역할/Auth 접근 호환성·새 환경 마이그레이션·삭제 작업자·복원 검증 |
| 품질·원격 | 저장된 최근 전체 unit 199·DB 406, main PR 보호·quality CI, PR #17~19 병합 이력 | 실제 로그인 0·제품 전체 수락/운영 부하/복원/공개 배포 미완료. 11-03 로컬 기본 check는 Node 고정 버전 부재로 시작 전 차단 |
| 운영 | 운영·지원・도메인·예산 입력 항목과 절차 문서 | 서비스 개설·실제 제공자 설정·독립 삭제 원장·HTTPS 스테이징/운영 |

11-03에 원격 main과 로컬 시작 HEAD `aad1ef5` 일치를 확인했다. 위 unit/DB·실행 중 DB 수치는 과거 검사 근거이며 이번 재실행 결과로 집계하지 않는다. [10-29 점검](web-only-launch-review.md) · [등록부](development/artifact-register.json)

## 재사용할 구조와 선택 원칙

브라우저 → 같은 출처 Next.js 화면/API → 서버의 Supabase Auth/Data API → PostgreSQL RPC/RLS를 유지하는 것이 현재 권고다. 별도 Express/Nest API 서버나 브라우저 Supabase 클라이언트를 추가할 근거는 없다. `auth.users`·`auth.sessions`·사용자 JWT·함수 소유자 역할을 사용하는 현 소스에서 DB 교체는 인증·권한의 재구현과 검증을 수반한다.

비교 기준은 ① 현재 Next.js/Node 기능의 호환성 ② 혼자 운영할 때 장애·패치·복원 부담 ③ 한국 사용자와 DB 사이 지연 ④ 운영·스테이징을 포함한 기본료 ⑤ 초과 사용량과 중단 통제 ⑥ DB/Auth 이행 비용이다. 아래 권고는 이 기준에 따른 판단이며 각 서비스에서 차곡찬을 배포·부하 시험한 결과가 아니다.

## 웹 서버 후보

USD/월, 개발자 1명·운영 웹 1개·Supabase Pro Micro 운영 DB 1개를 가정한다. 무료 체험/한시 할인은 합계에서 제외한다. 마지막 열은 같은 Supabase Pro 조직에 별도 Micro 스테이징 DB 1개를 추가한 값이다. 웹 스테이징의 별도 서버 자원이 필요하면 추가한다.

| 후보 | 웹 서버 표시 기본료 | 운영 웹+DB | 별도 staging DB 포함 | 적합성·추가 부담 |
| --- | --- | --- | --- | --- |
| Vercel Pro | $20 | $45부터 | **$55부터** | 우선 검증안. Next.js 기본 경로·서울 함수 리전. Node 패치 고정/빌드 명령 검증 필요 |
| Cloudflare Workers Paid | $5 최소 | $30부터 | **$40부터** | 비용 절감 대안. 현재 공식 권장은 beta vinext, OpenNext 대안도 별도 호환성 확인 필요 |
| AWS Lightsail Linux IPv4 2GB | $12 | $37부터 | **$47부터** | 서버 직접 운영 대안. OS/TLS/프로세스/배포/감시/백업은 직접 준비. staging 웹 VM·스냅샷 별도 |
| Render Node Web Service | 이번 공개 가격 본문에서 인스턴스 가격 미확인 | 확정 합계 없음 | 별도 웹 인스턴스 비용 확인 필요 | 일반 Node로 Next.js 제공 가능. 공식 리전에 서울은 없고 Singapore 있음. 무료 Static Site로 대체 불가 |

Vercel과 Supabase 합계는 [Vercel 가격](https://vercel.com/pricing), [Supabase 가격·프로젝트 계산](https://supabase.com/pricing)을 합산했다. Vercel은 Pro $20와 포함 사용 크레딧을 표시하며 추가 좌석/리소스에 따라 달라진다. 함수와 DB의 서울 배치 후보는 [Vercel 리전](https://vercel.com/docs/regions), [Supabase 리전](https://supabase.com/docs/guides/platform/regions)에서 확인했다. 실제 선택 리전은 미설정이다.

Cloudflare의 $5는 Workers 기본료다. 유료 포함량은 월 동적 요청 1천만·CPU 3천만 ms이며 초과 요청/CPU, 저장소 등은 추가될 수 있다. 공식 Next.js 안내는 2026-08-25 갱신 본문에서 vinext를 권장하고 beta임을 명시한다. 기존 Next.js API 표면을 재구현하는 방식이므로 현 프로젝트의 `proxy.ts`·nonce CSP·서버 쿠키·Route Handler·supabase-js를 그대로 보장할 수 없다. OpenNext 문서도 Node.js middleware 미지원 항목을 명시한다. **가격만 보고 즉시 이행하지 않고 별도 실험에서 통과하면 재비교**한다. [Workers 요금](https://developers.cloudflare.com/workers/platform/pricing/) · [현재 Next.js 안내](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/) · [OpenNext 대안](https://developers.cloudflare.com/workers/framework-guides/web-apps/opennext/)

Lightsail $12는 public IPv4·2GB RAM 일반 Linux 번들의 표시값이다. 2GB가 차곡찬에 충분하다는 실측 결과는 없으며 빌드는 CI에서 수행하는 안을 먼저 검토한다. 서울에서 생성 가능한 실제 번들·전송량·스냅샷/추가 IPv4/백업 비용을 개설 전에 다시 확인한다. [AWS 번들 가격](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-bundles.html)

Render는 [Next.js 공식 배포 안내](https://render.com/docs/deploy-nextjs-app)와 [리전](https://render.com/docs/regions)을 확인했다. [가격 페이지](https://render.com/pricing)의 읽을 수 있는 본문에 서버 인스턴스 금액이 없어 이번 견적에는 과거의 $7을 사용하지 않았다. 인스턴스/작업공간/전송량을 실제 가격표에서 확인해야 비교를 완료할 수 있다.

## DB/Auth 후보

| 후보 | 확인한 비용·특성 | 현 소스 영향과 판단 |
| --- | --- | --- |
| Supabase 관리형 Pro | 조직 $25 + 프로젝트 compute - $10 크레딧. Micro 1개면 $25, 2개면 $35부터. 일별 백업 7일 | **유지 권고**. 현재 SQL·Auth·Data API·RLS를 재사용. cloud 권한·세션 테이블 접근은 staging에서 검증 |
| Supabase Free | DB 500MB·프로젝트 2개 제한·저활동 1주 후 pause·자동 백업 미포함 | 합성 데이터 실험 후보. 실제 사용자 운영의 기본안으로 확정하지 않음 |
| Neon | Free와 사용량 과금 Launch 제공. Launch의 typical $15는 예시이며 고정 월 정액이 아님 | PostgreSQL 대안이나 현 Supabase Auth/RPC 경계를 자동 대체하지 않음. 관리형 Better Auth 제공도 현 세션/RLS와의 호환 증거가 아님 |
| Supabase 전체 직접 운영 | Docker 방식의 자체 호스팅 제공. 서버·저장소·백업·보안·모니터링 비용 직접 부담 | 기능 유지 가능성은 있으나 관리형과 기능/업데이트/복원 운영 차이를 검증해야 함. 첫 출시 기본안에서 제외 |

근거: [Supabase 가격](https://supabase.com/pricing) · [조직별 과금](https://supabase.com/docs/guides/platform/billing-on-supabase) · [백업 범위](https://supabase.com/docs/guides/platform/backups) · [Neon 가격](https://neon.com/pricing) · [Supabase 자체 호스팅](https://supabase.com/docs/guides/self-hosting)

현재 마이그레이션은 Supabase 관리 Auth 테이블 조회와 사용자 정의 역할을 사용한다. 로컬 성공만으로 cloud 적용 성공을 가정하지 않는다. 순서 있는 53개 SQL·함수 소유권/search_path/ACL·anon/authenticated 직접 DML 거절·폐기 세션 거절을 **폐기 가능한 별도 staging DB**에서 검증한 뒤 운영으로 진행한다. 운영으로 개발 A/B/C·로컬 세션·테스트 기록을 복제하지 않는다.

## 기본료 밖에 필요한 운영 서비스

| 역할 | 검토안과 확인한 조건 | 출시 준비 |
| --- | --- | --- |
| 인증 메일 | Supabase Custom SMTP + Resend 후보. 공식 비교에는 월 3천 통 $0·5만 통 $20, Free 하루 100 제한 | 발신 도메인·SPF/DKIM·반송·도달/지연·재발송 제한·스테이징 분리. 발송용 서비스와 지원 수신 메일함을 구분 |
| 분산 요청 제한 | Upstash Redis Free 월 50만 명령, PAYG 10만 명령당 $0.20. 저장소/전송 초과 별도 | HTTP 요청 1개를 Redis 명령 1개로 계산하지 않음. 여러 인스턴스·장애 시 중요 쓰기 거절 검사 |
| 삭제/보존 작업 | Vercel Cron 또는 별도 인증된 작업자 후보. Cron 호출도 함수 사용량에 포함 | 중복 실행·재시도·작업 권한·실패 관찰. 일반 제품 세션과 관리자 작업 경계 분리 |
| 독립 삭제 원장·백업 | 원 DB 밖 저장소에 접근 제한·암호화·만료. 공급자·요금 미선정 | 복원 전 원장 재적용으로 삭제 계정/본문 재노출 방지. DB 백업만으로 원장/Storage 객체가 보존된다고 가정하지 않음 |
| 도메인·DNS·HTTPS·지원 | 도메인/지원 주소 미정 | OAuth/메일 고정 HTTPS 콜백·환경 분리·지원 수신 시험 |
| 모니터링·비용 통제 | 기본 플랫폼 관찰 + 최소 오류/비용 알림 후보 | 이메일/본문/초대/토큰 로깅 제외. 비용 경보와 모든 과금을 막는 hard cap을 구분 |

근거: [Supabase SMTP 제한](https://supabase.com/docs/guides/auth/auth-smtp) · [Resend 공식 비교](https://resend.com/migrate/sendgrid) · [Resend Free 일일 제한](https://resend.com/pricing) · [Upstash 요금](https://upstash.com/pricing/redis) · [Vercel Cron 과금](https://vercel.com/docs/cron-jobs/usage-and-pricing) · [Supabase 백업 제외 범위](https://supabase.com/docs/guides/platform/backups)

Supabase 기본 SMTP는 일반 외부 사용자에게 보내는 운영 메일로 사용하지 않는다. 무료 메일 3천 통은 가입자 3천 명을 뜻하지 않는다. 로그인·재전송·재인증 횟수, 하루 피크와 두 환경의 합계를 산정한다. Vercel Hobby는 개인 비상업 용도 제한이 있으므로 무료 공개가 곧 Hobby 적합성을 뜻하지 않는다. [Hobby 범위](https://vercel.com/docs/plans/hobby)

## 비용을 판단하는 방법

월 합계 = 웹 기본료/사용량 + Supabase 조직/프로젝트 + 인증 메일 + Redis 명령/저장소/전송량 + 독립 원장/백업 + 도메인 연 비용의 월 환산 + 관찰 도구 + 세금/환율이다. 위 $55/$40/$47은 이 가운데 웹·DB 부분의 비교값이며 전체 청구 상한이나 확정 견적이 아니다.

Vercel 안에서 운영 DB+staging DB $35와 웹 $20을 합치면 $55부터, 메일을 $20 플랜으로 올리는 예라면 $75부터다. 기존 제안인 월 10만~15만원을 승인 예산으로 취급하지 않는다. 사용자 월 상한은 계속 미정이며 실제 예산을 받기 전 원화 비용을 확정하지 않는다. Supabase의 spend cap도 모든 리소스를 포괄하는 지출 한도라고 가정하지 않고 compute/추가 프로젝트/유료 옵션별 적용 범위를 W14에서 확인한다.

베타에서 기록할 값은 동적 요청 수·CPU·p95 지연·오류율·DB 크기/증가량·egress·OTP 발송 수/재시도·Redis 명령 수·백업/원장 크기다. MAU 포함량만으로 수용 사용자 수나 월비용을 보장하지 않는다. 이번에는 운영 트래픽·클라우드 벤치마크·실제 청구를 측정하지 않았다.

## 구현 전에 확인할 배포 제약

| 현재 소스 또는 플랫폼 조건 | 후속 작업 |
| --- | --- |
| `scripts/app.mjs`가 Node `24.19.0` 정확 일치를 강제. Vercel은 메이저만 선택하며 patch/minor를 갱신 | W27-B에서 로컬/CI 재현용 고정과 배포 런타임 검사를 분리하는 방안 검증. 검사 우회 없이 빌드 경로 결정 |
| `pnpm start`가 production도 127.0.0.1에 바인딩 | VPS 동일 호스트 프록시는 가능. Render/컨테이너는 production host·PORT·헬스체크·종료 시그널 검증. 개발 loopback 가드는 유지 |
| force-dynamic 화면·서버 쿠키·Route Handler·nonce CSP | 정적 호스팅만으로 배포 불가. Cloudflare 이행 시 proxy/쿠키/CSP·Node API를 별도 재검증 |
| 배포 설정·운영 Cron·분산 제한·독립 원장 미구현 | 선택 공급자의 구성 파일·비밀 분리·작업 인증·복원 절차와 검사 근거 추가 |

소스: [실행기](../scripts/app.mjs) · [환경 가드](../scripts/runtime-environment.mjs) · [서버 세션](../src/server/app-session.ts) · [proxy](../src/proxy.ts). 공식 조건: [Vercel Node 버전](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions) · [Next.js 정적 export 제한](https://nextjs.org/docs/app/guides/static-exports). 이번에는 배포용 실행 코드를 변경하지 않았다.

11-03 실제 로컬 도구는 기본 Node v22.14.0·번들 Node v24.22.1이었고 프로젝트는 24.19.0을 요구했다. `scripts/project.ps1 -Task check`는 검사 실행 전에 이 차이를 감지해 종료했다. 문서 정적 검사는 번들 v24.22.1로 별도 실행해 통과했으며 이를 고정 환경의 전체 check/build 통과로 기록하지 않는다. 로컬 재현 환경 복구와 배포 버전 정책 정리는 W27-B의 선행 항목이다.

## 진행 순서와 완료 기준

1. **W27-A 완료:** 웹앱 전환 결정·요구/개발 정책/실행안/진행표/등록부 정합성과 이번 시장조사. 서비스·예산 선택 완료와 구분한다.
2. **W27-B 다음:** Vercel 우선 후보의 빌드/런타임 경계와 설정을 로컬에서 준비·검증한다. Cloudflare는 별도 실험으로 비용 절감 가능성을 확인할 수 있으나 beta 이행을 기본 작업에 넣지 않는다.
3. **W12-C/D 병행:** 실제 로그인·갱신·로그아웃/가입 UI·초대 복귀·탈퇴, 분산 제한/CAPTCHA/메일 실패를 구현한다. 로컬 무로그인 사용은 유지한다.
4. **W27-C 및 W14:** 공개 소개/도움말/약관/지원과 비공개 기록의 경로·검색·캐시 경계 준비. 운영 주체·도메인·지원·월 상한·공급자 선택 뒤 staging/production 개설과 메일/원장 설정을 진행한다. `/app` 이동은 확정하지 않는다.
5. **W13/W15 → W17:** 실제 여러 계정·PC/모바일 브라우저·한글 입력·모바일 키보드·로그아웃/계정 전환/PWA·권한 회수·복원·부하 수락을 통과한 뒤 소규모 웹 베타와 공개를 진행한다.

스토어 제출·테스터 수 규정·Apple 로그인·인앱결제는 이번 웹앱 출시의 통과 조건에서 제거한다. 웹에서도 실제 인증·삭제·보안·백업/복원·지원은 필수다. 운영 주체·예산·도메인 등은 임의 확정하지 않았다. 서비스 개설·과금·인증 설정 변경·클라우드 DB 이행·공개 배포는 미실행이다.

관련: REQ-001/010/011, NFR-001~005, POL-SEC-001·POL-OPS-001, TC-AUTH/WEB/CACHE/OPS. API/데이터 관계 변경이 없어 OpenAPI·ERD·SQL은 유지한다. 이번 문서 검사는 실제 제품 수락 통과로 집계하지 않는다. [검사 증거](quality/reports/w27-a-webapp-transition-check-2026-11-03.json)
