import { requireRole } from "@/lib/auth";
import { getNotifications } from "@/lib/notifications";
import { MarkReadOnMount } from "./mark-read-on-mount";
import { NotificationList } from "./notification-list";

export default async function TutorNotificationsPage() {
  const { profile } = await requireRole("tutor");

  // #184 で入れたページ内 try/catch は #186 で撤去した。当時は
  // 「error.tsx だけでは初回 SSR の例外を捕捉できない」ため各ページで
  // 投げさせない必要があったが、tutor/loading.tsx が Suspense 境界を
  // 作った今は初回ロードでも error.tsx に落ちる。
  //
  // 捕捉を残すと、この画面だけ他の講師画面と挙動がずれる:
  // 境界は「エラーID (digest)」を出すが自前の失敗表示は出せない。
  // 2026-07-30 の障害で実際に壊れたのがこの画面なので、問い合わせ時に
  // digest を読み上げられないのは一番痛い。境界に流して揃える。
  const items = await getNotifications(profile.id);

  return (
    <div className="space-y-5">
      {/* 取得に失敗した場合はここへ到達せず境界が出るので、既読化が
          「中身を見ないまま未読が消える」形で走ることはない
          (markAllRead は表示分でなく全件対象) */}
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
