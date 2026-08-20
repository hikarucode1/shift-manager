/**
 * 通知機能の生死を管理者に見せるための整形 (#191)。
 *
 * 2026-07-30 の障害 (migration 未適用で `notifications` テーブルが無く、
 * 通知が 9 日間動いていなかった) が長く気づかれなかった理由は 2 つあった:
 *
 * 1. ベル (`notification-bell.tsx`) が `.catch(() => {})` で失敗を握り潰し、
 *    **壊れていてもバッジが 0 のまま**で正常時と区別が付かなかった
 * 2. そもそも管理者は通知 UI を持っておらず、講師の報告を待つしかなかった
 *
 * ⚠️ **したがってこのモジュールの本体は「取得できない」を「0 件」と混ぜないこと**。
 * 数字を出すこと自体ではない。
 */

/** DB から取れた実測値 */
export type NotificationHealth = {
  /** 集計期間内に配信された件数 */
  recentCount: number;
  /** 最後に配信された時刻 (1 件も無ければ null) */
  latestAt: Date | null;
};

/** 画面に出す 3 状態 */
export type NotificationHealthView =
  | { state: "ok"; value: string; caption: string }
  | { state: "idle"; value: string; caption: string }
  | { state: "unavailable"; value: string; caption: string };

export const HEALTH_WINDOW_DAYS = 7;

function formatJst(at: Date): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
}

/**
 * 表示用に畳む。`health` が null = 取得できなかった。
 *
 * ⚠️ 取得できなかったときに `0` を返してはいけない。それをやると 2026-07-30 の
 * 「壊れているのにバッジが 0 で無症状」を別の場所で再現することになる。
 */
export function toHealthView(
  health: NotificationHealth | null,
  incidentId?: string,
): NotificationHealthView {
  if (health === null) {
    return {
      state: "unavailable",
      value: "取得不可",
      caption: incidentId ? `エラーID: ${incidentId}` : "通知を取得できません",
    };
  }

  const caption = health.latestAt
    ? `最終 ${formatJst(health.latestAt)}`
    : "最終 —";

  return {
    state: health.recentCount > 0 ? "ok" : "idle",
    value: `${health.recentCount}`,
    caption,
  };
}
