import "server-only";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { notifications } from "@/db/schema";

export type NotificationType = "absence_result" | "swap_result" | "shifts_published";

export type NotificationInput = {
  type: NotificationType;
  title: string;
  body?: string;
  /** タップ時の遷移先 (アプリ内パス) */
  href?: string;
};

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
  const targets = [...new Set(recipientIds)];
  if (targets.length === 0) return;
  try {
    await db.insert(notifications).values(
      targets.map((recipientId) => ({
        recipientId,
        type: input.type,
        title: input.title,
        body: input.body,
        href: input.href,
      })),
    );
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

export type NotificationRow = {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  href: string | null;
  readAt: Date | null;
  createdAt: Date;
};

/** 新着順の一覧 */
export async function getNotifications(
  profileId: string,
  limit = 50,
): Promise<NotificationRow[]> {
  return db
    .select({
      id: notifications.id,
      type: notifications.type,
      title: notifications.title,
      body: notifications.body,
      href: notifications.href,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(eq(notifications.recipientId, profileId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

/** 指定 ID 群を既読化 (本人のもののみ) */
export async function markRead(
  profileId: string,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.recipientId, profileId),
        inArray(notifications.id, ids),
        isNull(notifications.readAt),
      ),
    );
}
