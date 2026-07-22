import Link from "next/link";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NotificationBell } from "@/components/notification-bell";
import { TutorBottomNav } from "@/components/tutor-bottom-nav";
import type { SessionProfile } from "@/lib/auth";

/**
 * 講師 (スマホ) 用シェル (#122)。
 * sticky ネイビーヘッダー + 単一カラム本文 + 固定下部タブ。モバイルファースト。
 *
 * 下部タブは TutorBottomNav (client) に分離 (#154)。タブ配下のサブナビ
 * (欠勤/交代/代講の切替) は IA (#120) / 各画面 (#133/#134) で整備する。
 */
export function TutorShell({
  profile,
  children,
}: {
  profile: SessionProfile;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-1 flex-col">
      <header className="sticky top-0 z-20 border-b bg-primary text-primary-foreground">
        <div className="flex items-center justify-between px-4 py-3">
          <Link href="/tutor" className="flex items-baseline gap-2">
            <span className="text-lg font-semibold">Shift Manager</span>
            <span className="text-xs text-primary-foreground/70">講師</span>
          </Link>
          <div className="flex items-center gap-2">
            <NotificationBell />
            <span className="max-w-[40vw] truncate text-sm text-primary-foreground/80">
              {profile.displayName}
            </span>
            <form action="/auth/signout" method="post">
              <Button
                type="submit"
                variant="ghost"
                size="icon"
                aria-label="ログアウト"
                className="size-8 text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
              >
                <LogOut className="size-4" />
              </Button>
            </form>
          </div>
        </div>
      </header>

      {/* 固定下部タブ分の余白: タブ実高 + セーフエリア (ホームインジケータ) を確保 */}
      <main className="mx-auto w-full max-w-screen-sm flex-1 p-4 pb-[calc(5rem+env(safe-area-inset-bottom))]">
        {children}
      </main>

      <TutorBottomNav />
    </div>
  );
}
