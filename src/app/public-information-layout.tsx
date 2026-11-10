import type { ReactNode } from "react";

export default function PublicInformationLayout({ title, children }: { title: string; children: ReactNode }) {
  return <main className="public-shell"><a className="brand-lockup" href="/"><span className="brand-name">차곡찬</span></a>
    <nav className="public-nav" aria-label="서비스 안내"><a href="/about">소개</a><a href="/help">도움말</a><a href="/privacy">개인정보 처리방침</a><a href="/terms">이용 안내</a><a href="/support">문의</a></nav>
    <article className="content-card public-document" aria-labelledby="public-heading"><h1 id="public-heading">{title}</h1>{children}</article>
    <footer className="auth-footer"><a href="/">차곡찬으로 돌아가기</a></footer>
  </main>;
}

export function NoticeDraft() {
  return <aside className="notice-draft" aria-label="공개 준비 안내"><strong>공개 전 확인 중인 문안입니다.</strong><p>운영 연락처와 서비스의 개인정보 처리 내용을 확정한 뒤 정식 안내로 전환합니다.</p></aside>;
}
