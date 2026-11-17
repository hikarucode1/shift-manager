import { hasRole, requireRole } from "@/lib/auth";
import { getNotifications } from "@/lib/notifications";
import { MarkReadOnMount } from "@/components/notifications/mark-read-on-mount";
import { NotificationList } from "@/components/notifications/notification-list";

/**
 * 教室長向けの通知一覧 (#344)。
 * 兼任 (教室長かつ講師) の人でも、ここには教室長向けの通知だけを出す。
 * 講師向けの通知は講師の画面 (/tutor/notifications) で見る。
 */
export default async function AdminNotificationsPage() {
  const { profile } = await requireRole("admin");

  // 取得の失敗は admin/error.tsx に流す (講師側の一覧と同じ方針。#186)
  const items = await getNotifications(profile.id, "admin");

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {/* 取得に失敗した場合はここへ到達しないので、中身を見ないまま
          未読が消えることはない */}
      <MarkReadOnMount audience="admin" />

      <div>
        <h1 className="text-2xl font-semibold">通知</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          シフトの提出や、代講の依頼への返事をお知らせします。
          {hasRole(profile, "tutor") &&
            " 講師としての通知 (申請の結果など) は講師の画面に出ます。"}
        </p>
      </div>

      <NotificationList items={items} />
    </div>
  );
}
