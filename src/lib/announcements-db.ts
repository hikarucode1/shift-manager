import "server-only";
import {
  and,
  arrayContains,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
} from "drizzle-orm";
import { db } from "@/db/client";
import {
  announcementRecipients,
  announcements,
  notifications,
  profiles,
} from "@/db/schema";
import { announcementPreview } from "@/lib/announcement";
import { notify } from "@/lib/notifications";

/** 講師がお知らせを見る画面 (ベル・スマホ通知のタップ先) */
export const TUTOR_ANNOUNCEMENTS_PATH = "/tutor/announcements";

/**
 * お知らせを作り、送った時点の在籍講師全員に届ける。
 *
 * - 宛先は「有効 (is_active) でログインできる (auth 連携済み) 講師」。CSV で
 *   取り込んだだけでまだログインできない講師は、確認しようがないので含めない
 * - 出した教室長が講師を兼任していても、本人には届けない
 * - お知らせと宛先は 1 transaction で作る。ベル・スマホ通知はその後に送り、
 *   失敗してもお知らせ自体は残す (講師はホームの「未確認のお知らせ」で気づける)
 */
export async function createAnnouncement(
  senderId: string,
  input: { title: string; body: string },
): Promise<{ id: string; recipientCount: number }> {
  const { id, recipientIds } = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(announcements)
      .values({ title: input.title, body: input.body, createdBy: senderId })
      .returning({ id: announcements.id });
    const tutors = await tx
      .select({ id: profiles.id })
      .from(profiles)
      .where(
        and(
          arrayContains(profiles.roles, ["tutor"]),
          eq(profiles.isActive, true),
          isNotNull(profiles.authUserId),
          ne(profiles.id, senderId),
        ),
      );
    if (tutors.length > 0) {
      await tx
        .insert(announcementRecipients)
        .values(tutors.map((t) => ({ announcementId: row.id, tutorId: t.id })));
    }
    return { id: row.id, recipientIds: tutors.map((t) => t.id) };
  });

  await notify(recipientIds, {
    type: "announcement",
    title: `お知らせ: ${input.title}`,
    body: announcementPreview(input.body),
    href: TUTOR_ANNOUNCEMENTS_PATH,
    // 取り消したときにベルからも消すための目印
    dedupKey: id,
  });

  return { id, recipientCount: recipientIds.length };
}

/**
 * お知らせを取り消す (送り間違いの直し用)。宛先の行は cascade で消え、
 * 講師のベルに出ていた通知も消す。スマホに届いた通知は消せない
 */
export async function deleteAnnouncement(id: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const deleted = await tx
      .delete(announcements)
      .where(eq(announcements.id, id))
      .returning({ id: announcements.id });
    if (deleted.length === 0) return false;
    await tx
      .delete(notifications)
      .where(
        and(
          eq(notifications.type, "announcement"),
          eq(notifications.dedupKey, id),
        ),
      );
    return true;
  });
}

export type AdminAnnouncement = {
  id: string;
  title: string;
  body: string;
  createdAt: Date;
  senderName: string | null;
  recipientCount: number;
  confirmedCount: number;
  /** まだ確認していない講師 (名前順) */
  unconfirmed: { id: string; name: string }[];
};

/** 教室長の一覧: 新しい順に、確認した人数とまだの人 */
export async function getAdminAnnouncements(
  limit = 30,
): Promise<AdminAnnouncement[]> {
  const rows = await db
    .select({
      id: announcements.id,
      title: announcements.title,
      body: announcements.body,
      createdAt: announcements.createdAt,
      senderName: profiles.displayName,
    })
    .from(announcements)
    .leftJoin(profiles, eq(profiles.id, announcements.createdBy))
    .orderBy(desc(announcements.createdAt))
    .limit(limit);
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const recipients = await db
    .select({
      announcementId: announcementRecipients.announcementId,
      tutorId: announcementRecipients.tutorId,
      name: profiles.displayName,
      confirmedAt: announcementRecipients.confirmedAt,
    })
    .from(announcementRecipients)
    .innerJoin(profiles, eq(profiles.id, announcementRecipients.tutorId))
    .where(inArray(announcementRecipients.announcementId, ids))
    .orderBy(asc(profiles.displayName));

  return rows.map((r) => {
    const mine = recipients.filter((x) => x.announcementId === r.id);
    return {
      ...r,
      recipientCount: mine.length,
      confirmedCount: mine.filter((x) => x.confirmedAt).length,
      unconfirmed: mine
        .filter((x) => !x.confirmedAt)
        .map((x) => ({ id: x.tutorId, name: x.name })),
    };
  });
}

export type TutorAnnouncement = {
  id: string;
  title: string;
  body: string;
  createdAt: Date;
  confirmedAt: Date | null;
};

/** 講師の一覧: 自分宛てのお知らせを新しい順に */
export async function getTutorAnnouncements(
  tutorId: string,
  limit = 30,
): Promise<TutorAnnouncement[]> {
  return db
    .select({
      id: announcements.id,
      title: announcements.title,
      body: announcements.body,
      createdAt: announcements.createdAt,
      confirmedAt: announcementRecipients.confirmedAt,
    })
    .from(announcementRecipients)
    .innerJoin(
      announcements,
      eq(announcements.id, announcementRecipients.announcementId),
    )
    .where(eq(announcementRecipients.tutorId, tutorId))
    .orderBy(desc(announcements.createdAt))
    .limit(limit);
}

/** 講師ホームの案内用: まだ確認していないお知らせの数 */
export async function countUnconfirmedAnnouncements(
  tutorId: string,
): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(announcementRecipients)
    .where(
      and(
        eq(announcementRecipients.tutorId, tutorId),
        isNull(announcementRecipients.confirmedAt),
      ),
    );
  return row?.value ?? 0;
}

/**
 * 講師が「確認しました」を押す。自分宛てでなければ false。
 * 2 回押しても最初の時刻を残す
 */
export async function confirmAnnouncement(
  tutorId: string,
  announcementId: string,
): Promise<boolean> {
  const [mine] = await db
    .select({ confirmedAt: announcementRecipients.confirmedAt })
    .from(announcementRecipients)
    .where(
      and(
        eq(announcementRecipients.tutorId, tutorId),
        eq(announcementRecipients.announcementId, announcementId),
      ),
    )
    .limit(1);
  if (!mine) return false;
  if (mine.confirmedAt) return true;
  await db
    .update(announcementRecipients)
    .set({ confirmedAt: new Date() })
    .where(
      and(
        eq(announcementRecipients.tutorId, tutorId),
        eq(announcementRecipients.announcementId, announcementId),
        isNull(announcementRecipients.confirmedAt),
      ),
    );
  return true;
}
