# 공개 안내·지원 연락처 경계

W27-C1 / REQ-011·NFR-001·NFR-002·NFR-004 / POL-SEC-001·POL-ACCESS-001

소개·도움말·개인정보 처리방침·이용 안내·문의의 5개 비로그인 페이지를 구현했다. 기존 가입/로그인 정책 링크의 404를 해소하고 계정 메뉴에 도움말·문의를 연결했다. 현재 공개 전 단계이므로 전부 noindex/no-store이며, 인증·제품 DB 조회나 쿠키 발급이 없다. PC·모바일에서 설치 없이 안내를 확인한다.

문의 정보는 명시적으로 지정한 `APP_SUPPORT_EMAIL`과 `APP_PUBLIC_OPERATOR_NAME`만 읽는다. Git·Google·호스팅 계정 이메일/닉네임을 자동 대입하지 않는다. 잘못된 메일, 제어 문자/메일 헤더 주입, placeholder 도메인, 과도한 운영 이름을 거절한다. 실제 연락처가 없으면 준비 안내를 표시하고 허위 mailto를 만들지 않는다.

개인정보·이용 안내는 초안 표시를 유지한다. 실제 Google 전달 항목·운영자/연락처·시행일·공급자 위탁/국외 처리·운영 백업/삭제 검증이 확정되지 않았으므로 정식 공개 정책 완료나 법적 수락으로 기록하지 않는다. 개인/공유 개수·연결과 권한·삭제 후 상대 칭찬 이벤트 유지의 의미는 기존 제품 정책과 일치시켰다.

검증: unit 252(새 공개 정보 경계 3)·check/build·격리 production HTTP 20·공개 페이지 데스크톱/모바일 10개 읽기 검사를 통과했다. CSS nav target은 44px이며 현재 브라우저의 분수 측정은 약 43.99px다. 요청 폭 320px의 실제 innerWidth는 반올림으로 321px였고 가로 넘침은 없었다. 실제 모바일 기기·스크린리더·Google 로그인·개인 기록 쓰기는 검사하지 않았다. Codex가 React 서버/클라이언트 경계·연락처 입력과 없는 값·문안 상태·캐시/검색 경계를 직접 검토했다.

Vercel Billing 화면에서 팀의 Hobby Plan/Active와 결제 수단 미등록을 읽기 전용으로 확인했다. 이전 도구 응답에서 빠졌던 플랜을 이번에 확인했으며 유료 업그레이드·카드 등록은 하지 않았다. 보안 PR #25와 일일 Security audit 실행도 성공했다.

[검사 증거](../quality/reports/w27-c1-public-information-check-2026-11-10.json) · [Supabase DPA](https://supabase.com/legal/customer-resources/data-processing-addendum) · [Vercel 개인정보 안내](https://vercel.com/legal/privacy-notice) · [개인정보 보호법](https://www.law.go.kr/법령/개인정보보호법)
