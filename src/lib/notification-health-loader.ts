import "server-only";
import { getNotificationHealth } from "@/lib/notifications";
import {
  HEALTH_WINDOW_DAYS,
  toHealthView,
  type NotificationHealthView,
} from "@/lib/notification-health";
import { resolveOrIncident } from "@/lib/shell-guard";

/**
 * 通知の健全性を取得し、失敗を「取得不可」に畳む (#191)。
 *
 * ⚠️ **page.tsx に try/catch を書かずここに置く**。`shell-guard.ts` の docstring が
 * 「呼び出し側に散らすとテストできず、誰かが `unstable_rethrow` を消しても CI で
 * 落ちない」と書いているのと同じ理由で、**握り潰しの形をテストで固定するため**。
 * この機能で一番守りたいのは「失敗を 0 件として出さない」ことなので、その分岐が
 * テストの外にあると意味がない。
 *
 * ⚠️ 捕捉に `resolveOrIncident` を使うのも同じ規約に乗るため。素の try/catch だと、
 * 将来ここが `redirect()` を含む何かを呼ぶようになったとき、制御フロー例外を
 * 「取得不可」カードに化けさせて無症状にする。
 */
export async function loadNotificationHealth(): Promise<NotificationHealthView> {
  const resolved = await resolveOrIncident("admin-notification-health", () =>
    getNotificationHealth(HEALTH_WINDOW_DAYS),
  );

  return resolved.ok
    ? toHealthView(resolved.value)
    : toHealthView(null, resolved.incidentId);
}
