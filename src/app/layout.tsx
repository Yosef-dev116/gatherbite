import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Night Shift Order",
  description: "Builds tonight's verified Little Caesars order for the PEI IT Alliance Night Shift.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
