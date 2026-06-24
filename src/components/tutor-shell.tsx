import Link from "next/link";
import {
  CalendarDays,
  ClipboardList,
  Home,
  Inbox,
  LogOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SessionProfile } from "@/lib/auth";

/**
 * 講師 (スマホ) 用シェル (#122)。
 * sticky ネイビーヘッダー + 単一カラム本文 + 固定下部タブ。モバイルファースト。
 *
 * 下部タブは 4 つ (デザイン準拠)。「申請」タブは欠勤/交代/代講をまとめた active
 * 範囲とし、ランディングは /tutor/absences。タブ配下のサブナビ (欠勤/交代/代講の
 * 切替) は IA (#120) / 各画面 (#133/#134) で整備する。
 */
const TABS: {
  href: string;
  label: string;
  icon: typeof Home;
  /** active 判定 (currentPath が当該タブ配下か) */
  match: (path: string | undefined) => boolean;
}[] = [
  {
    href: "/tutor",
    label: "ホーム",
    icon: Home,
    match: (p) => p === "/tutor",
  },
  {
    href: "/tutor/fixed-shifts",
    label: "シフト",
    icon: CalendarDays,
    match: (p) => p?.startsWith("/tutor/fixed-shifts") ?? false,
  },
  {
    href: "/tutor/training",
    label: "希望提出",
    icon: ClipboardList,
    match: (p) => p?.startsWith("/tutor/training") ?? false,
  },
  {
    href: "/tutor/absences",
    label: "申請",
    icon: Inbox,
    match: (p) =>
      ["/tutor/absences", "/tutor/swaps", "/tutor/open-swaps"].some(
        (r) => p?.startsWith(r) ?? false,
      ),
  },
];

export function TutorShell({
  profile,
  currentPath,
  children,
}: {
  profile: SessionProfile;
  currentPath?: string;
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

      {/* pb-20 で固定下部タブ分の余白を確保 */}
      <main className="mx-auto w-full max-w-screen-sm flex-1 p-4 pb-20">
        {children}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t bg-background pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-screen-sm">
          {TABS.map((tab) => {
            const active = tab.match(currentPath);
            const Icon = tab.icon;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] transition-colors",
                  active
                    ? "font-medium text-accent"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-5" />
                {tab.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
