import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shift Manager | シフト管理",
  description: "個別指導塾向けのシフト管理システム",
};

// #122: スマホ表示の土台。themeColor は primary (ネイビー #1b2a64 = hsl(228 57% 25%))。
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1b2a64",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
