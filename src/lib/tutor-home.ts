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
  trainingPreferences,
} from "@/db/schema";
import { getActiveTrainingPeriods } from "@/lib/training";
import { getTutorWeekSchedule, type ScheduleSlot } from "@/lib/tutor-schedule";
import { jstToday, nextWeek, weekOf } from "@/lib/week";

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
  slotNumbers: number[];
  status: "confirmed" | "absent";
};

export type HomeDeadline = {
  kind: "training" | "regular";
  /** 例: "夏期講習の希望提出" */
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
  nextShift: HomeNextShift | null;
  weekRows: HomeShiftRow[];
  /** 編集可能な提出締切 (残り日数の近い順) */
  deadlines: HomeDeadline[];
};

/**
 * 講師ホーム (#130) の集約データ。確定シフト (今週/翌週) と、提出締切 (講習 +
 * レギュラー) を 1 回でまとめて取得する。表示専用 (Server Component)。
 */
export async function getTutorHomeData(tutorId: string): Promise<TutorHomeData> {
  const today = jstToday();
  const tomorrow = addDayIso(today);
  const now = new Date();
  const nowHm = nowHmJst(now);
  const thisRange = weekOf();
  const nextRange = nextWeek(thisRange);

  const [thisWeek, nextWk, trainingPeriods, regularRows] = await Promise.all([
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
  ]);

  // --- 今週のシフト行 + コマ数 ---
  const weekRows: HomeShiftRow[] = [];
  let weekSlotCount = 0;
  for (const d of thisWeek.days) {
    if (d.slots.length === 0) continue;
    const liveSlots = d.slots.filter((s) => !s.isAbsent);
    weekSlotCount += liveSlots.length;
    const confirmed = liveSlots.length > 0;
    weekRows.push({
      date: d.date,
      weekdayLabel: d.weekdayLabel,
      // 確定行は欠勤コマを除いた番号のみ (混在日でも欠勤を確定として見せない)
      slotNumbers: (confirmed ? liveSlots : d.slots).map((s) => s.slotNumber),
      status: confirmed ? "confirmed" : "absent",
    });
  }

  // --- 次の出勤 (今日以降、今週→翌週で最初の非欠勤コマ) ---
  // 当日分は終了時刻を過ぎたコマを除外 (夜に当日朝のコマを「次」に出さない)。
  let nextShift: HomeNextShift | null = null;
  for (const wk of [thisWeek, nextWk]) {
    for (const d of wk.days) {
      if (d.date < today) continue;
      const slot = d.slots.find(
        (s) =>
          !s.isAbsent &&
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
  for (const tp of trainingPeriods.filter((p) => p.editable)) {
    const submittedRows = await db
      .select({ c: count() })
      .from(trainingPreferences)
      .where(
        and(
          eq(trainingPreferences.tutorId, tutorId),
          eq(trainingPreferences.periodId, tp.id),
        ),
      );
    deadlines.push({
      kind: "training",
      label: `${tp.name}の希望提出`,
      href: "/tutor/training",
      dueLabel: fmtDeadline(tp.submissionDeadline),
      daysLeft: tp.daysLeft,
      submitted: (submittedRows[0]?.c ?? 0) > 0,
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
      href: "/tutor/fixed-shifts",
      dueLabel: fmtDeadline(reg.submissionDueAt.toISOString()),
      daysLeft: daysLeftUntil(reg.submissionDueAt, now),
      submitted: (submittedRows[0]?.c ?? 0) > 0,
    });
  }

  deadlines.sort((a, b) => a.daysLeft - b.daysLeft);

  return {
    weekSlotCount,
    weekPublished: thisWeek.published,
    nextShift,
    weekRows,
    deadlines,
  };
}
