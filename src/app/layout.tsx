import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GatherBite",
  description: "The AI agent that figures out how to feed your group — with deterministic verification before human approval.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
