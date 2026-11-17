import "server-only";
import { and, arrayContains, count, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import type { NotificationHealth } from "@/lib/notification-health";
import { notifications, notificationTypeEnum, profiles } from "@/db/schema";
import type { Role } from "@/lib/auth";
import { sendPushToProfiles } from "@/lib/web-push";

/** DB enum (notification_type) から導出し、二重定義を避ける */
export type NotificationType = (typeof notificationTypeEnum.enumValues)[number];

/**
 * #344: どの画面のベルに出すか。兼任 (教室長かつ講師) の人は、講師の画面と
 * 教室長の画面で別々の通知を見る (既読も別々)
 */
export type NotificationAudience = Role;

export type NotificationInput = {
  type: NotificationType;
  /** 省略時は講師向け (#344 より前の通知はすべて講師向け) */
  audience?: NotificationAudience;
  title: string;
  body?: string;
  /** タップ時の遷移先 (アプリ内パス) */
  href?: string;
  /**
   * #155 review: 冪等化キー (例: 確定シフト公開の periodId)。指定すると
   * (宛先, 種別, dedupKey) が重複する行は onConflictDoNothing で挿入されない。
   * 未指定 (申請結果など各イベントが一意) は毎回挿入される。
   */
  dedupKey?: string;
};

/**
 * 通知を insert し、実際に挿入された件数を返す (失敗時は throw)。
 * dedupKey 指定時は (宛先, 種別, dedupKey) の重複をアトミックにスキップする。
 * 「通知を送ること自体が目的」のアクション (notifyCoursePublication 等) は
 * こちらを使い、失敗をユーザーに返すこと。
 */
export async function insertNotifications(
  recipientIds: string[],
  input: NotificationInput,
): Promise<number> {
  const targets = [...new Set(recipientIds)];
  if (targets.length === 0) return 0;
  const inserted = await db
    .insert(notifications)
    .values(
      targets.map((recipientId) => ({
        recipientId,
        type: input.type,
        audience: input.audience ?? "tutor",
        title: input.title,
        body: input.body,
        href: input.href,
        dedupKey: input.dedupKey ?? null,
      })),
    )
    // dedupKey NULL の行は unique index 上で distinct 扱いのため常に挿入される
    .onConflictDoNothing({
      target: [
        notifications.recipientId,
        notifications.type,
        notifications.dedupKey,
      ],
    })
    .returning({ recipientId: notifications.recipientId });
  // #318: ベルに出たものはスマホにも送る (講師宛て・教室長宛てのどちらも)。
  // dedupKey で弾かれた (既に送った) 分は inserted に入らないので二重に届かない。
  // sendPushToProfiles は throw しない
  await sendPushToProfiles(
    inserted.map((r) => r.recipientId),
    { title: input.title, body: input.body, href: input.href },
  );
  return inserted.length;
}

/**
 * アプリ内通知を作成する (Issue #155)。
 * 本処理 (承認・確定など) の action から fire-and-forget で呼ぶ前提のため、
 * 失敗しても throw せず console.error に留める。通知は結果整合で十分で、
 * 通知の失敗によって本処理を失敗させないこと。
 */
export async function notify(
  recipientIds: string[],
  input: NotificationInput,
): Promise<void> {
  try {
    await insertNotifications(recipientIds, input);
  } catch (e) {
    console.error("notify failed:", e);
  }
}

/**
 * #344: 有効な教室長全員に通知する (教室長向けのベルに出す)。
 * notify と同じく失敗しても throw しない (本処理を失敗させない)。
 */
export async function notifyAdmins(
  input: Omit<NotificationInput, "audience">,
  /** 兼任の教室長が自分で出した申請・提出は、本人には知らせない */
  opts: { exceptProfileId?: string } = {},
): Promise<void> {
  try {
    const admins = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(
        and(
          arrayContains(profiles.roles, ["admin"]),
          eq(profiles.isActive, true),
        ),
      );
    await insertNotifications(
      admins.map((a) => a.id).filter((id) => id !== opts.exceptProfileId),
      { ...input, audience: "admin" },
    );
  } catch (e) {
    console.error("notifyAdmins failed:", e);
  }
}

/** 未読件数 (その画面のベルに出す分だけ) */
export async function getUnreadCount(
  profileId: string,
  audience: NotificationAudience,
): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(notifications)
    .where(
      and(
        eq(notifications.recipientId, profileId),
        eq(notifications.audience, audience),
        isNull(notifications.readAt),
      ),
    );
  return rows[0]?.value ?? 0;
}

