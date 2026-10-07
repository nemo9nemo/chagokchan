# 차곡찬 (Chagokchan) — 문서 안내

최종 정리: 2026-10-08 / 현재 단계: 요구사항·정책·설계 산출물 정리와 개발 준비

**목표별 개인 칭찬판에는 셀프 칭찬을, 공유 칭찬판에는 허용된 지인의 칭찬을 따로 모은다.** 지인 연결과 목표별 공유 권한은 분리하며 기능 확장 때도 기존 목표·칭찬 기록을 유지한다. 포도는 교체 가능한 테마이며 서비스 브랜드는 칭찬·성취·응원을 중심으로 정한다.

## 이번에 결정한 기준

| 항목 | 결정 |
| --- | --- |
| 첫 사용자 | 성인 개인 중심, 한국 가입은 만 19세 이상 자기 확인 |
| 브랜드·테마 | 차곡찬 확정. 영문 Chagokchan·개발 slug chagokchan. 표현 테마와 브랜드는 독립 |
| 첫 출시 | 모바일 웹/PWA |
| 개발 스택 | Next.js·TypeScript·Supabase PostgreSQL/Auth·Vercel |
| 로그인 | Google + 이메일 6자리 인증번호, 서버 관리 세션 |
| 개발 중 사용 | 로그인 화면 없이 로컬 가상 사용자. 실제 Google/OTP 연동·테스트·실사용은 오픈 준비 시점 |
| 개발 작업 공간 | `C:\Users\love0\nemo9Dev\chagokchan`. [진행표](development/backlog.md)를 완료마다 갱신 |
| 사람 연결 | 24시간 일회용 링크·QR·코드 → 연결 요청 → 초대한 사람의 확인 |
| 판 권한 | 주인·칭찬 권한자. 연결만으로 목표를 공개하지 않음 |
| 공유 범위 | 공유용 제목·개수와 지인이 직접 보낸 칭찬. 개인 원본·다른 지인의 본문은 비공개 |
| 보안 | 서버·DB 권한 검사, RLS, 원자적 RPC, 초대·세션·중복·웹 공격 검증 |
| 배포 | Vercel Pro + Supabase Pro 서울 기준, 별도 스테이징 |
| 형상관리 | 추후 GitHub 비공개 저장소·main/PR·Actions 연결 |
| 외부 도구 | 사용 허용. Miro 기획 검토, 구현 단계에서 Supabase·Vercel, 추후 GitHub 저장소 연결 |

기획의 개수 예시·시각 디자인·수익화는 별도 검증 대상이다. 기술 정책은 아래 문서에 정한 값으로 개발을 시작하며, 바꾸면 관련 문서와 변경 이유를 함께 기록한다.

## 실제 개발 산출물

| 산출물 | 기준 파일 |
| --- | --- |
| 개발 절차·현재 상태·의존 작업 | [개발 절차](development/README.md), [등록부](development/artifact-register.json), [작업 목록](development/backlog.md) |
| 브랜드·영문 표기·테마 독립 원칙 | [브랜드 기준](branding/brand-guide.md), [이름 검토 기록](branding/name-candidates-2026-10-07.md), [ADR-0003](decisions/ADR-0003-release-name.md) |
| 작업 규칙·환경/비밀 제외 | [AGENTS.md](../AGENTS.md), [.env.example](../.env.example), [.gitignore](../.gitignore) |
| 기능·비기능 요구와 수락 기준 | [MVP 요구사항](requirements/mvp-requirements.md) |
| 정책 수치·옵션 | [app-policy.json](../policies/app-policy.json) |
| 개발 중 무로그인·배포 분리·상태값 | [development-policy.json](../policies/development-policy.json), [로컬 개발](development/local-development.md), [ADR-0004](decisions/ADR-0004-local-development-auth.md) |
| 사용자 범위·가입 경계 | [성인 가입 정책](policies/audience-and-signup.md), [ADR-0002](decisions/ADR-0002-adult-personal-audience.md) |
| 상태·집계·날짜·관계 규칙 | [제품 정책](policies/product-rules.md) |
| 삭제·복구·계정·보관 | [생명주기](policies/data-lifecycle.md) |
| 역할별 읽기·응답 경계 | [권한·응답 정책](policies/access-and-responses.md) |
| 화면·오류·상태 전이 | [화면 흐름](design/user-flows.md) |
| 요청·응답·오류·인증 계약 | [OpenAPI](../contracts/openapi.json), [API 규칙](contracts/api-contract.md) |
| 검증 시나리오·계층·실행 증거 | [검증 계획](quality/verification-plan.md), [36개 TC](quality/test-cases.json), [검사 기록](quality/reports/2026-10-07-baseline.md) |
| 결정·변경·릴리스 기록 | [ADR](decisions/ADR-0001-development-baseline.md), [범위 변경 기록](changes/2026-10-07-adult-audience.md), [변경 양식](templates/change-record.md), [릴리스 양식](templates/release-record.md) |

