import Link from "next/link";
import { CircleHelp, LogOut, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NotificationBell } from "@/components/notification-bell";
import { ContactLink } from "@/components/contact/contact-link";
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
          <Link href="/tutor" className="flex shrink-0 items-baseline gap-2 whitespace-nowrap">
            <span className="text-lg font-semibold">Shift Manager</span>
            {/* 360px 幅では入りきらないので「講師」を省く (#348 でマイページのボタンが増えた) */}
            <span className="text-xs text-primary-foreground/70 max-[380px]:hidden">講師</span>
          </Link>
          <div className="flex min-w-0 items-center gap-1.5">
            <NotificationBell audience="tutor" />
            {/* #320: お問い合わせ */}
            <ContactLink
              base="/tutor"
              ariaLabel="お問い合わせ"
              className="flex size-8 items-center justify-center rounded-md hover:bg-primary-foreground/10"
            >
              <CircleHelp className="size-5" />
            </ContactLink>
            {/* #348: 名前を押すとマイページ */}
            {/* 文字だけだと押せると気づきにくいので、アイコン付きのボタンの形にする */}
            <Link
              href="/tutor/me"
              aria-label={`マイページ (${profile.displayName})`}
              className="flex max-w-[40vw] items-center gap-1 rounded-full bg-primary-foreground/15 py-1 pl-1.5 pr-2.5 text-sm text-primary-foreground transition-colors hover:bg-primary-foreground/25"
            >
              <UserRound className="size-4 shrink-0" />
              <span className="truncate">{profile.displayName}</span>
            </Link>
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
