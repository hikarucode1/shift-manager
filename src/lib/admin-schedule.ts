import "server-only";
import { and, asc, between, desc, eq, gte, isNotNull, lte } from "drizzle-orm";
import { db } from "@/db/client";
import {
  profiles,
  shiftAssignments,
  shiftUploads,
  students,
  weeklyShifts,
} from "@/db/schema";
import { getSlotMeta, slotNumbers } from "@/lib/slot-meta";
import { daysOfWeek, weekdayOf, type WeekRange } from "@/lib/week";

export type AdminCellStudent = { name: string; subject: string };

export type AdminCell = {
  tutorId: string;
  tutorName: string;
  seatNumber: string | null;
  isOverride: boolean;
  note: string | null;
  students: AdminCellStudent[];
};

export type AdminSlotRow = {
  slotNumber: number;
  label: string;
  startTime: string;
  endTime: string;
  /** date(YYYY-MM-DD) → そのコマに出勤する全講師セル */
  cellsByDate: Record<string, AdminCell[]>;
};

export type AdminDay = {
  date: string;
  weekday: ReturnType<typeof weekdayOf>["key"];
  weekdayLabel: string;
};

export type AdminUploadInfo = {
  originalFilename: string;
  uploadedByName: string;
  publishedAt: string | null;
  weekStart: string;
  weekEnd: string;
};

export type AdminWeekSchedule = {
  range: WeekRange;
  days: AdminDay[];
  slots: AdminSlotRow[];
  /** フィルター用: この週に出勤のある講師一覧 (名前順) */
  tutors: { id: string; name: string }[];
  published: boolean;
  upload: AdminUploadInfo | null;
  totalShiftCount: number;
};

/** 指定週をカバーする最新の公開済みアップロード情報 */
async function latestUpload(
  range: WeekRange,
): Promise<AdminUploadInfo | null> {
  const rows = await db
    .select({
      originalFilename: shiftUploads.originalFilename,
      uploadedByName: profiles.displayName,
      publishedAt: shiftUploads.publishedAt,
      weekStart: shiftUploads.weekStart,
      weekEnd: shiftUploads.weekEnd,
    })
    .from(shiftUploads)
    .innerJoin(profiles, eq(profiles.id, shiftUploads.uploadedBy))
    .where(
      and(
        isNotNull(shiftUploads.publishedAt),
        lte(shiftUploads.weekStart, range.end),
        gte(shiftUploads.weekEnd, range.start),
      ),
    )
    .orderBy(desc(shiftUploads.publishedAt))
    .limit(1);

  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    originalFilename: r.originalFilename,
    uploadedByName: r.uploadedByName,
    publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
    weekStart: r.weekStart,
    weekEnd: r.weekEnd,
  };
}

/**
 * 指定週の全講師の確定シフトを、コマ行 × 日付列のグリッド用に整形。
 *
 * weekly_shifts は再アップロードで週レンジ総入れ替えされるため
 * upload_id デデュープは不要。
 */
export async function getAdminWeekSchedule(
  range: WeekRange,
): Promise<AdminWeekSchedule> {
  const [slotMeta, upload, rows] = await Promise.all([
    getSlotMeta(),
    latestUpload(range),
    db
      .select({
        shiftId: weeklyShifts.id,
        date: weeklyShifts.date,
        slotNumber: weeklyShifts.slotNumber,
        seatNumber: weeklyShifts.seatNumber,
        isOverride: weeklyShifts.isOverride,
        note: weeklyShifts.note,
        tutorId: weeklyShifts.tutorId,
        tutorName: profiles.displayName,
        studentName: students.name,
        subject: shiftAssignments.subject,
        position: shiftAssignments.position,
      })
      .from(weeklyShifts)
      .innerJoin(profiles, eq(profiles.id, weeklyShifts.tutorId))
      .leftJoin(
        shiftAssignments,
        eq(shiftAssignments.weeklyShiftId, weeklyShifts.id),
      )
      .leftJoin(students, eq(students.id, shiftAssignments.studentId))
      .where(between(weeklyShifts.date, range.start, range.end))
      .orderBy(
        asc(weeklyShifts.slotNumber),
        asc(profiles.displayName),
        asc(weeklyShifts.date),
        asc(shiftAssignments.position),
      ),
  ]);

  // shiftId 単位でセルを組み立て
  const cellByShift = new Map<
    string,
    { date: string; slotNumber: number; cell: AdminCell }
  >();
  const tutorSet = new Map<string, string>(); // id → name

  for (const r of rows) {
    let entry = cellByShift.get(r.shiftId);
    if (!entry) {
      entry = {
        date: r.date,
        slotNumber: r.slotNumber,
        cell: {
          tutorId: r.tutorId,
          tutorName: r.tutorName,
          seatNumber: r.seatNumber,
          isOverride: r.isOverride,
          note: r.note,
          students: [],
        },
      };
      cellByShift.set(r.shiftId, entry);
      tutorSet.set(r.tutorId, r.tutorName);
    }
    if (r.studentName) {
      entry.cell.students.push({
        name: r.studentName,
        subject: r.subject ?? "",
      });
    }
  }

  // slot 行を全コマ分用意 (出勤ゼロのコマも行として出す)
  const numbers = slotNumbers(slotMeta);
  const slots: AdminSlotRow[] = numbers.map((n) => {
    const meta = slotMeta.get(n);
    return {
      slotNumber: n,
      label: meta?.label ?? `${n}限`,
      startTime: meta?.start ?? "",
      endTime: meta?.end ?? "",
      cellsByDate: {},
    };
  });
  const slotByNumber = new Map(slots.map((s) => [s.slotNumber, s]));

  for (const { date, slotNumber, cell } of cellByShift.values()) {
    let row = slotByNumber.get(slotNumber);
    if (!row) {
      // slot_definitions に無い slot 番号もデータがあれば行追加
      row = {
        slotNumber,
        label: `${slotNumber}限`,
        startTime: "",
        endTime: "",
        cellsByDate: {},
      };
      slots.push(row);
      slotByNumber.set(slotNumber, row);
    }
    (row.cellsByDate[date] ??= []).push(cell);
  }
  slots.sort((a, b) => a.slotNumber - b.slotNumber);

  // 各セルリストを講師名順で安定化
  for (const row of slots) {
    for (const date of Object.keys(row.cellsByDate)) {
      row.cellsByDate[date].sort((a, b) =>
        a.tutorName.localeCompare(b.tutorName, "ja"),
      );
    }
  }

  const days: AdminDay[] = daysOfWeek(range).map((date) => {
    const { key, label } = weekdayOf(date);
    return { date, weekday: key, weekdayLabel: label };
  });

  const tutors = [...tutorSet.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "ja"));

  return {
    range,
    days,
    slots,
    tutors,
    published: upload !== null,
    upload,
    totalShiftCount: cellByShift.size,
  };
}