요구 ID → 정책 ID → API operation → TC → 개발 작업을 연결했다. 현재 TC는 실행 계획이며 실제 기능 검증 결과는 아니다.

## 문서 목록

| 문서 | 내용 |
| --- | --- |
| [제품 기획 v0.2](product-plan-v0.2.md) | 현재 제품 방향, 목표별 개인·공유 구조, 화면과 첫 출시 범위 |
| [실제 구현 전 고려사항](pre-implementation-plan.md) | 구현 범위, DB 전에 정할 정책, API 계약, 개발 준비·검증·구현 순서 |
| [데이터 ERD](data-erd.md) | 핵심 기록·연결·운영의 관계도, 키·제약·상태·읽기 범위, Mermaid 원본 |
| [개발 스택·아키텍처](technical-architecture.md) | 스택 선택, 서버·DB 구조, 데이터 단위, 일관성·캐시·개발 순서 |
| [로그인·계정 연결·권한](auth-and-permissions.md) | 로그인 수단, 세션, 초대 방법, 판별 권한표, 해제·차단·요청 제한 |
| [보안 위협·검증](security-threat-model.md) | 예상 취약점, 예방 규칙, 출시 전 테스트, 사고 대응 |
| [배포·운영·Git](deployment-and-git.md) | 환경·비밀 분리, 배포 순서, 백업·롤백, 향후 Git·CI/CD |
| [외부 도구 연결](external-tools.md) | 도구별 사용 목적·설치 상태·연결 순서, Miro 검토와 원본 문서 관리 |
| [추가 고려사항](additional-considerations.md) | 삭제·탈퇴·복구, 사용자·연령, 초대 UX, 접근성·알림, 비용·베타 지표, 결정 우선순위 |
| [기능 확장 설계](feature-expansion-design.md) | 테마·그룹·보상·위젯·외부 연동 등을 추가할 구조 |
| [시장조사](market-research-2026-10-07.md) | 유사 앱·웹 공식 자료, 기능 비교, 검증할 차별화 가설 |
| [이전 기획 v0.1](product-plan-v0.1.md) | 초기 탐색 기록. 현재 개발 범위는 v0.2와 기술 문서 기준 |

개발자는 요구사항 → 정책 → ERD·API·화면 → 검증 계획 → 개발 절차 순서로 읽는다. 제품 기획·아키텍처·위협 모델·배포 문서는 맥락과 상세 기준을 함께 제공한다. 정책 충돌은 관련 기준 파일에서 통일한다.

## 현재 완료 상태와 다음 작업

이번 작업은 문서를 추가·정리한 단계다. 실제 앱 코드, 로그인 계정, DB·클라우드 서비스, Git 저장소와 원격 연결은 아직 만들지 않았다. 보안 문서는 설계 요구이며 취약점 진단이나 테스트 통과 결과가 아니다.

외부 도구 사용은 허용되었고 Miro 설치를 제안했다. GitHub 플러그인은 설치된 상태지만 이 앱의 저장소는 추후 연결한다. 도구별 상태와 실행 순서는 [외부 도구 연결 문서](external-tools.md)에 기록한다.

I01~I09는 개발 정책과 ERD v0.3·계약·TC로 구체화했다. 다음 단계는 Node 24·pnpm·Docker·Supabase CLI로 로컬 개발 기반을 준비하고 DB·권한·RPC·로컬 사용자부터 구현하는 것이다. 실제 로그인 제공자는 오픈 준비 때 연결한다. 성인 개인 범위는 확정했고 가입 기준·확인 기록을 정책·설계에 반영했다. Git 연결 시 문서·정책·계약·소스·잠금 파일·마이그레이션을 함께 관리한다.
