import "server-only";
import { and, desc, eq, inArray, lte } from "drizzle-orm";
import { db } from "@/db/client";
import {
  periods,
  regularAssignments,
  trainingPeriodNotes,
  trainingPreferences,
} from "@/db/schema";
import { getSlotMeta, slotNumbers } from "@/lib/slot-meta";
import { jstToday, weekdayOf } from "@/lib/week";
import type { Weekday } from "@/lib/shift-constants";
import { pickUsualRegularSlots } from "@/lib/usual-regular";
import type { DateRange, TrainingRangeKind } from "@/lib/training-ranges";
import { getActiveTrainingGrant } from "@/lib/shift-change";

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
  /** 現在編集可能か (締切前 or 再開放 or #333 本人だけの変更許可) */
  editable: boolean;
  /**
   * #333: 締切後に教室長が**この講師だけ**編集を許可している期限 (ISO)。
   * 許可が無ければ null。一覧 (getActiveTrainingPeriods) では常に null
   */
  changeUnlockedUntil: string | null;
};

export type TrainingSlotDef = {
  slotNumber: number;
  label: string;
  startTime: string;
  endTime: string;
};

export type TrainingDay = {
  date: string;
  /** "mon" など。レギュラーの曜日と突き合わせる */
  weekday: Weekday;
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
  /** #319: テスト期間 / 長期休み (どちらも任意) */
  ranges: Record<TrainingRangeKind, DateRange>;
  /** 本番チェック No.12: 提出した時刻 (ISO)。null は一時保存 (未提出) */
  submittedAt: string | null;
  /**
   * 室長レビュー要望7: 普段レギュラーで入っている "weekday|slot" (例 "mon|3")。
   * 講習の希望を選ぶときに強調して見せる
   */
  regularSlots: string[];
};

/** 講師ごとの講習希望の状態。none = まだ何も保存していない */
export type TrainingSubmissionStatus = "submitted" | "draft" | "none";

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

export function computeEditable(
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

  // #165: jstStartOfToday().toISOString() は UTC 変換で JST 15:00 未満だと前日に
  // なる。表示カットオフが 1 日ズレるため、JST カレンダー日を返す jstToday() を使う。
  const cutoff = addDaysIso(jstToday(), -ENDED_VISIBLE_DAYS);

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
        changeUnlockedUntil: null,
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
  const computed = computeEditable(deadline, p.isReopened);
  const { daysLeft } = computed;
  // #333: 締切後でも、教室長がこの講師だけ許可していれば編集できる
  const grant = computed.editable
    ? null
    : await getActiveTrainingGrant(tutorId, periodId, new Date());
  const editable = computed.editable || grant !== null;

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
      weekday: key,
      weekdayLabel: label,
      isWeekend: key === "sat" || key === "sun",
    };
  });

  const [prefRows, noteRow, regularSlots] = await Promise.all([
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
      .select({
        note: trainingPeriodNotes.note,
        testFrom: trainingPeriodNotes.testFrom,
        testTo: trainingPeriodNotes.testTo,
        summerFrom: trainingPeriodNotes.summerFrom,
        summerTo: trainingPeriodNotes.summerTo,
        submittedAt: trainingPeriodNotes.submittedAt,
      })
      .from(trainingPeriodNotes)
      .where(
        and(
          eq(trainingPeriodNotes.periodId, periodId),
          eq(trainingPeriodNotes.tutorId, tutorId),
        ),
      )
      .limit(1),
    getUsualRegularSlots(tutorId, p.endDate),
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
      changeUnlockedUntil: grant ? grant.unlockedUntil.toISOString() : null,
    },
    slots,
    days,
    selected,
    note: noteRow[0]?.note ?? "",
    ranges: {
      test: { from: noteRow[0]?.testFrom ?? null, to: noteRow[0]?.testTo ?? null },
      summer: {
        from: noteRow[0]?.summerFrom ?? null,
        to: noteRow[0]?.summerTo ?? null,
      },
    },
    submittedAt: noteRow[0]?.submittedAt?.toISOString() ?? null,
    regularSlots,
  };
}

