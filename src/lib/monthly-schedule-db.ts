import "server-only";
import { and, arrayContains, desc, eq, gte, isNotNull, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { monthlySchedules, profiles } from "@/db/schema";
import { insertNotifications } from "@/lib/notifications";
import { scheduleNotice } from "@/lib/monthly-schedule";

/**
 * 室長レビュー要望12: 月のスケジュール PDF の読み書き。
 * 一覧には PDF 本体 (content) を載せない (開くときだけ読む)。
 */

export type MonthlyScheduleRow = {
  /** YYYY-MM-01 */
  month: string;
  fileName: string;
  byteSize: number;
  updatedAt: Date;
};

const listColumns = {
  month: monthlySchedules.month,
  fileName: monthlySchedules.fileName,
  byteSize: monthlySchedules.byteSize,
  updatedAt: monthlySchedules.updatedAt,
};

/** 新しい月から。fromMonth を渡すとその月以降だけ */
export async function listMonthlySchedules(
  fromMonth?: string,
): Promise<MonthlyScheduleRow[]> {
  return db
    .select(listColumns)
    .from(monthlySchedules)
    .where(fromMonth ? gte(monthlySchedules.month, fromMonth) : undefined)
    .orderBy(desc(monthlySchedules.month));
}

/** その月のスケジュールがあるか (PDF の中身は読まない) */
export async function getMonthlyScheduleInfo(
  month: string,
): Promise<MonthlyScheduleRow | null> {
  const [row] = await db
    .select(listColumns)
    .from(monthlySchedules)
    .where(eq(monthlySchedules.month, month))
    .limit(1);
  return row ?? null;
}

export async function getMonthlySchedulePdf(
  month: string,
): Promise<{ fileName: string; content: Buffer } | null> {
  const [row] = await db
    .select({
      fileName: monthlySchedules.fileName,
      content: monthlySchedules.content,
    })
    .from(monthlySchedules)
    .where(eq(monthlySchedules.month, month))
    .limit(1);
  return row ?? null;
}

/**
 * 保存して (同じ月は置き換え)、講師全員に通知する。
 * 宛先はお知らせ (createAnnouncement) と同じ: ログインできる有効な講師で、
 * 上げた本人 (兼任の教室長) は除く。通知に失敗しても保存は取り消さない
 */
export async function saveMonthlySchedule(
  uploaderId: string,
  input: { month: string; fileName: string; content: Buffer },
): Promise<{ replaced: boolean; notified: number }> {
  const [existing] = await db
    .select({ month: monthlySchedules.month })
    .from(monthlySchedules)
    .where(eq(monthlySchedules.month, input.month))
    .limit(1);
  const values = {
    fileName: input.fileName,
    content: input.content,
    byteSize: input.content.byteLength,
    uploadedBy: uploaderId,
    updatedAt: new Date(),
  };
  await db
    .insert(monthlySchedules)
    .values({ month: input.month, ...values })
    .onConflictDoUpdate({ target: monthlySchedules.month, set: values });

  let notified = 0;
  try {
    const tutors = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(
        and(
          arrayContains(profiles.roles, ["tutor"]),
          eq(profiles.isActive, true),
          isNotNull(profiles.authUserId),
          ne(profiles.id, uploaderId),
        ),
      );
    notified = await insertNotifications(
      tutors.map((t) => t.id),
      { type: "monthly_schedule", ...scheduleNotice(input.month, !!existing) },
    );
  } catch (e) {
    console.error("monthly schedule notify failed", e);
  }
  return { replaced: !!existing, notified };
}

export async function deleteMonthlySchedule(month: string): Promise<void> {
  await db.delete(monthlySchedules).where(eq(monthlySchedules.month, month));
}
