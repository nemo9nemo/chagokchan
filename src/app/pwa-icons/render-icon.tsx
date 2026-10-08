import { ImageResponse } from "next/og";

export function renderPwaIcon(size: number) {
  const leafWidth = Math.round(size * 0.1);
  const leafHeight = Math.round(size * 0.32);
  return new ImageResponse(
    <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#f5f3eb" }}>
      <div style={{ width: "76%", height: "76%", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: Math.round(size * 0.22), backgroundColor: "#fffefa" }}>
        <div style={{ display: "flex", alignItems: "center", gap: Math.round(size * 0.035) }}>
          <div style={{ width: leafWidth, height: leafHeight, borderRadius: leafWidth, backgroundColor: "#749579", transform: "rotate(-28deg)" }} />
          <div style={{ width: leafWidth, height: Math.round(size * 0.43), borderRadius: leafWidth, backgroundColor: "#dfa949", transform: "rotate(5deg)" }} />
          <div style={{ width: leafWidth, height: Math.round(size * 0.35), borderRadius: leafWidth, backgroundColor: "#aac3a3", transform: "rotate(28deg)" }} />
        </div>
      </div>
    </div>,
    {
      width: size,
      height: size,
      headers: { "Cache-Control": "public, max-age=31536000, immutable" },
    },
  );
}
