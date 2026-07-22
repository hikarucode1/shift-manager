import "server-only";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { notifications, notificationTypeEnum } from "@/db/schema";

/** DB enum (notification_type) から導出し、二重定義を避ける */
export type NotificationType = (typeof notificationTypeEnum.enumValues)[number];

export type NotificationInput = {
  type: NotificationType;
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
    .returning({ id: notifications.id });
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

/** 未読件数 */
export async function getUnreadCount(profileId: string): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(notifications)
    .where(
      and(
        eq(notifications.recipientId, profileId),
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
  limit = 50,
): Promise<NotificationRow[]> {
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.recipientId, profileId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

/**
 * 本人の未読を全件既読化する。
 * 一覧は最新 50 件しか表示しないため、表示分だけの既読化だと 50 件超の
 * 未読が残ったときバッジが永久に消せなくなる (PR #168 レビュー指摘)。
 */
export async function markAllRead(profileId: string): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.recipientId, profileId),
        isNull(notifications.readAt),
      ),
    );
}
