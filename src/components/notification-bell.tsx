"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Bell } from "lucide-react";
import { getUnreadCountAction } from "@/app/tutor/notifications/actions";
import {
  INITIAL_POLL_STATE,
  onPollFailure,
  onPollSuccess,
  toBadgeState,
  type PollState,
} from "@/lib/unread-badge";

/**
 * 通知ベル。未読数を 60 秒ごとにポーリングする。
 *
 * ⚠️ **取得できなかったことを「未読なし」として見せないこと** (#207)。
 * 以前は失敗を握り潰して前回値を維持していたが、マウント直後の前回値は 0 なので、
 * 開いた瞬間に失敗すればバッジが消え、正常時と区別が付かなかった。
 * 2026-07-30 の障害が 9 日間気づかれなかった理由の 1 つ目がこれ。
 *
 * 状態の遷移は `lib/unread-badge.ts` に切り出してテストで固定してある
 * (ここは jsdom が無く描画テストできないため)。
 */
export function NotificationBell() {
  const pathname = usePathname();
  const [poll, setPoll] = useState<PollState>(INITIAL_POLL_STATE);

  useEffect(() => {
    let alive = true;
    // action-failure: ok — ポーリングなので画面遷移させず、状態として畳む (#168)
    const refresh = () =>
      getUnreadCountAction()
        .then((res) => {
          if (!alive) return;
          setPoll((prev) =>
            res.ok ? onPollSuccess(prev, res.count) : onPollFailure(prev),
          );
        })
        .catch(() => {
          if (alive) setPoll(onPollFailure);
        });
    refresh();
    const t = setInterval(refresh, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [pathname]);

  const badge = toBadgeState(poll);
  const unknown = badge.kind === "unknown";
  const count = badge.kind === "count" ? badge.count : 0;

  return (
    <Link
      href="/tutor/notifications"
      aria-label={
        unknown
          ? "通知 (未読数を取得できませんでした)"
          : count > 0
            ? `通知 (未読${count}件)`
            : "通知"
      }
      className="relative flex size-8 items-center justify-center rounded-md text-primary-foreground hover:bg-primary-foreground/10"
    >
      <Bell className="size-4" />
      {unknown ? (
        // 未読バッジと同じ位置・同じ形。色だけ muted にして「未読あり」と
        // 取り違えられないようにする (警告色にしないのは、回線が不安定なだけの
        // 場面で頻繁に出ると「壊れている」と誤解されるため)。
        <span
          aria-hidden
          className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-1 text-[10px] font-bold text-muted-foreground"
        >
          !
        </span>
      ) : (
        count > 0 && (
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-accent-foreground"
          >
            {count > 9 ? "9+" : count}
          </span>
        )
      )}
    </Link>
  );
}