/**
 * 室長レビュー要望7: 講師が「普段」レギュラーで入っている曜日×コマ。
 * 講習期間の終わりまでに始まっている確定レギュラーのうち、いちばん新しい日
 * (= 最後の期の終わり。講習期間の終わりを超えるならそこまで) に効いている行を使う。
 * 講習の時期はレギュラーの期の外にあることが多いので、直前の期を「普段」とみなす
 */
export async function getUsualRegularSlots(
  tutorId: string,
  untilDate: string,
): Promise<string[]> {
  const rows = await db
    .select({
      weekday: regularAssignments.weekday,
      slotNumber: regularAssignments.slotNumber,
      effectiveFrom: regularAssignments.effectiveFrom,
      effectiveTo: regularAssignments.effectiveTo,
    })
    .from(regularAssignments)
    .where(
      and(
        eq(regularAssignments.tutorId, tutorId),
        lte(regularAssignments.effectiveFrom, untilDate),
      ),
    );
  return pickUsualRegularSlots(rows, untilDate);
}


/** 講師の各講習期間の提出状態 (一覧のバッジ・ホームの締切表示用) */
export async function getTrainingSubmissionStatuses(
  tutorId: string,
  periodIds: string[],
): Promise<Map<string, TrainingSubmissionStatus>> {
  const out = new Map<string, TrainingSubmissionStatus>();
  if (periodIds.length === 0) return out;
  const [noteRows, prefRows] = await Promise.all([
    db
      .select({
        periodId: trainingPeriodNotes.periodId,
        submittedAt: trainingPeriodNotes.submittedAt,
      })
      .from(trainingPeriodNotes)
      .where(
        and(
          eq(trainingPeriodNotes.tutorId, tutorId),
          inArray(trainingPeriodNotes.periodId, periodIds),
        ),
      ),
    db
      .selectDistinct({ periodId: trainingPreferences.periodId })
      .from(trainingPreferences)
      .where(
        and(
          eq(trainingPreferences.tutorId, tutorId),
          inArray(trainingPreferences.periodId, periodIds),
        ),
      ),
  ]);
  for (const id of periodIds) out.set(id, "none");
  // コマを選んだ・備考などを書いた = 一時保存
  for (const r of prefRows) out.set(r.periodId, "draft");
  for (const r of noteRows) {
    out.set(r.periodId, r.submittedAt ? "submitted" : "draft");
  }
  return out;
}

/** 提出済みか (編集系 action のガード用) */
export async function isTrainingSubmitted(
  periodId: string,
  tutorId: string,
): Promise<boolean> {
  const rows = await db
    .select({ submittedAt: trainingPeriodNotes.submittedAt })
    .from(trainingPeriodNotes)
    .where(
      and(
        eq(trainingPeriodNotes.periodId, periodId),
        eq(trainingPeriodNotes.tutorId, tutorId),
      ),
    )
    .limit(1);
  return rows[0]?.submittedAt != null;
}

/**
 * サーバー側で「今この期間が編集可能か」を厳密判定 (action のガード用)。
 * 成功時は date / slot のサーバー検証に使う期間境界も返す。
 */
export async function assertTrainingEditable(
  periodId: string,
  /** #333: この講師だけの変更許可も見る */
  tutorId: string,
  /** 本番チェック No.12: 提出済みなら断る (「修正する」自体はこれを false で呼ぶ) */
  { rejectSubmitted = true }: { rejectSubmitted?: boolean } = {},
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
  if (
    !editable &&
    !(await getActiveTrainingGrant(tutorId, periodId, new Date()))
  ) {
    return {
      ok: false,
      reason:
        "提出締切を過ぎています。変更したいときは「変更申請」を出してください。",
    };
  }
  if (rejectSubmitted && (await isTrainingSubmitted(periodId, tutorId))) {
    return {
      ok: false,
      reason: "提出済みです。直すときは「修正する」を押してください。",
    };
  }
  return { ok: true, startDate: r.startDate, endDate: r.endDate };
}

/** その期間で有効なコマ番号の集合 (slot_definitions 由来) */
export async function validSlotNumbers(): Promise<Set<number>> {
  const meta = await getSlotMeta();
  return new Set(slotNumbers(meta));
}
