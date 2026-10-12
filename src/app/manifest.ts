import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GatherBite",
    short_name: "GatherBite",
    description: "Verified group food-order planning with a human decision at checkout.",
    start_url: "/",
    display: "standalone",
    background_color: "#faf6ee",
    theme_color: "#d9531e",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
