import "server-only";
import { and, asc, desc, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import { db } from "@/db/client";
import {
  absenceRequests,
  dayOffRequests,
  profiles,
  shiftUploads,
  weeklyShifts,
} from "@/db/schema";
import { findDayOffConflicts } from "@/lib/day-off-rule";
import { addDays, type WeekRange } from "@/lib/week";

/**
 * #360: 先の日の休み希望 (DB 側)。
 */

/** その日を含む週のシフトがもう公開されているか */
export async function isDatePublished(date: string): Promise<boolean> {
  const rows = await db
    .select({ id: shiftUploads.id })
    .from(shiftUploads)
    .where(
      and(
        isNotNull(shiftUploads.publishedAt),
        lte(shiftUploads.weekStart, date),
        gte(shiftUploads.weekEnd, date),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * 休み希望を出せる最初の日。明日か、公開済みのいちばん先の週の翌日の遅いほう。
 * (公開は週ごとに順に進むので、最後の公開週より後ならまだ出ていない)
 */
export async function firstDayOffDate(today: string): Promise<string> {
  const [latest] = await db
    .select({ weekEnd: shiftUploads.weekEnd })
    .from(shiftUploads)
    .where(isNotNull(shiftUploads.publishedAt))
    .orderBy(desc(shiftUploads.weekEnd))
    .limit(1);
  const tomorrow = addDays(today, 1);
  if (!latest) return tomorrow;
  const after = addDays(latest.weekEnd, 1);
  return after > tomorrow ? after : tomorrow;
}

export type TutorDayOff = {
  id: string;
  date: string;
  slotNumbers: number[];
  reason: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  decisionNote: string | null;
};

/** 講師の休み希望 (今日以降、日付順) */
export async function getTutorDayOffs(
  tutorId: string,
  today: string,
): Promise<TutorDayOff[]> {
  return db
    .select({
      id: dayOffRequests.id,
      date: dayOffRequests.date,
      slotNumbers: dayOffRequests.slotNumbers,
      reason: dayOffRequests.reason,
      status: dayOffRequests.status,
      decisionNote: dayOffRequests.decisionNote,
    })
    .from(dayOffRequests)
    .where(
      and(eq(dayOffRequests.tutorId, tutorId), gte(dayOffRequests.date, today)),
    )
    .orderBy(asc(dayOffRequests.date), asc(dayOffRequests.createdAt));
}

export type AdminDayOff = {
  id: string;
  tutorId: string;
  tutorName: string;
  date: string;
  slotNumbers: number[];
  reason: string;
  createdAt: Date;
};

const adminColumns = {
  id: dayOffRequests.id,
  tutorId: dayOffRequests.tutorId,
  tutorName: profiles.displayName,
  date: dayOffRequests.date,
  slotNumbers: dayOffRequests.slotNumbers,
  reason: dayOffRequests.reason,
  createdAt: dayOffRequests.createdAt,
};

/** 教室長の画面: 承認待ちの休み希望 (日付の近い順) */
export async function getPendingDayOffs(): Promise<AdminDayOff[]> {
  return db
    .select(adminColumns)
    .from(dayOffRequests)
    .innerJoin(profiles, eq(profiles.id, dayOffRequests.tutorId))
    .where(eq(dayOffRequests.status, "pending"))
    .orderBy(asc(dayOffRequests.date), asc(dayOffRequests.createdAt));
}

/** その週の承認済みの休み (週の表・シフト取り込みで教室長に見せる) */
export async function getApprovedDayOffs(
  range: WeekRange,
): Promise<AdminDayOff[]> {
  return db
    .select(adminColumns)
    .from(dayOffRequests)
    .innerJoin(profiles, eq(profiles.id, dayOffRequests.tutorId))
    .where(
      and(
        eq(dayOffRequests.status, "approved"),
        gte(dayOffRequests.date, range.start),
        lte(dayOffRequests.date, range.end),
      ),
    )
    .orderBy(asc(dayOffRequests.date), asc(profiles.displayName));
}

export type DayOffConflict = {
  tutorName: string;
  date: string;
  slotNumber: number;
};

/**
 * 承認済みの休みの日に入っているシフト。uploadId を渡すとその取り込み分だけ
 * (取り込み直後の警告)、省くとその週に今あるシフト全部
 */
export async function getDayOffConflicts(
  range: WeekRange,
  dayOffs: AdminDayOff[],
  uploadId?: string,
): Promise<DayOffConflict[]> {
  if (dayOffs.length === 0) return [];
  const shifts = await db
    .select({
      tutorId: weeklyShifts.tutorId,
      date: weeklyShifts.date,
      slotNumber: weeklyShifts.slotNumber,
    })
    .from(weeklyShifts)
    .where(
      and(
        gte(weeklyShifts.date, range.start),
        lte(weeklyShifts.date, range.end),
        inArray(
          weeklyShifts.tutorId,
          [...new Set(dayOffs.map((d) => d.tutorId))],
        ),
        uploadId ? eq(weeklyShifts.uploadId, uploadId) : undefined,
      ),
    )
    .orderBy(asc(weeklyShifts.date), asc(weeklyShifts.slotNumber));
  // 欠勤が承認済みのコマは、もう手当て済みなので警告しない
  const tutorIds = [...new Set(dayOffs.map((d) => d.tutorId))];
  const absent = await db
    .select({
      tutorId: absenceRequests.tutorId,
      date: absenceRequests.date,
      slotNumber: absenceRequests.slotNumber,
    })
    .from(absenceRequests)
    .where(
      and(
        eq(absenceRequests.status, "approved"),
        gte(absenceRequests.date, range.start),
        lte(absenceRequests.date, range.end),
        inArray(absenceRequests.tutorId, tutorIds),
      ),
    );
  const absentKeys = new Set(
    absent.map((a) => `${a.tutorId}|${a.date}|${a.slotNumber}`),
  );
  const names = new Map(dayOffs.map((d) => [d.tutorId, d.tutorName]));
  // 同じコマに座席違いで複数行あることがあるので、講師・日付・コマで 1 件にする
  const seen = new Set<string>();
  return findDayOffConflicts(dayOffs, shifts)
    .filter((s) => {
      const k = `${s.tutorId}|${s.date}|${s.slotNumber}`;
      if (seen.has(k) || absentKeys.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((s) => ({
      tutorName: names.get(s.tutorId) ?? "",
      date: s.date,
      slotNumber: s.slotNumber,
    }));
}
