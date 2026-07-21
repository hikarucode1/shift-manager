"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, ClipboardList, Home, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 講師 (スマホ) 用の固定下部タブ (#122, #154)。
 * 共有レイアウトはクライアント遷移で再レンダリングされないため、active 判定は
 * サーバー側の x-pathname ではなく usePathname() で行う (SegmentedNav と同方式)。
 *
 * 下部タブは 4 つ (デザイン準拠)。「申請」タブは欠勤/交代/代講をまとめた active
 * 範囲とし、ランディングは /tutor/absences。
 */
/** SegmentedNav と同じ境界付き prefix 判定 (/tutor/swaps-history 等の誤マッチを防ぐ) */
function underPath(pathname: string | null, href: string): boolean {
  return pathname === href || (pathname?.startsWith(href + "/") ?? false);
}

const TABS: {
  href: string;
  label: string;
  icon: typeof Home;
  /** active 判定 (pathname が当該タブ配下か) */
  match: (path: string | null) => boolean;
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
    match: (p) => underPath(p, "/tutor/fixed-shifts"),
  },
  {
    href: "/tutor/training",
    label: "希望提出",
    icon: ClipboardList,
    match: (p) => underPath(p, "/tutor/training"),
  },
  {
    href: "/tutor/absences",
    label: "申請",
    icon: Inbox,
    match: (p) =>
      ["/tutor/absences", "/tutor/swaps", "/tutor/open-swaps"].some((r) =>
        underPath(p, r),
      ),
  },
];

export function TutorBottomNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t bg-background pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex max-w-screen-sm">
        {TABS.map((tab) => {
          const active = tab.match(pathname);
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
  );
}
