import "server-only";
import {
  and,
  between,
  count,
  desc,
  eq,
  gte,
  isNull,
  lte,
  ne,
  or,
} from "drizzle-orm";
import { db } from "@/db/client";
import {
  fixedShiftSubmissions,
  regularShiftPeriods,
  shiftConfirmations,
} from "@/db/schema";
import {
  getActiveTrainingPeriods,
  getTrainingSubmissionStatuses,
} from "@/lib/training";
import {
  getTutorWeekSchedule,
  type ScheduleSlot,
  type WeekSchedule,
} from "@/lib/tutor-schedule";
import { homeWeekOf, jstToday, nextWeek } from "@/lib/week";

const DAY_MS = 86_400_000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** Date を JST カレンダー日の 0:00 (UTC ms) にする (computeEditable と同じ粒度) */
function jstDayStartMs(d: Date): number {
  const jst = new Date(d.getTime() + JST_OFFSET_MS);
  jst.setUTCHours(0, 0, 0, 0);
  return jst.getTime() - JST_OFFSET_MS;
}

/** 締切日 (JST 暦日) までの残り日数。負なら超過 */
function daysLeftUntil(due: Date, now = new Date()): number {
  return Math.round((jstDayStartMs(due) - jstDayStartMs(now)) / DAY_MS);
}

