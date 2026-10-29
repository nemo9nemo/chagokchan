# 차곡찬 웹 전용 출시 검토

검토일: 2026-10-29 / 작업: W22-D / 소스: `393f93bd9722a704f99a9efda070857c5efc21a1`

사용자 질문인 “스토어 앱을 출시하지 않고 별도 웹으로 제공한다면”에 대한 비교 검토다. 웹 전용 전환을 확정하거나 기존 모바일 웹/PWA → Android → iOS 정책을 변경한 문서가 아니다. 운영 주체·도메인·지원·예산은 여전히 미정이며 서비스 개설·과금·공개 배포는 수행하지 않았다. [진행표](development/backlog.md)와 [점검 증거](quality/reports/w22-d-web-launch-assessment-2026-10-29.json)를 함께 본다.

## 결론과 재사용 범위

차곡찬은 이미 Next.js 웹 화면과 Node 서버 API, Supabase Auth/PostgreSQL로 구성돼 있다. 웹 전용 출시는 기존 구현을 바탕으로 진행할 수 있다. DB를 다른 제품으로 교체하거나 별도 Express/Nest API 서버를 추가할 필요는 현재 확인되지 않았다. 이 판단은 코드와 로컬 점검에 근거하며 운영 규모의 성능 보장은 아니다.

브라우저 → HTTPS의 같은 도메인 Next.js(화면·API) → Supabase Auth/Data API → PostgreSQL 업무 RPC/RLS의 구성을 유지하는 안을 권한다. 공개 소개·도움말·정책과 비공개 기록의 접근·검색·캐시 경계를 나누고, 로그인과 운영 준비를 완성한다. PWA는 웹에서 선택적으로 홈 화면에 추가하는 기능으로 유지할 수 있으며 사용에 설치를 강제할 이유는 없다.

스토어 설치형 코드·서명·심사·스토어 개발자 계정·인앱결제 구현은 웹 전용 범위에서 빠진다. 실제 인증·회원 탈퇴·데이터 보호·지원·백업·복원은 웹에서도 남는다. 광고·결제는 첫 공개 조건이 아니다.

## 현재 DB·서버를 직접 확인한 결과

아래는 로컬 환경의 관찰 결과이며 운영 클라우드 실사를 뜻하지 않는다. 사용자 기록·Auth 자격증명은 조회하거나 출력하지 않았다.

| 확인 항목 | 2026-10-29 관찰 | 출시 판단 |
| --- | --- | --- |
| DB | PostgreSQL 17.11, 적용 마이그레이션 53개, DB 전체 23,385,779바이트 | 현재 DB 구조 재사용. 이 용량은 개발 DB 값이며 이용자 수·운영 용량 예측으로 사용하지 않음 |
| 제품 테이블 | public 테이블 18개, RLS enabled/forced 각각 18개 | 클라우드에 적용한 후에도 권한·함수 소유자·세션 경계를 다시 검증 |
| 직접 쓰기 | authenticated/anon의 INSERT·UPDATE·DELETE·TRUNCATE 테이블 권한 각 0개 | 업무 RPC를 통하는 기존 구조 유지. 전체 권한 공격 검사 완료를 뜻하지 않음 |
| 로컬 서비스 | DB/Auth/API 등 7개 컨테이너 실행. 외부에 게시된 포트는 127.0.0.1 | 개발 PC나 Docker의 DB/Studio 포트를 인터넷에 공개하지 않음 |
| 웹/API | `/`, `/api/v1/me`, `/api/v1/goal-overviews?limit=1` 모두 200·no-store | 로컬 가상 사용자 결과이며 실제 Google/OTP 성공 증거는 아님 |
| DB 연결 코드 | 서버에서 supabase-js의 Auth·RPC 호출. 로컬 HTTP, 배포 HTTPS | 일반 앱 요청에 별도의 직접 Postgres TCP 클라이언트를 추가하지 않음 |
| 인증 | 세션 검증·가입 bootstrap·로그아웃 API가 존재. 실제 로그인/갱신·가입/탈퇴 화면은 미완료 | 웹 출시 전 W12-C/D 구현·실제 제공자 검증 필요 |
| 배포 | 저장소에 vercel.json·Dockerfile 없음. Actions는 quality 검사만 존재 | 문서의 배포 계획을 실행 설정·스테이징 검증으로 구체화해야 함 |
| 정기 작업 | 로컬 pg_cron 미설치. 저장소에 운영 스케줄러 설정 미확인 | 삭제/보존기간 정리 RPC의 실행 주체·재시도·독립 삭제 원장 필요. 반드시 pg_cron을 쓸 필요는 없음 |

