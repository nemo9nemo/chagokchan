import { publicInformation } from "@/server/public-information.mjs";
import PublicInformationLayout from "../public-information-layout";
export const dynamic = "force-dynamic";
export const metadata = { title: "차곡찬 문의", robots: { index: false, follow: false } };
export default function SupportPage() {
  const info = publicInformation();
  return <PublicInformationLayout title="문의 안내">
    {info.operatorName && <p>운영: {info.operatorName}</p>}
    {info.email ? <p>지원·개인정보 관련 문의: <a href={`mailto:${info.email}`}>{info.email}</a></p> : <p>문의 주소는 공개 전에 이 페이지에 안내합니다. 현재 지원 연락처를 준비하고 있어요.</p>}
    <h2>문의에 적어 주세요</h2><p>문제가 발생한 화면과 대략적인 시각, 표시된 오류 안내 번호를 알려 주세요. 여러 서비스를 함께 사용하는 문의처라면 서비스 이름을 차곡찬으로 적어 주세요.</p>
    <h2>민감한 내용은 보내지 마세요</h2><p>비밀번호·인증번호·로그인 토큰·초대 링크·개인 기록 본문은 보내지 말아 주세요. 화면을 첨부할 때도 개인 정보와 기록을 가려 주세요.</p>
    <p>기록 열람·정정·삭제 등 개인정보 관련 요청은 본인 여부를 확인한 뒤 안내합니다. 계정 메뉴에서도 계정 삭제를 요청할 수 있어요.</p>
  </PublicInformationLayout>;
}