/** "YYYY-MM-DD" の翌日 (正午 UTC 基準で DST 無関係) */
function addDayIso(iso: string): string {
  return new Date(new Date(`${iso}T12:00:00.000Z`).getTime() + DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** ISO(UTC) → "M/D HH:mm" (JST) */
function fmtDeadline(iso: string): string {
  const jst = new Date(new Date(iso).getTime() + JST_OFFSET_MS);
  const m = jst.getUTCMonth() + 1;
  const d = jst.getUTCDate();
  const hh = String(jst.getUTCHours()).padStart(2, "0");
  const mm = String(jst.getUTCMinutes()).padStart(2, "0");
  return `${m}/${d} ${hh}:${mm}`;
}

/** 現在の JST 時刻 "HH:MM" (slot.endTime と辞書順比較するため 0 埋め) */
function nowHmJst(now = new Date()): string {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  const hh = String(jst.getUTCHours()).padStart(2, "0");
  const mm = String(jst.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export type HomeNextShift = {
  date: string;
  weekdayLabel: string;
  isToday: boolean;
  isTomorrow: boolean;
  slot: ScheduleSlot;
};

export type HomeShiftRow = {
  date: string;
  weekdayLabel: string;
  /** #336: コマごとに、担当する生徒 (座席表 CSV の割り当て) も出す */
  slots: Pick<ScheduleSlot, "slotNumber" | "label" | "isTraining" | "students">[];
  status: "confirmed" | "absent";
};

export type HomeDeadline = {
  kind: "training" | "regular";
  /** 例: "夏期講習のシフト提出" */
  label: string;
  href: string;
  /** 例: "6/25 23:59" */
  dueLabel: string;
  daysLeft: number;
  submitted: boolean;
};

export type TutorHomeData = {
  /** 今週の確定コマ数 (欠勤を除く) */
  weekSlotCount: number;
  weekPublished: boolean;
  /** 「今週」の期間 (月〜日)。画面に期間を添えるため (#337) */
  weekRange: { start: string; end: string };
  /** #317: 「今週」のシフトを確認した時刻 (ISO)。未確認なら null */
  weekConfirmedAt: string | null;
  nextShift: HomeNextShift | null;
  weekRows: HomeShiftRow[];
  /** 編集可能な提出締切 (残り日数の近い順) */
  deadlines: HomeDeadline[];
};

/**
 * 1 週間分の予定から、ホームの「シフト」一覧の行と確定コマ数を作る。
 * 欠勤だけの日は「欠勤」の行、確定コマがある日は欠勤コマを除いた番号だけ出す
 */
function buildWeekRows(week: WeekSchedule): {
  rows: HomeShiftRow[];
  slotCount: number;
} {
  const rows: HomeShiftRow[] = [];
  let slotCount = 0;
  for (const d of week.days) {
    if (d.slots.length === 0) continue;
    const liveSlots = d.slots.filter((s) => !s.isAbsent);
    // 室長レビュー要望9 (本人): 未定のコマ (生徒も研修も体験も無い) は
    // 出勤が決まっていないので数えない
    slotCount += liveSlots.filter(
      (s) => s.isTraining || s.students.length > 0,
    ).length;
    const confirmed = liveSlots.length > 0;
    rows.push({
      date: d.date,
      weekdayLabel: d.weekdayLabel,
      // 確定行は欠勤コマを除いた番号のみ (混在日でも欠勤を確定として見せない)
      slots: (confirmed ? liveSlots : d.slots).map((s) => ({
        slotNumber: s.slotNumber,
        label: s.label,
        isTraining: s.isTraining,
        students: s.students,
      })),
      status: confirmed ? "confirmed" : "absent",
    });
  }
  return { rows, slotCount };
}

/** 室長レビュー要望8: ホームで「来週以降」を何週先まで見られるか */
export const MAX_WEEK_OFFSET = 8;

export type TutorWeekView = {
  /** 0 = 今週、1 = 来週 … */
  offset: number;
  range: { start: string; end: string };
  published: boolean;
  rows: HomeShiftRow[];
  slotCount: number;
};

/**
 * 室長レビュー要望8: 講師が来週以降のシフトも見られるように、
 * 「今週」から offset 週先の 1 週間分を返す
 */
export async function getTutorWeekView(
  tutorId: string,
  offset: number,
): Promise<TutorWeekView> {
  let range = homeWeekOf(jstToday());
  for (let i = 0; i < offset; i++) range = nextWeek(range);
  const week = await getTutorWeekSchedule(tutorId, range);
  const { rows, slotCount } = buildWeekRows(week);
  return { offset, range, published: week.published, rows, slotCount };
}

/**
 * 講師ホーム (#130) の集約データ。確定シフト (今週/翌週) と、提出締切 (講習 +
 * レギュラー) を 1 回でまとめて取得する。表示専用 (Server Component)。
 */
export async function getTutorHomeData(tutorId: string): Promise<TutorHomeData> {
  const today = jstToday();
  const tomorrow = addDayIso(today);
  const now = new Date();
  const nowHm = nowHmJst(now);
  // #337: 日曜は翌日からの週を「今週」にする
  const thisRange = homeWeekOf(today);
  const nextRange = nextWeek(thisRange);

  const [thisWeek, nextWk, trainingPeriods, regularRows, confirmation] =
    await Promise.all([
    getTutorWeekSchedule(tutorId, thisRange),
    getTutorWeekSchedule(tutorId, nextRange),
    getActiveTrainingPeriods(),
    // 現在受付中のレギュラー期 (1 件、直近)
    db
      .select({
        id: regularShiftPeriods.id,
        label: regularShiftPeriods.label,
        startDate: regularShiftPeriods.startDate,
        endDate: regularShiftPeriods.endDate,
        submissionDueAt: regularShiftPeriods.submissionDueAt,
      })
      .from(regularShiftPeriods)
      .where(
        and(
          eq(regularShiftPeriods.isArchived, false),
          lte(regularShiftPeriods.submissionOpensAt, now),
          gte(regularShiftPeriods.submissionDueAt, now),
        ),
      )
      .orderBy(desc(regularShiftPeriods.startDate))
      .limit(1),
    // #317: 「今週」のシフトを確認したか
    db
      .select({ confirmedAt: shiftConfirmations.confirmedAt })
      .from(shiftConfirmations)
      .where(
        and(
          eq(shiftConfirmations.tutorId, tutorId),
          eq(shiftConfirmations.weekStart, thisRange.start),
        ),
      )
      .limit(1),
  ]);

  // --- 今週のシフト行 + コマ数 ---
  const { rows: weekRows, slotCount: weekSlotCount } = buildWeekRows(thisWeek);

  // --- 次の出勤 (今日以降、今週→翌週で最初の非欠勤コマ) ---
  // 当日分は終了時刻を過ぎたコマを除外 (夜に当日朝のコマを「次」に出さない)。
  let nextShift: HomeNextShift | null = null;
  for (const wk of [thisWeek, nextWk]) {
    for (const d of wk.days) {
      if (d.date < today) continue;
      // 室長レビュー要望9 (本人): 未定のコマ (生徒も研修も体験も無い) は
      // 出勤が決まっていないので「次の出勤」に出さない
      const slot = d.slots.find(
        (s) =>
          !s.isAbsent &&
          (s.isTraining || s.students.length > 0) &&
          (d.date !== today || s.endTime === "" || s.endTime > nowHm),
      );
      if (slot) {
        nextShift = {
          date: d.date,
          weekdayLabel: d.weekdayLabel,
          isToday: d.date === today,
          isTomorrow: d.date === tomorrow,
          slot,
        };
        break;
      }
    }
    if (nextShift) break;
  }

  // --- 提出締切 (編集可能なもの) ---
  const deadlines: HomeDeadline[] = [];
  // 本番チェック No.12: 「提出する」を押したものだけ提出済み (一時保存は未提出)
  const editableTraining = trainingPeriods.filter((p) => p.editable);
  const trainingStatuses = await getTrainingSubmissionStatuses(
    tutorId,
    editableTraining.map((p) => p.id),
  );
  for (const tp of editableTraining) {
    deadlines.push({
      kind: "training",
      label: `${tp.name}のシフト提出`,
      href: "/tutor/training",
      dueLabel: fmtDeadline(tp.submissionDeadline),
      daysLeft: tp.daysLeft,
      submitted: trainingStatuses.get(tp.id) === "submitted",
    });
  }

  const reg = regularRows[0];
  if (reg) {
    // training と一貫させ period_id FK で判定 (正確)。0018 で nullable 追加のため
    // period_id NULL の旧行は effectiveFrom 範囲で救済するハイブリッド。
    const submittedRows = await db
      .select({ c: count() })
      .from(fixedShiftSubmissions)
      .where(
        and(
          eq(fixedShiftSubmissions.tutorId, tutorId),
          ne(fixedShiftSubmissions.status, "draft"),
          or(
            eq(fixedShiftSubmissions.periodId, reg.id),
            and(
              isNull(fixedShiftSubmissions.periodId),
              between(
                fixedShiftSubmissions.effectiveFrom,
                reg.startDate,
                reg.endDate,
              ),
            ),
          ),
        ),
      );
    deadlines.push({
      kind: "regular",
      label: `${reg.label}のシフト提出`,
      href: `/tutor/fixed-shifts?period=${reg.id}`,
      dueLabel: fmtDeadline(reg.submissionDueAt.toISOString()),
      daysLeft: daysLeftUntil(reg.submissionDueAt, now),
      submitted: (submittedRows[0]?.c ?? 0) > 0,
    });
  }

  deadlines.sort((a, b) => a.daysLeft - b.daysLeft);

  return {
    weekSlotCount,
    weekPublished: thisWeek.published,
    weekRange: thisRange,
    weekConfirmedAt: confirmation[0]?.confirmedAt.toISOString() ?? null,
    nextShift,
    weekRows,
    deadlines,
  };
}
