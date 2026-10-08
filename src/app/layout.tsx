import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "차곡찬 · Chagokchan",
  description: "작은 수고를 알아보고, 나에게 칭찬을 쌓는 공간.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/pwa-icons/192", type: "image/png", sizes: "192x192" },
      { url: "/pwa-icons/512", type: "image/png", sizes: "512x512" },
    ],
    apple: "/pwa-icons/180",
  },
};
export const viewport: Viewport = { themeColor: "#f5f3eb" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
