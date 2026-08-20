"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { getUnreadCountAction } from "@/app/tutor/notifications/actions";

/**
 * 講師ヘッダーの通知ベル + 未読バッジ (#155)。
 * 共有レイアウトはクライアント遷移で再レンダリングされないため (#154 と同根)、
 * 件数はサーバーから props で渡さず、画面遷移時 + 60 秒間隔で取り直す。
 */
export function NotificationBell() {
  const pathname = usePathname();
  const [count, setCount] = useState(0);

  useEffect(() => {
    let alive = true;
    const refresh = () =>
      // action-failure: ok — バッジはバックグラウンドのポーリングで、失敗しても
      // 前回値を保つ設計 (#191 で「バッジの 0 は生死の証拠にならない」と記録済み)。
      getUnreadCountAction()
        .then((n) => {
          if (alive) setCount(n);
        })
        .catch(() => {
          /* バッジは補助表示のため、取得失敗は無視して前回値を維持 */
        });
    refresh();
    const t = setInterval(refresh, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [pathname]);

  return (
    <Link
      href="/tutor/notifications"
      aria-label={count > 0 ? `通知 (未読${count}件)` : "通知"}
      className="relative flex size-8 items-center justify-center rounded-md text-primary-foreground hover:bg-primary-foreground/10"
    >
      <Bell className="size-4" />
      {count > 0 && (
        <span
          aria-hidden
          className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-accent-foreground"
        >
          {count > 9 ? "9+" : count}
        </span>
      )}
    </Link>
  );
}
