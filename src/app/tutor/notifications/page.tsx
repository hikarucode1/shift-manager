import { unstable_rethrow } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { getNotifications, type NotificationRow } from "@/lib/notifications";
import { MarkReadOnMount } from "./mark-read-on-mount";
import { NotificationList } from "./notification-list";
import { NotificationLoadError } from "./notification-load-error";

export default async function TutorNotificationsPage() {
  const { profile } = await requireRole("tutor");

  // #184: 取得失敗をページ全体の 500 にしない。
  // ⚠️ error.tsx (エラー境界) だけでは初回 SSR の Server Component 例外を
  // 捕捉できず、URL 直アクセスは素の 500 ドキュメントのままになる
  // (Next 16.2 で実測。2026-07-30 の本番障害はまさにこの経路だった)。
  // そのため「投げさせない」ここでの捕捉が初回ロード救済には必須で、
  // error.tsx は render 中の例外とクライアント遷移を受け持つ二段構え。
  let items: NotificationRow[] | null = null;
  try {
    items = await getNotifications(profile.id);
  } catch (e) {
    // redirect()/notFound() 等の制御フローを握り潰さない (認可 redirect を
    // 飲み込むと権限バイパスになりうる)。
    // ⚠️ digest 文字列を自前で見る判定ではなく必ず unstable_rethrow を使う。
    // drizzle は全クエリ例外を DrizzleQueryError で包むため、包まれた制御
    // フロー例外は表層に digest を持たず自前判定を素通りする。
    // unstable_rethrow は error.cause を再帰的に辿るのでこれを取りこぼさない
    // (PG の SQLSTATE を lib/db-errors.ts の pgErrorCode() で見るのと同じ話)。
    unstable_rethrow(e);
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
