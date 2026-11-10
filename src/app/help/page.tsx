import PublicInformationLayout from "../public-information-layout";
export const dynamic = "force-dynamic";
export const metadata = { title: "차곡찬 도움말", robots: { index: false, follow: false } };
export default function HelpPage() {
  return <PublicInformationLayout title="차곡찬 도움말">
    <h2>처음 시작하기</h2><ol><li>Google 계정으로 로그인하고 만 19세 이상임을 확인해 주세요.</li><li>목표를 만들고 오늘의 작은 수고를 개인 칭찬으로 남겨 보세요.</li><li>함께할 사람이 있다면 초대로 연결하고, 공유할 목표의 권한을 따로 선택해 주세요.</li></ol>
    <h2>개인판과 공유판</h2><p>나의 기록과 지인이 남긴 칭찬은 별도 판에서 세어요. 공유 권한을 받은 사람도 내 개인 기록이나 다른 지인의 칭찬 본문을 볼 수 없어요.</p>
    <h2>숨김·제외·취소</h2><p>숨김은 목록 표시만 바꾸고 개수는 유지해요. 제외와 작성자 취소는 해당 칭찬을 개수에서 빼며, 초기 버전에서는 되돌릴 수 없어요.</p>
    <h2>전송 결과가 불확실할 때</h2><p>성공 안내가 없다면 저장됐다고 판단하지 말아 주세요. 화면의 재확인 버튼으로 같은 요청 결과를 확인할 수 있어요. 오프라인에서는 조회·작성에 인터넷 연결이 필요해요.</p>
    <h2>목표 삭제와 계정 삭제</h2><p>목표는 휴지통으로 이동한 뒤 30일 이내에 복구할 수 있어요. 복구해도 공유 권한은 돌아오지 않아요. 계정 삭제는 Google 재인증과 별도 확인이 필요하며, 접수 뒤 접근을 차단하고 취소·복구를 제공하지 않아요.</p>
    <h2>공용 기기에서 사용했다면</h2><p>사용을 마친 뒤 계정 메뉴에서 로그아웃해 주세요. 다른 기기의 로그인도 종료하려면 모든 기기에서 로그아웃을 선택해 주세요.</p>
    <p>도움이 더 필요하면 <a href="/support">문의 안내</a>를 확인해 주세요.</p>
  </PublicInformationLayout>;
}
