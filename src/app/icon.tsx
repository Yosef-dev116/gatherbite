import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 112,
        background: "#d9531e",
      }}
    >
      <div style={{ width: 320, height: 320, display: "flex", position: "relative", borderRadius: "50%", background: "#fff8f1" }}>
        <span style={{ position: "absolute", width: 58, height: 58, borderRadius: "50%", background: "#d9531e", left: 76, top: 78 }} />
        <span style={{ position: "absolute", width: 58, height: 58, borderRadius: "50%", background: "#d9531e", right: 68, top: 94 }} />
        <span style={{ position: "absolute", width: 58, height: 58, borderRadius: "50%", background: "#d9531e", left: 133, bottom: 65 }} />
      </div>
    </div>,
    size,
  );
}
