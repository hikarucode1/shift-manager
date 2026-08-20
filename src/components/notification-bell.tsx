"use client";

import { useCallback, useEffect, useState } from "react";
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
 * ⚠️ **可視化とオンライン復帰で即時に取り直す**。これが無いと、電波が戻っても
 * 最大 60 秒 (画面ロックでタブが破棄されればさらに長く) 古い表示が残る。
 * 「出やすく消えにくい」が一番たちが悪いので、消える側を速くする。
 *
 * 状態の遷移は `lib/unread-badge.ts` に切り出してテストで固定してある
 * (ここは jsdom が無く描画テストできないため)。
 */
export function NotificationBell() {
  const pathname = usePathname();
  const [poll, setPoll] = useState<PollState>(INITIAL_POLL_STATE);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(() => {
    // action-failure: ok — ポーリングなので画面遷移させず、状態として畳む (#168)
    return getUnreadCountAction()
      .then((res) => {
        setPoll((prev) =>
          res.ok ? onPollSuccess(prev, res.count, Date.now()) : onPollFailure(prev),
        );
      })
      .catch(() => setPoll(onPollFailure))
      .finally(() => setNow(Date.now()));
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 60_000);

    // 画面に戻ってきた / 回線が戻ったら待たずに取り直す
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", refresh);

    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", refresh);
    };
  }, [refresh, pathname]);

  const badge = toBadgeState(poll, now);

  return (
    <Link
      href="/tutor/notifications"
      aria-label={
        badge.kind === "unknown"
          ? "通知 (未読数を取得できませんでした)"
          : badge.kind === "stale"
            ? `通知 (未読${badge.count}件・最新の状態を取得できていません)`
            : badge.count > 0
              ? `通知 (未読${badge.count}件)`
              : "通知"
      }
      className="relative flex size-8 items-center justify-center rounded-md text-primary-foreground hover:bg-primary-foreground/10"
    >
      <Bell className="size-4" />
      {badge.kind === "unknown" && (
        // ⚠️ 塗りつぶさない。muted トークンはネイビーのヘッダー上ではほぼ白で、
        // 実測 12.27:1 = 未読バッジ (accent, 4.87:1) の 2.5 倍目立つ。
        // 「何もしなくていい状態」が「今すぐ見て」より強くなる逆転を避ける。
        <span
          aria-hidden
          className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full border border-primary-foreground/60 px-1 text-[10px] font-bold text-primary-foreground/80"
        >
          !
        </span>
      )}
      {badge.kind === "stale" && (
        // 件数は残す (危険なのは下向きの嘘だけ)。淡色で「最新ではない」を示す
        <span
          aria-hidden
          className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent/50 px-1 text-[10px] font-bold text-accent-foreground/80"
        >
          {badge.count > 9 ? "9+" : badge.count}
        </span>
      )}
      {badge.kind === "count" && badge.count > 0 && (
        <span
          aria-hidden
          className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-accent-foreground"
        >
          {badge.count > 9 ? "9+" : badge.count}
        </span>
      )}
    </Link>
  );
}
