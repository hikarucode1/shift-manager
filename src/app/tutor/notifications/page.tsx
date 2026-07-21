import { requireRole } from "@/lib/auth";
import { getNotifications } from "@/lib/notifications";
import { MarkReadOnMount } from "./mark-read-on-mount";
import { NotificationList } from "./notification-list";

export default async function TutorNotificationsPage() {
  const { profile } = await requireRole("tutor");
  const items = await getNotifications(profile.id);

  return (
    <div className="space-y-5">
      <MarkReadOnMount />

      {/* ネイビー hero (#130/#131 と統一) */}
      <section className="rounded-xl bg-primary p-4 text-primary-foreground">
        <h1 className="text-xl font-bold">通知</h1>
        <p className="mt-1 text-xs text-primary-foreground/80">
          申請の結果や確定シフトの公開をお知らせします。
        </p>
      </section>

      <NotificationList items={items} />
    </div>
  );
}
