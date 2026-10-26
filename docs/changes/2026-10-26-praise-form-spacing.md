# W25-E 칭찬 입력창 간격과 배지 정렬

사용자 화면 주석 4건에 따라 태그 삭제 버튼의 공통 padding을 제거하고 칩 내부에서 아이콘을 8px 당겼다. 버튼은 CSS 기준 44×44px을 유지한다. 칩과 입력창은 fieldset과 같은 12px 간격 토큰을 사용하고 태그가 없으면 빈 칩 행을 숨긴다.

메모·태그 선택·자동 날짜/작성자는 텍스트와 배지를 명시적으로 감싸 flex 중앙 정렬·6px 간격·1.4 line-height를 적용한다. 라벨의 텍스트 공백·htmlFor와 삭제 버튼의 aria-label/type은 유지한다. TagInput을 사용하는 작성·수정에 공통 적용된다. 저장·IME 처리·권한·API·DB·정책 값은 변경하지 않았다.

관련 기준은 REQ-003·NFR-002·POL-PRAISE-001/002·UI05다. 검증은 [검사 증거](../quality/reports/w25-e-praise-spacing-check-2026-10-26.json), 상태는 [진행표](../development/backlog.md)를 따른다. 실제 브라우저 주소 접근 정책 차단으로 743×784px·320px 렌더링 및 조작 영역 실측은 미실행이며 TC-PRAISE-TAG-003·TC-UX-001의 수락 상태를 올리지 않는다. Codex가 직접 소스·diff를 검토했고 새 단위 검사는 추가하지 않았다.
