import "server-only";
import { and, asc, between, eq, gte, isNotNull, lte } from "drizzle-orm";
import { db } from "@/db/client";
import {
  shiftAssignments,
  shiftUploads,
  students,
  weeklyShifts,
} from "@/db/schema";
import { getApprovedAbsenceKeys } from "@/lib/absences";
import { getSlotMeta } from "@/lib/slot-meta";
import { daysOfWeek, weekdayOf, type WeekRange } from "@/lib/week";

export type ScheduleStudent = { name: string; subject: string };

export type ScheduleSlot = {
  slotNumber: number;
  label: string;
  startTime: string;
  endTime: string;
  seatNumber: string | null;
  isOverride: boolean;
  note: string | null;
  /** 承認済みの欠勤申請があるコマ */
  isAbsent: boolean;
  students: ScheduleStudent[];
};

export type ScheduleDay = {
  date: string;
  weekday: ReturnType<typeof weekdayOf>["key"];
  weekdayLabel: string;
  slots: ScheduleSlot[];
};

export type WeekSchedule = {
  range: WeekRange;
  /** 月→日の 7 日。出勤が無い日も入る (slots: []) */
  days: ScheduleDay[];
  /** この週に教室長が確定シフトを公開済みか */
  published: boolean;
  /** この講師にこの週の出勤が 1 件でもあるか */
  hasAnyShift: boolean;
};

/** 指定週に公開済み (published_at あり) のアップロードが存在するか */
async function isWeekPublished(range: WeekRange): Promise<boolean> {
  const rows = await db
    .select({ id: shiftUploads.id })
    .from(shiftUploads)
    .where(
      and(
        isNotNull(shiftUploads.publishedAt),
        // upload の週レンジが対象週とオーバーラップ
        lte(shiftUploads.weekStart, range.end),
        gte(shiftUploads.weekEnd, range.start),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * 指定講師の、指定週の確定シフトを取得して日別に整形する。
 *
 * weekly_shifts は再アップロード時に週レンジ内が総入れ替えされるため、
 * upload_id でのデデュープは不要。
 */
export async function getTutorWeekSchedule(
  tutorId: string,
  range: WeekRange,
): Promise<WeekSchedule> {
  const [slotMeta, published, absentKeys, rows] = await Promise.all([
    getSlotMeta(),
    isWeekPublished(range),
    getApprovedAbsenceKeys(tutorId, range.start, range.end),
    db
      .select({
        shiftId: weeklyShifts.id,
        date: weeklyShifts.date,
        slotNumber: weeklyShifts.slotNumber,
        seatNumber: weeklyShifts.seatNumber,
        isOverride: weeklyShifts.isOverride,
        note: weeklyShifts.note,
        studentName: students.name,
        subject: shiftAssignments.subject,
        position: shiftAssignments.position,
      })
      .from(weeklyShifts)
      .leftJoin(
        shiftAssignments,
        eq(shiftAssignments.weeklyShiftId, weeklyShifts.id),
      )
      .leftJoin(students, eq(students.id, shiftAssignments.studentId))
      .where(
        and(
          eq(weeklyShifts.tutorId, tutorId),
          between(weeklyShifts.date, range.start, range.end),
        ),
      )
      .orderBy(
        asc(weeklyShifts.date),
        asc(weeklyShifts.slotNumber),
        asc(shiftAssignments.position),
      ),
  ]);

  // shiftId 単位でグルーピング (date は別管理にして ScheduleSlot に混ぜない)
  type Acc = { date: string; slot: ScheduleSlot };
  const accByShift = new Map<string, Acc>();
  for (const r of rows) {
    let acc = accByShift.get(r.shiftId);
    if (!acc) {
      const meta = slotMeta.get(r.slotNumber);
      acc = {
        date: r.date,
        slot: {
          slotNumber: r.slotNumber,
          label: meta?.label ?? `${r.slotNumber}限`,
          startTime: meta?.start ?? "",
          endTime: meta?.end ?? "",
          seatNumber: r.seatNumber,
          isOverride: r.isOverride,
          note: r.note,
          isAbsent: absentKeys.has(`${r.date}|${r.slotNumber}`),
          students: [],
        },
      };
      accByShift.set(r.shiftId, acc);
    }
    if (r.studentName) {
      acc.slot.students.push({
        name: r.studentName,
        subject: r.subject ?? "",
      });
    }
  }

  const byDate = new Map<string, ScheduleSlot[]>();
  for (const { date, slot } of accByShift.values()) {
    const list = byDate.get(date) ?? [];
    list.push(slot);
    byDate.set(date, list);
  }

  const days: ScheduleDay[] = daysOfWeek(range).map((date) => {
    const slots = (byDate.get(date) ?? []).sort(
      (a, b) => a.slotNumber - b.slotNumber,
    );
    const { key, label } = weekdayOf(date);
    return { date, weekday: key, weekdayLabel: label, slots };
  });

  return {
    range,
    days,
    published,
    hasAnyShift: accByShift.size > 0,
  };
}
