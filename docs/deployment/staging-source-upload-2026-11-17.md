# 보호된 스테이징 소스 배포 범위

고정 소스: [공개 커밋 7010586](https://github.com/nemo9nemo/chagokchan/tree/70105860b9f8b3ef1d1e3de406615a1b9559dc11). 인증 없는 공개 GitHub archive HTTP 200의 파일과 202개 모두 바이트 일치를 확인했다. 합계 1,144,019바이트다. 전체 목록과 SHA-256은 [manifest](staging-source-manifest-2026-11-17.json)에 있다.

대상은 기존 Vercel 팀 team_q7LLsRFNid0SClIXPPtGoMnk의 chagokchan-staging(prj_fpIFXdqLYrIKI5JgkpCFcVUPrZ4Z)뿐이다. 해당 프로젝트의 production target을 사용하지만 실제 제품 운영 프로젝트가 아니라 기존 보호된 staging 별칭이다. 보호 all을 유지하고 공개 전환·플랜 변경·도메인 구매를 하지 않는다. 원격 빌드 뒤 READY·정확한 소스·비로그인 보호·문의/개인정보 페이지 표시를 검사한다.

포함: 고정 커밋의 src/public/policies/scripts 및 명시한 빌드 설정·패키지/잠금 파일. 로컬 .env·토큰·인증서·DB dump·사용자 기록·private-data·작업 공간의 미커밋 변경은 포함하지 않는다. 공급자 환경에는 사용자가 확정한 공개 운영자 네모동·지원 주소 nemodong.studio@gmail.com을 저장했다.

자동 승인 검토가 개별 파일 외부 업로드를 차단했다. 공개 소스 일치 증거를 마련한 재검토 후 57개까지 업로드됐지만 scripts/test-local-account-deletion-api.mjs에서 다시 차단됐다. 다른 전송 경로로 우회하지 않았고 배포 생성은 실행하지 않았다. 이 정확한 소스 묶음의 업로드와 기존 보호된 staging 배포 승인을 받은 뒤 이어간다.

사용자는 이후 외부 소스 업로드·배포를 보류했다. 최종 업로드 성공은 57/202개, 배포 생성은 0건이다. 동의는 현재 보류 상태이며 새 경로나 다른 소스로 재시도하지 않는다. Google 설정 재개 요청은 이 배포 보류를 취소하지 않았다.
