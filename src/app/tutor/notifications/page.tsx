import { requireRole } from "@/lib/auth";
import { getNotifications, type NotificationRow } from "@/lib/notifications";
import { MarkReadOnMount } from "./mark-read-on-mount";
import { NotificationList } from "./notification-list";
import { NotificationLoadError } from "./notification-load-error";

export default async function TutorNotificationsPage() {
  const { profile } = await requireRole("tutor");

  // #184: 取得失敗をページ全体のエラー画面にしない。error boundary が無いため
  // 従来は throw がそのまま 500 相当になり、hero もナビも表示できなかった
  // (2026-07-30 の migration 0029 未適用時に本番でこの経路を踏んでいた)。
  let items: NotificationRow[] | null = null;
  try {
    items = await getNotifications(profile.id);
  } catch (e) {
    console.error("getNotifications failed", e);
  }

  return (
    <div className="space-y-5">
      {/* 読み込めていない時に既読化すると、ユーザーが中身を見ないまま未読が
          消える (markAllRead は表示分でなく全件対象)。成功時のみ実行する */}
      {items !== null && <MarkReadOnMount />}

      {/* ネイビー hero (#130/#131 と統一) */}
      <section className="rounded-xl bg-primary p-4 text-primary-foreground">
        <h1 className="text-xl font-bold">通知</h1>
        <p className="mt-1 text-xs text-primary-foreground/80">
          申請の結果や確定シフトの公開をお知らせします。
        </p>
      </section>

      {items === null ? (
        <NotificationLoadError />
      ) : (
        <NotificationList items={items} />
      )}
    </div>
  );
}
