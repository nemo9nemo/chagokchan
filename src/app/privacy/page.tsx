import policy from "../../../policies/app-policy.json";
import { publicInformation } from "@/server/public-information.mjs";
import PublicInformationLayout, { NoticeDraft } from "../public-information-layout";
export const dynamic = "force-dynamic";
export const metadata = { title: "차곡찬 개인정보 처리방침", robots: { index: false, follow: false } };
export default function PrivacyPage() {
  const info = publicInformation();
  return <PublicInformationLayout title="개인정보 처리방침"><NoticeDraft />
    <p>{info.operatorName ?? "차곡찬 운영자"}는 다음과 같은 내용으로 개인정보를 처리할 예정입니다. 정식 시행일과 최종 운영 정보는 공개 전에 확정해 안내합니다.</p>
    <h2>처리하는 정보와 목적</h2><ul><li>계정: Google 계정 식별자·이메일 및 인증 정보로 로그인과 계정 보호를 제공합니다. 제공자가 전달하는 세부 항목은 실제 로그인 설정 확인 후 확정합니다.</li><li>앱 이용: 계정 식별자, 닉네임·아바타, 만 19세 이상 확인 시각·정책 버전, 목표·칭찬 본문·태그·날짜, 연결·초대·공유 권한·소식·삭제 요청으로 기능을 제공합니다.</li><li>접속과 보안: 접속 시각·IP·브라우저 정보·최소 오류 및 접근 기록은 전송 처리, 장애 대응과 부정 사용 방지에 사용될 수 있습니다. 공급자별 실제 기록 범위와 보관 기간은 공개 전 확인합니다.</li></ul>
    <h2>개인 기록과 선택 공유</h2><p>개인 기록은 본인에게 제공합니다. 사용자가 공유 권한을 부여한 목표의 공유판에서는 상대에게 필요한 표시 정보와 본인이 남긴 칭찬만 제공합니다. 연결만으로 개인 목표나 기록을 공개하지 않습니다.</p>
    <h2>보관과 삭제</h2><p>계정 이용 중에는 기능 제공에 필요한 정보를 보관하며, 사용자의 삭제와 탈퇴 요청에 따라 정리합니다. 목표 휴지통은 {policy.lifecycle.goal_restore_window_days}일, 앱 내 소식은 {policy.lifecycle.notification_retention_days}일, 최소 운영·보안 로그의 정책상 보관 기준은 {policy.lifecycle.operational_log_retention_days}일입니다.</p>
    <p>계정 삭제 접수부터 제품 접근을 차단하고 본인 기록을 정리합니다. 다른 사람에게 보낸 칭찬은 본문·작성자 정보를 지운 뒤 상대 판의 개수에 반영된 결과만 제한적으로 유지하며, 이를 완전한 익명 정보라고 표현하지 않습니다. 해당 목표가 정리되면 함께 삭제합니다.</p>
    <p>백업에 남은 자료는 제한된 기간 후 만료 삭제하고, 장애 복원 시 최신 삭제 이력을 다시 적용합니다. 실제 백업·별도 삭제 이력의 보관 설정은 공개 전 검증해 이 문안에 확정합니다.</p>
    <h2>처리 위탁과 국외 처리</h2><p>Google 로그인, Supabase 인증·데이터 저장, Vercel 웹 호스팅을 준비하고 있습니다. 서울 저장 위치만으로 모든 정보가 국내에서만 처리된다는 의미는 아닙니다. 실제 수탁자·이전 국가·항목·목적·시기와 방법·보관 기간·권리 행사 방법을 확인해 공개 전에 최종 안내합니다.</p>
    <h2>필수 쿠키와 기기 저장</h2><p>로그인 유지와 요청 보호, 짧은 인증·초대 처리에 쿠키를 사용합니다. 쿠키를 차단하면 로그인 기능을 이용하기 어렵습니다. 설치 기능은 공개 정적 파일만 저장하도록 구성하며, 개인 기록과 인증 응답을 오프라인 캐시에 저장하지 않습니다.</p>
    <h2>권리 행사와 문의</h2><p>개인정보 열람·정정·삭제·처리정지와 관련한 요청은 <a href="/support">문의처</a>에서 접수하며 필요한 본인 확인 후 처리합니다. 계정 메뉴에서 직접 계정 삭제를 요청할 수도 있습니다.</p>
    {info.email && <p>개인정보 관련 연락처: <a href={`mailto:${info.email}`}>{info.email}</a></p>}
  </PublicInformationLayout>;
}
