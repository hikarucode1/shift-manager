import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shift Manager | シフト管理",
  description: "個別指導塾向けのシフト管理システム",
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
