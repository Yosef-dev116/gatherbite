import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://gatherbite-hackathon-final.vercel.app"),
  title: {
    default: "GatherBite — Verified group ordering",
    template: "%s · GatherBite",
  },
  description: "Plan a group food order with live restaurant data, independent constraint checks, and a human decision at checkout.",
  applicationName: "GatherBite",
  category: "food",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "GatherBite",
  },
  formatDetection: { telephone: false },
  openGraph: {
    type: "website",
    siteName: "GatherBite",
    title: "GatherBite — Verified group ordering",
    description: "Group food-order planning that fails closed when hard constraints cannot be verified.",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#b53c12",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
