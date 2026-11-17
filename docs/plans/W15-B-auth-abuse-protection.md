# 인증·초대 남용 방어의 현재 경계와 단계

2026-11-17 / W15-B / NFR-001·NFR-003 / POL-LIMIT-001·POL-SEC-001 / TC-RATE-001

기존 보호된 staging의 Vercel API는 custom firewall configuration 없음과 기본 방화벽 적용을 반환했다. `googleStartResponse`는 현재 세션·CSRF·허용 입력·PKCE를 검사하지만 IP별 공유 제한기를 호출하지 않는다. 제품 RPC의 사용자별 DB 제한과 프로필 제한기 장애 503 검증은 존재하나, 이것을 로그인 시작·직접 Supabase Auth 경로의 분산 남용 방어 완료로 보지 않는다. Supabase 화면에서 staging Email ENABLED·Google DISABLED를 확인했고 이번 읽기에서 변경하지 않았다.

## 먼저 준비할 단일 관찰 규칙

대상은 기존 `chagokchan-staging` 프로젝트다. POST `/api/v1/auth/google/start`, POST `/api/v1/auth/reauth/start`, POST `/api/v1/auth/refresh`, POST `/api/v1/connection-invites/preview`, POST `/api/v1/connection-requests`를 OR로 묶은 한 규칙을 검토한다. IP별 fixed window 60초/60회는 초기 관찰용 제안이다. 기존 앱 정책의 초대 IP 30회/15분을 바꾸는 수치가 아니다. 처음에는 follow-up action을 log로만 준비하고 요청을 차단하지 않는다. 본문·Cookie·Authorization을 로그 대상으로 추가하지 않는다.

실제 호출 경로는 현재 route 파일과 대조했다. 다음은 **미실행 CLI 초안**이며, 실행 시 설치 CLI의 help·기존 draft·팀/프로젝트를 다시 확인한다.

```powershell
vercel firewall rules add "Observe auth and invite bursts" `
  --condition '{"type":"method","op":"eq","value":"POST"}' `
  --condition '{"type":"path","op":"inc","value":["/api/v1/auth/google/start","/api/v1/auth/reauth/start","/api/v1/auth/refresh","/api/v1/connection-invites/preview","/api/v1/connection-requests"]}' `
  --action rate_limit --rate-limit-window 60 --rate-limit-requests 60 `
  --rate-limit-keys ip --rate-limit-action log --yes
```

규칙 생성/게시/활성화는 이번에 실행하지 않았다. 연결된 API의 PATCH는 active configuration에 영향을 줄 수 있어, 이를 CLI의 staged draft와 같다고 가정하지 않았다. 실제 게시 단계는 트래픽 확인과 사용자의 publish 실행 절차를 따른다.

## 규칙만으로 해결되지 않는 것

- 공급자 문서는 Hobby rate limit 규칙 한 개와 10초~10분 window를 안내한다. 앱의 15분 제한은 이 규칙 하나로 정확히 구현했다고 주장할 수 없다. 전역의 정확한 IP bucket은 별도 공유 상태와 실패 시 차단이 필요하다.
- WAF 카운터는 지역별이다. 여러 지역의 카운터를 한 개의 전역 제한으로 간주하지 않는다. BFF의 분산 IP/flow 제한과 직접 Auth endpoint 방어를 별도로 수락한다.
- 실제 초기 베타는 Google만 제공한다. Google 제공자 수락 시 Email/익명·기타 제공자 상태, 직접 Auth 요청·공급자 자체 제한과 지원하는 봇 방어를 확인해야 한다.
- log 관찰 → 합성 정상/초과 요청의 매치 확인 → preview에서 429 확인 → 정상 트래픽 오탐 검토 → 적용 순서다. 실패 시 중요 쓰기 503·여러 서버·반복 초대·로그인·칭찬·429 후 동일 대상/키 재시도 검사가 필요하다.

무료 문서와 실제 계정 플랜을 구분한다. [현재 가격표](https://vercel.com/pricing)는 Hobby의 월 1M rate-limit requests 포함과 추가 사용 구매 불가를 안내한다. Pro/유료 전환·과금 기능은 승인하지 않았다. 플랜은 이번 작업에서 변경하지 않았다. [공식 rate-limit 제한](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting) · [방화벽 규칙](https://vercel.com/docs/cli/firewall) · [진행표](../development/backlog.md).
