"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export type SegmentedNavItem = { href: string; label: string };

/**
 * セグメント型サブナビ (#120)。グループ化したトップナビ配下の関連ページ間を
 * 行き来する導線。muted 地に pill、active=白地+影。講師「申請」/ 管理者
 * 「講師管理」「期間管理」で共有する。
 */
export function SegmentedNav({ items }: { items: SegmentedNavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto rounded-lg bg-muted p-1">
      {items.map((it) => {
        const active =
          pathname === it.href || (pathname?.startsWith(it.href + "/") ?? false);
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex-1 whitespace-nowrap rounded-md px-3 py-1.5 text-center text-sm transition-colors",
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
