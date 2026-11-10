import PublicInformationLayout, { NoticeDraft } from "../public-information-layout";
export const dynamic = "force-dynamic";
export const metadata = { title: "차곡찬 이용 안내", robots: { index: false, follow: false } };
export default function TermsPage() {
  return <PublicInformationLayout title="이용 안내"><NoticeDraft />
    <h2>서비스와 이용 대상</h2><p>차곡찬은 개인 목표와 칭찬 기록을 관리하고, 선택한 목표의 칭찬판을 지인과 공유하는 웹 서비스입니다. 초기 베타는 만 19세 이상 개인 사용자를 대상으로 하며 Google 로그인과 연령 자기 확인을 요구합니다.</p>
    <h2>계정과 공유</h2><p>본인이 이용할 수 있는 계정을 사용하고 로그인 수단을 안전하게 관리해 주세요. 지인 연결과 목표별 공유 권한은 별개입니다. 공유 권한은 주인이 직접 부여·회수합니다.</p>
    <h2>게시물과 이용 제한</h2><p>타인의 권리를 침해하거나 불법인 내용을 입력하지 말아 주세요. 다른 사람의 개인정보·민감한 정보는 당사자의 권리와 동의를 확인한 뒤 다뤄 주세요. 권한을 우회하거나 자동화로 서비스를 방해하는 행위는 제한될 수 있습니다.</p>
    <h2>기록 정리와 탈퇴</h2><p>목표 휴지통 보관은 30일입니다. 기한이 지난 목표와 탈퇴 계정의 데이터는 정리 대상입니다. 계정 삭제는 재인증과 명시적 확인 후 접수하며 즉시 기록 접근을 차단합니다. 탈퇴 취소·기존 기록 복구는 제공하지 않습니다.</p>
    <p>다른 사람에게 보낸 칭찬은 작성자 정보와 본문을 지운 뒤 상대 판의 개수에 반영된 결과를 제한적으로 유지합니다. 세부 보관·삭제는 <a href="/privacy">개인정보 처리방침</a>을 확인해 주세요.</p>
    <h2>초기 베타와 문의</h2><p>초기 베타는 무료로 제공합니다. 기능 변경이나 서비스 중단이 필요하면 영향을 받는 내용과 확인 방법을 안내합니다. 이 안내는 이용자에게 법령상 보장된 권리를 제한하지 않습니다.</p>
    <p><a href="/support">운영·권리 관련 문의</a></p>
  </PublicInformationLayout>;
}
