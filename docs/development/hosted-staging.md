# HTTPS 스테이징

2026-11-10 / W14-B / 접근 권한이 있는 운영자용 검증 환경

주소는 https://chagokchan-staging.vercel.app 이다. Vercel 팀 `team_q7LLsRFNid0SClIXPPtGoMnk`의 별도 프로젝트 `prj_fpIFXdqLYrIKI5JgkpCFcVUPrZ4Z`이며, 기존 `chagokchan` 프로젝트는 운영 배포용으로 남겨 둔다. Hobby/Active를 실제 Billing 화면에서 확인했다. 유료 플랜·도메인·카드는 추가하지 않았다.

배포 소스는 PR #32까지 병합한 `0143902993861df83e1d0ef5def78db3f2f1d4e1`, 배포 ID는 `dpl_AcXo4dJtMAMN9fYsxnzbSsByZnnr`다. 앱 환경은 staging이며 Vercel 프로젝트의 production target을 고정 스테이징 주소로 사용한다. 운영 DB를 연결한 공개 production 배포를 뜻하지 않는다. Node 24.x·프로젝트의 Node 24.22.1 하한·pnpm 11.19.0·서울 함수 배치로 실제 빌드가 완료됐다.

`APP_AUTH_MODE=supabase_session`을 사용하며 로컬 가상 로그인 설정은 없다. 서울 Supabase staging `dsjrqipbakluvdvgxide`의 URL·publishable key만 일반 웹 환경에 두었다. 세션 암호화/CSRF 키는 스테이징 전용 난수로 생성해 Vercel sensitive 변수로 설정했다. 원문을 Git·문서·로그·브라우저에 넣지 않는다. DB에는 목적별 HKDF 재인증 검증 키만 별도로 구성했고 일반 웹에 관리 키를 넣지 않았다. 실제 Google 제공자 설정과 사용자 수락은 아직 미완료다.

접근 보호는 Vercel Authentication의 **All Deployments**다. 프로젝트 생성 시 기본 범위 `all_except_custom_domains`로 시작한 첫 배포의 운영 별칭이 익명 GET 200으로 응답하는 것을 확인했다. 기본 범위가 운영 별칭을 제외하므로 즉시 `all`로 강화했다. 이후 독립적인 무쿠키 요청은 Vercel 로그인으로 302 전환됨을 확인했다. 당시 앱 계정은 0개, Google 미설정 상태였으며 전체 보안 수락이나 접근 로그 전수 조사 완료를 주장하지 않는다. 이 사건을 가리거나 처음부터 모든 주소가 보호됐다고 기록하지 않는다. [2026-09-09 무료 전체 보호 변경](https://vercel.com/changelog/protect-production-deployments-for-free-on-every-plan).

기존 소유자 브라우저에서 로그인 화면, 공개 안내 5개, 앱 로그인 없는 `/api/v1/auth/session`의 AUTH_REQUIRED, 실제 CSRF 준비 응답을 확인했다. Google 버튼을 제출하거나 제품 데이터를 생성하지 않았다. 실제 로그인/가입·초대·권한·재인증·탈퇴·다중 탭·기기 수락은 별도로 진행한다. [검사 증거](../quality/reports/w14-b-https-staging-check-2026-11-10.json)

스테이징은 실제 사용자에게 공개한 서비스가 아니다. 이메일 입력 대기와 별개로 독립 원장·삭제 worker·백업/복원·분산 요청 제한을 이어서 구현/검증한다. 운영 공개 전에는 운영 환경에 분리된 비밀/DB를 설정하고 같은 검증 소스를 해당 환경에서 다시 빌드한다.
