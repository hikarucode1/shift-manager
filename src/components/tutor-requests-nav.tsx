"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * 講師「申請」タブ配下のサブナビ (#122 review)。
 * 下部タブの「申請」は欠勤/交代/代講をまとめているが、タブ自体は /tutor/absences に
 * 着地するため、3 ページ間を行き来する導線をここで補う (旧 6 項目ナビの導線維持)。
 * #133/#134 で各画面を刷新する際、正式なサブナビ表現に差し替える前提の暫定版。
 */
const ITEMS = [
  { href: "/tutor/absences", label: "欠勤申請" },
  { href: "/tutor/swaps", label: "交代申請" },
  { href: "/tutor/open-swaps", label: "代講募集" },
];

export function TutorRequestsNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 rounded-lg bg-muted p-1">
      {ITEMS.map((it) => {
        const active =
          pathname === it.href || (pathname?.startsWith(it.href + "/") ?? false);
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex-1 rounded-md px-2 py-1.5 text-center text-sm transition-colors",
              active
                ? "bg-background font-medium text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
