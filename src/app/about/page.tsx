import PublicInformationLayout from "../public-information-layout";
export const dynamic = "force-dynamic";
export const metadata = { title: "차곡찬 소개", robots: { index: false, follow: false } };
export default function AboutPage() {
  return <PublicInformationLayout title="작은 수고를 차곡차곡">
    <p>차곡찬은 목표를 정하고 나의 작은 수고를 칭찬으로 남기는 공간이에요. PC와 모바일 브라우저에서 이용하며, 앱 설치는 선택이에요.</p>
    <h2>나를 위한 기록</h2><p>목표마다 개인 칭찬판을 만들고 메모와 태그를 남겨요. 지난 회차도 다시 볼 수 있어요.</p>
    <h2>선택한 목표만 함께</h2><p>연결한 지인에게 원하는 목표의 공유판 권한을 따로 줄 수 있어요. 지인 연결만으로 목표나 개인 기록이 공개되지는 않아요.</p>
    <h2>칭찬 개수의 의미</h2><p>개인판과 공유판의 개수는 각각 관리해요. 칭찬 개수를 실제 목표 실천량으로 환산하지 않아요.</p>
    <p>초기 베타는 만 19세 이상 개인 사용자를 대상으로 하며 Google 로그인을 사용해요.</p>
    <p><a className="button" href="/">차곡찬 열기</a></p>
  </PublicInformationLayout>;
}
