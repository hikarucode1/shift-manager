import "server-only";
import {
  and,
  asc,
  between,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lte,
} from "drizzle-orm";
import { db } from "@/db/client";
import {
  profiles,
  shiftAssignments,
  shiftUploads,
  students,
  weeklyShifts,
} from "@/db/schema";
import { getApprovedAbsenceKeysAll } from "@/lib/absences";
import { getSlotMeta, slotNumbers } from "@/lib/slot-meta";
import { daysOfWeek, weekdayOf, type WeekRange } from "@/lib/week";

export type AdminCellStudent = { name: string; subject: string };

export type AdminCell = {
  tutorId: string;
  tutorName: string;
  seatNumber: string | null;
  isOverride: boolean;
  /** 承認済み欠勤があるコマ */
  isAbsent: boolean;
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
  /** うち承認済み欠勤のコマ数 */
  absentShiftCount: number;
};

type UploadRow = {
  originalFilename: string;
  uploadedByName: string;
  publishedAt: Date | null;
  weekStart: string;
  weekEnd: string;
};

function toUploadInfo(r: UploadRow): AdminUploadInfo {
  return {
    originalFilename: r.originalFilename,
    uploadedByName: r.uploadedByName,
    publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
    weekStart: r.weekStart,
    weekEnd: r.weekEnd,
  };
}

const UPLOAD_COLUMNS = {
  originalFilename: shiftUploads.originalFilename,
  uploadedByName: profiles.displayName,
  publishedAt: shiftUploads.publishedAt,
  weekStart: shiftUploads.weekStart,
  weekEnd: shiftUploads.weekEnd,
} as const;

/**
 * 実際に表示している weekly_shifts が属する upload を取得 (バナーとデータの整合保証)。
 * 複数 upload が混在する場合は publishedAt が最新のものを採用。
 */
async function uploadOfShownShifts(
  uploadIds: string[],
): Promise<AdminUploadInfo | null> {
  if (uploadIds.length === 0) return null;
  const rows = await db
    .select(UPLOAD_COLUMNS)
    .from(shiftUploads)
    .innerJoin(profiles, eq(profiles.id, shiftUploads.uploadedBy))
    .where(inArray(shiftUploads.id, uploadIds))
    .orderBy(desc(shiftUploads.publishedAt))
    .limit(1);
  return rows.length > 0 ? toUploadInfo(rows[0]) : null;
}

/**
 * 表示シフトが無い週でも「公開済みだが空」を判定するための、
 * 週レンジに重なる最新の公開済み upload (フォールバック用)。
 */
async function coveringPublishedUpload(
  range: WeekRange,
): Promise<AdminUploadInfo | null> {
  const rows = await db
    .select(UPLOAD_COLUMNS)
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
  return rows.length > 0 ? toUploadInfo(rows[0]) : null;
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
  const [slotMeta, absentKeys, rows] = await Promise.all([
    getSlotMeta(),
    getApprovedAbsenceKeysAll(range.start, range.end),
    db
      .select({
        shiftId: weeklyShifts.id,
        uploadId: weeklyShifts.uploadId,
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

  // 表示シフトが属する upload からバナー情報を引く (データと整合)。
  // シフトが無ければ「公開済みだが空」判定のため週レンジ重なりで補完。
  const shownUploadIds = [...new Set(rows.map((r) => r.uploadId))];
  const upload =
    shownUploadIds.length > 0
      ? await uploadOfShownShifts(shownUploadIds)
      : await coveringPublishedUpload(range);

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
          isAbsent: absentKeys.has(
            `${r.tutorId}|${r.date}|${r.slotNumber}`,
          ),
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

  // 各セルリストを講師名順で安定化。
  // localeCompare(_, "ja") は full-ICU 前提 (Node 22 / Vercel は同梱)。
  // small-ICU 環境ではコードポイント順にフォールバックする。
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

  let absentShiftCount = 0;
  for (const e of cellByShift.values()) {
    if (e.cell.isAbsent) absentShiftCount++;
  }

  return {
    range,
    days,
    slots,
    tutors,
    published: upload !== null,
    upload,
    totalShiftCount: cellByShift.size,
    absentShiftCount,
  };
}
