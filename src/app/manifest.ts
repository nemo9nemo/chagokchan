import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "차곡찬 · Chagokchan",
    short_name: "차곡찬",
    description: "작은 수고를 알아보고, 나에게 칭찬을 쌓는 공간.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f5f3eb",
    theme_color: "#f5f3eb",
    prefer_related_applications: false,
    icons: [
      { src: "/pwa-icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icons/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
