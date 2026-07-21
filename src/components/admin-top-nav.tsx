"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * 教室長 (PC) 用トップナビ (#122, #163)。
 * 共有レイアウトはクライアント遷移で再レンダリングされないため、active 判定は
 * サーバー側の pathname 受け渡しではなく usePathname() で行う
 * (TutorBottomNav / SegmentedNav と同方式)。
 *
 * #120: 11 項目 → 7 項目。グループは代表ページに着地し、各グループページ上部の
 * サブナビ (AdminTutorsNav / AdminPeriodsNav) で内訳を行き来する。
 */
const startsWithAny =
  (roots: string[]) =>
  (p: string | null): boolean =>
    roots.some((r) => p === r || (p?.startsWith(r + "/") ?? false));

const NAV: {
  href: string;
  label: string;
  /** active 判定 (グループ化したナビで複数ルートを束ねる場合に指定) */
  match?: (path: string | null) => boolean;
}[] = [
  {
    href: "/admin",
    label: "ダッシュボード",
    match: (p) => p === "/admin",
  },
  { href: "/admin/weekly", label: "週次シフト" },
  {
    href: "/admin/tutors",
    label: "講師管理",
    match: startsWithAny(["/admin/tutors", "/admin/admins"]),
  },
  {
    href: "/admin/periods",
    label: "期間管理",
    match: startsWithAny([
      "/admin/periods",
      "/admin/submission-periods",
      "/admin/regular-periods",
      "/admin/fixed-shifts",
    ]),
  },
  { href: "/admin/training", label: "講習希望" },
  { href: "/admin/uploads", label: "Excel取り込み" },
  { href: "/admin/requests", label: "申請承認" },
];

export function AdminTopNav() {
  const pathname = usePathname();
  return (
    <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-2 pb-2">
      {NAV.map((item) => {
        const active = item.match
          ? item.match(pathname)
          : pathname === item.href ||
            (pathname?.startsWith(item.href + "/") ?? false);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm whitespace-nowrap transition-colors",
              active
                ? "bg-primary-foreground/15 text-primary-foreground"
                : "text-primary-foreground/80 hover:bg-primary-foreground/10",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
