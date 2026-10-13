import { ImageResponse } from "next/og";

export const alt = "GatherBite — verified group ordering";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Gives `metadataBase` in the root layout something to resolve: without an
 * Open Graph image, a shared GatherBite link renders as a text-only card.
 * The brand colours are read from the same values as `--accent` /
 * `--accent-foreground` so this card cannot drift from the app shell.
 */
export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        justifyContent: "center",
        gap: 32,
        padding: 96,
        background: "#b53c12",
        color: "#fff8f1",
      }}
    >
      <div style={{ width: 132, height: 132, display: "flex", position: "relative", borderRadius: "50%", background: "#fff8f1" }}>
        <span style={{ position: "absolute", width: 24, height: 24, borderRadius: "50%", background: "#b53c12", left: 31, top: 32 }} />
        <span style={{ position: "absolute", width: 24, height: 24, borderRadius: "50%", background: "#b53c12", right: 28, top: 39 }} />
        <span style={{ position: "absolute", width: 24, height: 24, borderRadius: "50%", background: "#b53c12", left: 55, bottom: 27 }} />
      </div>
      <div style={{ display: "flex", fontSize: 86, letterSpacing: -2 }}>GatherBite</div>
      <div style={{ display: "flex", fontSize: 38, lineHeight: 1.3, opacity: 0.92, maxWidth: 820 }}>
        Group food-order planning that fails closed when hard constraints cannot be verified.
      </div>
    </div>,
    size,
  );
}