/** スキーマから導出し、カラムの二重定義を避ける (本人の行のみ返す前提) */
export type NotificationRow = typeof notifications.$inferSelect;

/** 新着順の一覧 */
export async function getNotifications(
  profileId: string,
  audience: NotificationAudience,
  limit = 50,
): Promise<NotificationRow[]> {
  return db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.recipientId, profileId),
        eq(notifications.audience, audience),
      ),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

/**
 * 本人の未読を全件既読化する。
 * 一覧は最新 50 件しか表示しないため、表示分だけの既読化だと 50 件超の
 * 未読が残ったときバッジが永久に消せなくなる (PR #168 レビュー指摘)。
 */
export async function markAllRead(
  profileId: string,
  audience: NotificationAudience,
): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.recipientId, profileId),
        // #344: 開いた画面の分だけ。講師の一覧を開いても教室長向けは未読のまま
        eq(notifications.audience, audience),
        isNull(notifications.readAt),
      ),
    );
}

/**
 * 通知機能の生死を測るための実測値 (#191)。
 *
 * ⚠️ **エラーを握り潰さないこと**。テーブルが無い / クエリが通らないことこそが
 * 見たい情報で、ここで 0 を返すと 2026-07-30 の「壊れているのにバッジが 0 で
 * 無症状」を再現する。呼び出し側 (admin ダッシュボード) が catch して
 * 「取得不可」として出す。
 */
export async function getNotificationHealth(
  windowDays: number,
): Promise<NotificationHealth> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  // ⚠️ **書き込み経路のスキーマをわざと踏む**。count(*) と max(created_at) だけだと
  // 「テーブルはあるが 0030 (dedup_key + unique index) や 0032 (enum に
  // swap_posted 追加) だけ未適用」のとき、insertNotifications は全滅するのに
  // このクエリは成功して緑になる。2026-07-30 と同じ症状を見逃すので、
  // insert 側が依存する列と enum 値をここで参照して道連れにする。
  // enum は notificationTypeEnum から生成するので、値が増えても自動で追従する。
  const typeProbe = sql.join(
    notificationTypeEnum.enumValues.map((v) => sql`${v}::notification_type`),
    sql`, `,
  );

  // ⚠️ `since` は ISO 文字列にして渡す (#313)。drizzle の postgres-js ドライバは
  // timestamp の serializer を外しており、列と比べるときだけ列の側で文字列にする。
  // 手書きの sql`` に Date をそのまま入れると、送信時に ERR_INVALID_ARG_TYPE で落ちる
  const rows = await db
    .select({
      recentCount: sql<number>`count(*) filter (where ${notifications.createdAt} >= ${since.toISOString()})::int`,
      // ⚠️ 手書きの式は列の変換を通らず、文字列のまま返る (#315)。列と同じ変換を
      // 指定して Date にする
      latestAt: sql`max(${notifications.createdAt})`.mapWith(
        notifications.createdAt,
      ),
      dedupKeyProbe: sql<number>`count(${notifications.dedupKey})::int`,
      // #344: 0046 (audience 列) が未適用なら insert が全滅するので、ここも踏む
      audienceProbe: sql<number>`count(${notifications.audience})::int`,
      typeProbe: sql<number>`count(*) filter (where ${notifications.type} = any(array[${typeProbe}]))::int`,
    })
    .from(notifications);

  const row = rows[0];
  // ⚠️ ここで 0 を返してはいけない。GROUP BY 無しの集約は必ず 1 行返るので
  // 到達しないはずだが、`?? 0` にしておくと将来クエリが育ったときに
  // 「例外の代わりに黙って 0」= この機能が防ぎたい形そのものへ倒れる。
  if (!row) throw new Error("notification health: no aggregate row");

  return { recentCount: row.recentCount, latestAt: row.latestAt };
}
