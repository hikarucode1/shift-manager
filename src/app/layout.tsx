import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "eisai-manager | シフト管理",
  description: "英才個別学院 東武練馬校 シフト管理システム",
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