관찰한 코드: [배포 모드 검사](../scripts/runtime-environment.mjs), [실행기](../scripts/app.mjs), [서버 세션](../src/server/deployed-session.mjs), [공통 세션 연결](../src/server/app-session.ts), [CSP](../src/server/security-headers.mjs), [PWA](../public/sw.js), [CI](../.github/workflows/ci.yml).

Supabase Auth의 auth.users/auth.sessions와 사용자 JWT·RLS·업무 RPC에 연결된 설계다. 일반 PostgreSQL만 따로 옮기거나 MySQL/Firebase로 바꾸는 것은 단순 주소 변경이 아니며 인증·권한·SQL의 재구현과 재검증을 동반한다. 웹 제공만을 이유로 이 작업을 추가할 근거는 없다.

운영 DB는 로컬 데이터를 통째로 복제하는 대신 별도 프로젝트에 순서 있는 마이그레이션으로 구성하고 검증한다. A/B/C 사용자·개발 세션·테스트 기록은 운영으로 이행하지 않는다. Supabase가 관리하는 역할·Auth 스키마와 사용자 정의 소유자 역할의 권한 호환성도 스테이징에서 확인해야 한다. 외부 계정의 실제 프로젝트 목록은 이번에 조회하지 않았다.

배포 시 일반 업무 요청은 HTTPS Data API/RPC이므로 함수마다 새 Postgres TCP 연결을 만드는 구조가 아니다. 추후 직접 SQL 클라이언트를 도입하면 서버리스의 트랜잭션 풀러와 연결 상한을 별도로 설계해야 한다. [Supabase 연결 방식](https://supabase.com/docs/guides/database/connecting-to-postgres)

## 웹 전용 선택 시 변경·고려할 항목

| 영역 | 유지 | 추가 또는 수정 |
| --- | --- | --- |
| 목표·칭찬·공유 | 현재 화면·API·DB·개수·권한 모델 | 실제 계정·공개 환경 E2E로 재검증 |
| 로그인 | 서버 세션·CSRF·가입·로그아웃 API 기반 | Google/OTP·PKCE·서버 쿠키 발급/갱신·성인 확인 화면·초대 복귀·로그아웃 UI |
| 계정 삭제 | DB 삭제 RPC 기반 | 재인증·탈퇴 화면, Auth 정리, 독립 삭제 원장과 복원 시 재삭제 절차 |
| 첫 방문 | 기존 반응형 UI | 서비스 소개·사용 예시·도움말·지원·공개 정책. 첫 목표와 칭찬까지 짧게 안내 |
| 주소·검색 | 같은 도메인의 화면/API | 공개 소개만 검색·공유 미리보기 제공. 기록·초대·인증 화면은 인증/권한 검사와 검색 제외. noindex는 접근 제어를 대신하지 않음 |
| 도메인 | 한 도메인에 웹/API 배치 가능 | DNS·HTTPS·APP_BASE_URL·정확한 OAuth/메일 콜백. www/대표 주소·재방문 링크 통일 |
| PWA | manifest·정적 파일 캐시·오프라인 안내 | 선택 유지. 완전히 제거한다면 기존 서비스 워커의 해제/캐시 정리 배포도 설계. 앱 경로를 바꾸면 start_url·scope·오프라인 경로·복귀 URL 함께 변경 |
| 보안 | 서버 API·RLS·응답 제한·nonce CSP·no-store | 분산 요청 제한·CAPTCHA·실패 시 차단과 운영 키 관리. 메일/봇 위젯 도입 시 필요한 CSP 출처만 검토 |
| 운영 작업 | 기존 삭제·정리 SQL | 인증된 스케줄러/작업자·중복 방지·재시도·관찰. 관리자 키는 일반 제품 서버 경로와 분리 |
| 검증 | 기존 로컬 검사·CI | PC Chrome/Safari/Edge, iOS/Android 웹, 인앱 브라우저 인증 복귀·한글 입력·모바일 키보드·권한 회수·오프라인/캐시·복원·부하 |

공개 소개를 `/`, 실제 기록을 `/app`으로 나누는 안이 가능하다. 초기에는 기존 루트 앱을 유지하고 별도 소개 경로를 추가하는 방법도 있다. 주소 변경은 출시 선행 조건으로 고정하지 않는다. 현재 root layout/page가 force-dynamic이고 proxy가 문서 응답을 no-store로 처리하므로 소개 페이지의 검색·캐시를 최적화하려면 공개/비공개 layout과 헤더 적용 범위를 함께 설계한다.

쿠키·인증·동적 Route Handler를 쓰기 때문에 현재 제품을 정적 HTML만 올리는 호스팅으로 그대로 배포할 수 없다. Next.js의 정적 내보내기에는 요청 의존 Route Handler·쿠키·Proxy 등 제한이 있다. [Next.js 정적 내보내기](https://nextjs.org/docs/app/guides/static-exports)

## 서버 운영안과 비용

아래는 2026-10-29 공식 자료를 바탕으로 한 비교다. 예산 승인·견적·실제 결제가 아니다.

| 안 | 구성 | 판단 |
| --- | --- | --- |
| 관리형 우선안 | Vercel의 Next.js 화면/API + Supabase Auth/DB + 인증 메일 + 공용 제한 저장소·스케줄러 | 기존 설계와 가장 가깝다. 서버 OS 운영을 줄이고 제품·검증에 집중할 수 있어 현재 권장 |
| 서버 비용 통제 대안 | VPS/컨테이너의 Next.js + 역방향 프록시/TLS + 관리형 Supabase | 가능하나 OS 패치·재시작·배포·감시·백업·장애 대응의 담당자가 필요. 현재 배포 이미지와 프로세스 운영 설정은 미구현 |
| DB/Auth까지 직접 운영 | VPS에 Next.js와 Supabase 서비스 전체 운영 | 기술적으로 별도 검토 가능하나 첫 출시의 운영 부담이 크고 현재 구성만으로 운영 준비가 된 것은 아님 |

실행기는 production start도 `127.0.0.1`에 바인딩한다. 같은 서버의 역방향 프록시가 연결하는 VPS 구성에는 맞지만 외부 인터페이스를 기대하는 컨테이너/PaaS에서는 production host·PORT·헬스체크·시그널 종료를 맞춰야 한다. 개발 무로그인 모드의 loopback 제한은 유지한다. Vercel 배포는 플랫폼의 Next.js 빌드/실행 어댑터로 별도 검증한다. [Next.js 자체 운영](https://nextjs.org/docs/app/guides/self-hosting)

한국 중심 사용에서는 함수와 DB를 가까운 리전에 배치하는 안을 검토한다. 기존 문서의 Vercel 서울 icn1·Supabase 서울 ap-northeast-2는 현재 공식 목록에 있다. 실제 프로젝트에 적용된 상태는 아니다. 이 선택만으로 모든 메일·로그·CDN 처리가 국내로 제한되지는 않는다. [Vercel 리전](https://vercel.com/docs/regions) · [Supabase 리전](https://supabase.com/docs/guides/platform/regions)

Vercel Pro 표시 기본료는 월 US$20, Supabase Pro는 첫 Micro 프로젝트를 포함해 월 US$25부터다. 합산 출발점은 **월 US$45**이며, 같은 Supabase Pro 조직에 별도 Micro 스테이징 프로젝트 하나를 추가하면 추가 compute 최소 US$10을 가정한 **월 US$55부터**다. 도메인·SMTP·Redis/스케줄러·독립 삭제 원장·모니터링·추가 사용량·좌석·세금·환율은 별도다. [Vercel 가격](https://vercel.com/pricing) · [Supabase 가격](https://supabase.com/pricing)

Vercel Hobby는 개인 비상업 용도 제한이 있고, Supabase Free는 저활동 시 일시 정지와 자동 백업 제약이 있으므로 작은 DB 크기만 보고 정식 운영을 무료로 확정하지 않는다. [Hobby 범위](https://vercel.com/docs/plans/hobby) · [백업](https://supabase.com/docs/guides/platform/backups)

이메일 OTP를 제공하려면 실제 발신 도메인·맞춤 SMTP·발송 한도·도달 여부를 준비한다. Supabase 기본 메일 서버는 운영용이 아니며 프로젝트 팀 외 일반 이용자 발송이 제한된다. [Supabase SMTP 안내](https://supabase.com/docs/guides/auth/auth-smtp)

스테이징에서 마이그레이션·역할/RLS·부하·백업 복원을 실행하고, 운영에는 검증한 버전을 적용한다. 현재 문서화된 W09-D의 기존 집계 보정 등 적용 순서·트래픽 중단 조건도 유지한다. [배포 절차](deployment-and-git.md) · [Supabase 운영 점검](https://supabase.com/docs/guides/deployment/going-into-prod)

## 다른 웹 서비스의 실제 출시 사례

모든 창업자의 관행에 대한 통계가 아니라 당사자가 기록한 사례다. 사업·대상·시기가 달라 성과 수치나 개발 기간을 차곡찬에 대입하지 않는다.

| 1차 자료 | 확인한 실제 방식 | 차곡찬에 적용할 판단 |
| --- | --- | --- |
| [Tally 출시 회고, 2021](https://blog.tally.so/product-hunt-launch/) · [창업자 회고, 2025](https://blog.tally.so/how-we-grew-tally-to-4m-arr-fully-bootstrapped/) | MVP 후 출시 준비 체크리스트로 Product Hunt에 공개. 핵심 경험에 집중하고 사용자 대화·베타·피드백을 운영 | 첫 목표와 첫 칭찬을 쉽게 만들고 실제 사용자의 불편을 고친 뒤 공개 범위를 확대. Tally의 무가입 체험을 개인 기록의 무인증 공개로 복제하지 않음 |
| [Linear 창업자 회고, 2021](https://linear.app/now/building-at-the-early-stage) | 작은 기능을 내부와 비공개 베타에 먼저 제공하고 피드백 반영. 한 번의 대규모 출시 대신 반복 공개 | 전체 기능 확장을 기다리기보다 핵심 흐름의 안전성과 사용성을 검증한 웹 베타부터 진행 |
| [Plausible 공동창업자 회고, 2022](https://plausible.io/blog/open-source-saas) | 2019년 공개 베타, 이후 유료 구독. 개발 소식·블로그·커뮤니티·추천으로 초기 이용자 확보 | 배포와 이용자 확보를 별도 작업으로 관리. 성인 목표 기록 대상에게 데모·도움 글·피드백 요청을 전달하고 실제 재방문을 확인 |

공통 흐름으로 읽을 수 있는 것은 좁은 핵심 가치 → 실제 사용 가능한 작은 버전 → 초기 이용자와 대화 → 사용 중 막힌 곳 수정 → 공개 확대다. 이는 위 사례를 바탕으로 한 판단이며 웹 출시의 유일한 절차는 아니다.

차곡찬에는 성인 5~10명 비공개 웹 베타를 먼저 제안한다. 가입→첫 목표→첫 칭찬→다음 날/7일 재방문을 확인하고, 실제로 공유하려는 사람에게만 선택 공유를 시험한다. 운영·권한·삭제·복원·필수 수락을 통과한 후 공개 모집 범위를 넓힌다. 이 인원·기간은 제안이며 필수 제도 요건이 아니다. 첫 기록 성공률·재방문·오류율·지원 요청을 최소 이벤트/집계로 관찰하고 메모·태그·지인·초대 비밀을 분석/홍보 자료로 수집하지 않는다. 마케팅 채널과 문안은 [기존 출시 준비물](marketing/launch-kit.md)을 활용한다.

## 착수 순서와 남은 입력

1. 웹 전용 또는 PWA 선택 유지 범위를 확정하고 소개·도움말·정책과 실제 기록의 주소·검색 경계를 정한다.
2. W12-C/D의 실제 로그인·가입·갱신·로그아웃·재인증/탈퇴를 완성한다. 분산 제한·CAPTCHA·메일 실패 처리도 포함한다.
3. W14에서 운영 주체·지원 메일·도메인·월 상한을 확정하고 별도 스테이징/운영 DB와 서버·메일·삭제 원장·비밀 저장소를 준비한다. 코드 준비는 이 입력과 병행한다.
4. W13/W15에서 실제 계정 여러 개의 권한·브라우저/실기기·CSP·캐시·부하·복원을 검증하고 P0/P1을 해결한다. 이전 Chrome 연결 문제는 검증 도구 설정의 별도 조치 항목이며 기능 검사를 통과했다는 근거로 바꾸지 않는다.
5. 소규모 비공개 베타 후 W17의 검증 커밋·DB 이력·배포 ID로 웹을 공개하고 비용·장애·사용성·지원을 관찰한다.

운영 형태·연락처·예산은 아직 미정이다. 처리·보관 위치와 실제 공급자/위탁 범위를 공개 문서에 반영하고 구체적인 의무는 실제 운영 형태를 정한 후 확인한다. 이번 검토에서 계정/서비스 생성·요금제 변경·도메인 구매·인증 설정 변경·DB 이행·공개 배포는 실행하지 않았다.

## 검사 범위

이번 실행은 로컬 HTTP 읽기 3개, DB의 `BEGIN READ ONLY` 카탈로그 조회, 런타임/배포 세션/서비스 워커 단위 46개 통과 및 문서 정적 검사다. 기존 전체 unit 199·DB 406은 과거 완료 근거이며 이번에 전체를 재실행한 수치가 아니다. 실제 Google/OTP·운영 DB·부하/복원·브라우저 E2E·유료 플랜/배포는 미실행이다. 관련 REQ-001/003·NFR-001~005·POL-OPS-001, W12~W17, TC-AUTH/ACCESS/CACHE/OPS의 공개 전 수락 상태도 유지한다.
