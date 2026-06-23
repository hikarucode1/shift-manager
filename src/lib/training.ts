import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  periods,
  trainingPeriodNotes,
  trainingPreferences,
} from "@/db/schema";
import { getSlotMeta, slotNumbers } from "@/lib/slot-meta";
import { weekdayOf } from "@/lib/week";

export type TrainingPeriodSummary = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  /** ISO(UTC) */
  submissionDeadline: string;
  isReopened: boolean;
  /** 締切までの残り日数 (JST, 負なら締切超過) */
  daysLeft: number;
  /** 現在編集可能か (締切前 or 再開放) */
  editable: boolean;
};

export type TrainingSlotDef = {
  slotNumber: number;
  label: string;
  startTime: string;
  endTime: string;
};

export type TrainingDay = {
  date: string;
  weekdayLabel: string;
  isWeekend: boolean;
};

export type TrainingEditorData = {
  period: TrainingPeriodSummary;
  slots: TrainingSlotDef[];
  days: TrainingDay[];
  /** 選択済み "date|slot" の集合 */
  selected: Set<string>;
  note: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** JST 今日 00:00 を絶対時刻で */
function jstStartOfToday(now = new Date()): Date {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = jst.getUTCMonth();
  const d = jst.getUTCDate();
  // JST 00:00 = UTC 前日 15:00
  return new Date(Date.UTC(y, m, d) - 9 * 60 * 60 * 1000);
}

function computeEditable(
  deadline: Date,
  isReopened: boolean,
  now = new Date(),
): { editable: boolean; daysLeft: number } {
  const editable = isReopened || now.getTime() <= deadline.getTime();
  const todayStart = jstStartOfToday(now).getTime();
  const deadlineDayStart =
    jstStartOfToday(deadline).getTime();
  const daysLeft = Math.round((deadlineDayStart - todayStart) / DAY_MS);
  return { editable, daysLeft };
}

function cellKey(date: string, slot: number) {
  return `${date}|${slot}`;
}

function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function eachDate(startIso: string, endIso: string): string[] {
  const out: string[] = [];
  let cur = startIso;
  // 安全弁: 最大 366 日
  for (let i = 0; i < 366 && cur <= endIso; i++) {
    out.push(cur);
    cur = addDaysIso(cur, 1);
  }
  return out;
}

/** 終了からこの日数を超えた講習は一覧から隠す (締切後の見直し猶予) */
const ENDED_VISIBLE_DAYS = 30;

/** 講師に出す講習期間 (未アーカイブ, 直近) を新しい順で。#110 で全期間=講習期間 */
export async function getActiveTrainingPeriods(): Promise<
  TrainingPeriodSummary[]
> {
  const rows = await db
    .select({
      id: periods.id,
      name: periods.name,
      startDate: periods.startDate,
      endDate: periods.endDate,
      submissionDeadline: periods.submissionDeadline,
      isReopened: periods.isReopened,
    })
    .from(periods)
    .where(eq(periods.isArchived, false))
    .orderBy(desc(periods.startDate));

  const cutoff = addDaysIso(jstStartOfToday().toISOString().slice(0, 10), -ENDED_VISIBLE_DAYS);

  return rows
    .filter((r) => r.submissionDeadline !== null)
    .map((r) => {
      const deadline = r.submissionDeadline as Date;
      const { editable, daysLeft } = computeEditable(deadline, r.isReopened);
      return {
        id: r.id,
        name: r.name,
        startDate: r.startDate,
        endDate: r.endDate,
        submissionDeadline: deadline.toISOString(),
        isReopened: r.isReopened,
        daysLeft,
        editable,
      };
    })
    // まだ提出可、または終了から ENDED_VISIBLE_DAYS 日以内のものだけ残す
    .filter((p) => p.editable || p.endDate >= cutoff);
}

/** 指定講習期間の編集用データ (講師の選択状態 + 備考 + 編集可否) */
export async function getTrainingEditorData(
  tutorId: string,
  periodId: string,
): Promise<TrainingEditorData | null> {
  const prow = await db
    .select({
      id: periods.id,
      name: periods.name,
      startDate: periods.startDate,
      endDate: periods.endDate,
      submissionDeadline: periods.submissionDeadline,
      isReopened: periods.isReopened,
      isArchived: periods.isArchived,
    })
    .from(periods)
    .where(eq(periods.id, periodId))
    .limit(1);

  if (
    prow.length === 0 ||
    prow[0].isArchived ||
    prow[0].submissionDeadline === null
  ) {
    return null;
  }
  const p = prow[0];
  const deadline = p.submissionDeadline as Date;
  const { editable, daysLeft } = computeEditable(deadline, p.isReopened);

  const slotMeta = await getSlotMeta();
  const slots: TrainingSlotDef[] = slotNumbers(slotMeta).map((n) => {
    const m = slotMeta.get(n);
    return {
      slotNumber: n,
      label: m?.label ?? `${n}限`,
      startTime: m?.start ?? "",
      endTime: m?.end ?? "",
    };
  });

  const days: TrainingDay[] = eachDate(p.startDate, p.endDate).map((date) => {
    const { key, label } = weekdayOf(date);
    return {
      date,
      weekdayLabel: label,
      isWeekend: key === "sat" || key === "sun",
    };
  });

  const [prefRows, noteRow] = await Promise.all([
    db
      .select({
        date: trainingPreferences.date,
        slotNumber: trainingPreferences.slotNumber,
      })
      .from(trainingPreferences)
      .where(
        and(
          eq(trainingPreferences.periodId, periodId),
          eq(trainingPreferences.tutorId, tutorId),
        ),
      ),
    db
      .select({ note: trainingPeriodNotes.note })
      .from(trainingPeriodNotes)
      .where(
        and(
          eq(trainingPeriodNotes.periodId, periodId),
          eq(trainingPeriodNotes.tutorId, tutorId),
        ),
      )
      .limit(1),
  ]);

  const selected = new Set(
    prefRows.map((r) => cellKey(r.date, r.slotNumber)),
  );

  return {
    period: {
      id: p.id,
      name: p.name,
      startDate: p.startDate,
      endDate: p.endDate,
      submissionDeadline: deadline.toISOString(),
      isReopened: p.isReopened,
      daysLeft,
      editable,
    },
    slots,
    days,
    selected,
    note: noteRow[0]?.note ?? "",
  };
}

/**
 * サーバー側で「今この期間が編集可能か」を厳密判定 (action のガード用)。
 * 成功時は date / slot のサーバー検証に使う期間境界も返す。
 */
export async function assertTrainingEditable(
  periodId: string,
): Promise<
  | { ok: true; startDate: string; endDate: string }
  | { ok: false; reason: string }
> {
  const rows = await db
    .select({
      startDate: periods.startDate,
      endDate: periods.endDate,
      submissionDeadline: periods.submissionDeadline,
      isReopened: periods.isReopened,
      isArchived: periods.isArchived,
    })
    .from(periods)
    .where(eq(periods.id, periodId))
    .limit(1);

  if (rows.length === 0) return { ok: false, reason: "期間が存在しません。" };
  const r = rows[0];
  if (r.isArchived || r.submissionDeadline === null) {
    return { ok: false, reason: "対象の講習期間ではありません。" };
  }
  const { editable } = computeEditable(
    r.submissionDeadline as Date,
    r.isReopened,
  );
  if (!editable) {
    return { ok: false, reason: "提出締切を過ぎています。" };
  }
  return { ok: true, startDate: r.startDate, endDate: r.endDate };
}

/** その期間で有効なコマ番号の集合 (slot_definitions 由来) */
export async function validSlotNumbers(): Promise<Set<number>> {
  const meta = await getSlotMeta();
  return new Set(slotNumbers(meta));
}
