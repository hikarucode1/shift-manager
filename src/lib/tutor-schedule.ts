import "server-only";
import { and, asc, between, eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  shiftAssignments,
  slotDefinitions,
  students,
  weeklyShifts,
} from "@/db/schema";
import { DEFAULT_SLOTS, WEEKDAYS, type Weekday } from "@/lib/shift-constants";
import { daysOfWeek, type WeekRange } from "@/lib/week";

export type ScheduleStudent = { name: string; subject: string };

export type ScheduleSlot = {
  slotNumber: number;
  label: string;
  startTime: string;
  endTime: string;
  seatNumber: string | null;
  isOverride: boolean;
  note: string | null;
  students: ScheduleStudent[];
};

export type ScheduleDay = {
  date: string;
  weekday: Weekday;
  weekdayLabel: string;
  slots: ScheduleSlot[];
};

export type WeekSchedule = {
  range: WeekRange;
  /** 月→日の 7 日。出勤が無い日も入る (slots: []) */
  days: ScheduleDay[];
  /** この週に1件でも確定シフトが存在するか (= 公開済みか) */
  hasAnyShift: boolean;
};

const WEEKDAY_BY_INDEX: Weekday[] = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
];

function weekdayOf(iso: string): Weekday {
  const dow = new Date(`${iso}T12:00:00.000Z`).getUTCDay();
  return WEEKDAY_BY_INDEX[dow];
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
  // コマ定義 (時間ラベル) を取得。無ければ既定値にフォールバック
  const slotRows = await db
    .select()
    .from(slotDefinitions)
    .where(eq(slotDefinitions.isActive, true))
    .orderBy(asc(slotDefinitions.slotNumber));

  const slotMeta = new Map<number, { label: string; start: string; end: string }>();
  if (slotRows.length > 0) {
    for (const s of slotRows) {
      slotMeta.set(s.slotNumber, {
        label: s.label,
        start: s.startTime,
        end: s.endTime,
      });
    }
  } else {
    for (const s of DEFAULT_SLOTS) {
      slotMeta.set(s.slotNumber, {
        label: s.label,
        start: s.startTime,
        end: s.endTime,
      });
    }
  }

  // シフト + 生徒割当 + 生徒名 を1クエリで
  const rows = await db
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
    );

  // shiftId 単位でグルーピング
  const slotByShift = new Map<string, ScheduleSlot & { date: string }>();
  for (const r of rows) {
    let slot = slotByShift.get(r.shiftId);
    if (!slot) {
      const meta = slotMeta.get(r.slotNumber);
      slot = {
        date: r.date,
        slotNumber: r.slotNumber,
        label: meta?.label ?? `${r.slotNumber}限`,
        startTime: meta?.start ?? "",
        endTime: meta?.end ?? "",
        seatNumber: r.seatNumber,
        isOverride: r.isOverride,
        note: r.note,
        students: [],
      };
      slotByShift.set(r.shiftId, slot);
    }
    if (r.studentName) {
      slot.students.push({
        name: r.studentName,
        subject: r.subject ?? "",
      });
    }
  }

  // 日付ごとに束ねる (出勤の無い日も空で出す)
  const byDate = new Map<string, ScheduleSlot[]>();
  for (const slot of slotByShift.values()) {
    const list = byDate.get(slot.date) ?? [];
    const { date: _omit, ...rest } = slot;
    void _omit;
    list.push(rest);
    byDate.set(slot.date, list);
  }

  const days: ScheduleDay[] = daysOfWeek(range).map((date) => {
    const slots = (byDate.get(date) ?? []).sort(
      (a, b) => a.slotNumber - b.slotNumber,
    );
    const weekday = weekdayOf(date);
    return {
      date,
      weekday,
      weekdayLabel: WEEKDAYS.find((w) => w.key === weekday)?.label ?? "",
      slots,
    };
  });

  return {
    range,
    days,
    hasAnyShift: slotByShift.size > 0,
  };
}
