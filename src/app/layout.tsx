import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "차곡찬 · Chagokchan",
  description: "작은 수고를 알아보고, 나에게 칭찬을 쌓는 공간.",
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
