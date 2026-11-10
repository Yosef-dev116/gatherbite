import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#d9531e",
      }}
    >
      <div style={{ width: 112, height: 112, display: "flex", position: "relative", borderRadius: "50%", background: "#fff8f1" }}>
        <span style={{ position: "absolute", width: 20, height: 20, borderRadius: "50%", background: "#d9531e", left: 27, top: 28 }} />
        <span style={{ position: "absolute", width: 20, height: 20, borderRadius: "50%", background: "#d9531e", right: 24, top: 33 }} />
        <span style={{ position: "absolute", width: 20, height: 20, borderRadius: "50%", background: "#d9531e", left: 47, bottom: 23 }} />
      </div>
    </div>,
    size,
  );
}
