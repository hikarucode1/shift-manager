import "server-only";
import {
  and,
  arrayContains,
  asc,
  count,
  eq,
  inArray,
  isNotNull,
} from "drizzle-orm";
import { db } from "@/db/client";
import {
  courseConfirmations,
  periods,
  profiles,
  trainingPeriodNotes,
  trainingPreferences,
} from "@/db/schema";
import { getSlotMeta, slotNumbers } from "@/lib/slot-meta";
import { weekdayOf } from "@/lib/week";

export type HeatmapPeriod = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
};

export type HeatmapSlot = {
  slotNumber: number;
  label: string;
  startTime: string;
  endTime: string;
};

export type HeatmapDay = {
  date: string;
  weekdayLabel: string;
  isWeekend: boolean;
};

export type HeatmapTutor = {
  id: string;
  name: string;
  /** #350: 文理 (未登録は null) と担当できる科目の key。絞り込みに使う */
  track: string | null;
  subjects: string[];
};

export type HeatmapData = {
  period: HeatmapPeriod;
  slots: HeatmapSlot[];
  days: HeatmapDay[];
  /** "date|slot" → 希望講師数 */
  counts: Record<string, number>;
  /** "date|slot" → 希望講師 (モーダル用、id 付き) */
  tutorsByCell: Record<string, HeatmapTutor[]>;
  /** Issue #75 (ε): "date|slot" → 確定済み講師 id の集合 */
  confirmedByCell: Record<string, string[]>;
  /**
   * Issue #75 post-merge fix: 希望未提出だが確定済の orphan tutor 一覧。
   * モーダル UI で取消チェックを描画するため id だけでなく name も持つ。
   */
  orphanTutors: Record<string, HeatmapTutor>;
  /** 最大希望者数 (色スケール用) */
  maxCount: number;
  submittedTutorCount: number;
  totalTutorCount: number;
};

function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function eachDate(startIso: string, endIso: string): string[] {
  const out: string[] = [];
  let cur = startIso;
  for (let i = 0; i < 366 && cur <= endIso; i++) {
    out.push(cur);
    cur = addDaysIso(cur, 1);
  }
  return out;
}

/** 教室長: ヒートマップ対象の講習期間 (未アーカイブ, 新しい順)。#110 で全期間=講習期間 */
export async function getHeatmapPeriods(): Promise<HeatmapPeriod[]> {
  const rows = await db
    .select({
      id: periods.id,
      name: periods.name,
      startDate: periods.startDate,
      endDate: periods.endDate,
    })
    .from(periods)
    .where(eq(periods.isArchived, false))
    .orderBy(asc(periods.startDate));
  return rows.sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 指定講習期間の希望ヒートマップ */
export async function getHeatmapData(
  periodId: string,
): Promise<HeatmapData | null> {
  // 非 UUID は即 null (Postgres の uuid キャストエラー=500 を防ぐ)
  if (!UUID_RE.test(periodId)) return null;

  const prow = await db
    .select({
      id: periods.id,
      name: periods.name,
      startDate: periods.startDate,
      endDate: periods.endDate,
      isArchived: periods.isArchived,
    })
    .from(periods)
    .where(eq(periods.id, periodId))
    .limit(1);

  if (prow.length === 0 || prow[0].isArchived) {
    return null;
  }
  const p = prow[0];

  const [slotMeta, prefRows, totalRow, confirmedRows] = await Promise.all([
    getSlotMeta(),
    db
      .select({
        date: trainingPreferences.date,
        slotNumber: trainingPreferences.slotNumber,
        tutorId: trainingPreferences.tutorId,
        tutorName: profiles.displayName,
        tutorTrack: profiles.track,
        tutorSubjects: profiles.teachableSubjects,
      })
      .from(trainingPreferences)
      .innerJoin(profiles, eq(profiles.id, trainingPreferences.tutorId))
      // 本番チェック No.12: 「提出する」を押した講師の希望だけ数える
      // (一時保存のままの希望は教室長に見せない)
      .innerJoin(
        trainingPeriodNotes,
        and(
          eq(trainingPeriodNotes.periodId, trainingPreferences.periodId),
          eq(trainingPeriodNotes.tutorId, trainingPreferences.tutorId),
          isNotNull(trainingPeriodNotes.submittedAt),
        ),
      )
      .where(
        and(
          eq(trainingPreferences.periodId, periodId),
          // 提出者は「有効な講師」に限定 (totalTutorCount と母集団を揃える)
          arrayContains(profiles.roles, ["tutor"]),
          eq(profiles.isActive, true),
        ),
      )
      .orderBy(asc(profiles.displayName)),
    db
      .select({ c: count() })
      .from(profiles)
      .where(
        and(arrayContains(profiles.roles, ["tutor"]), eq(profiles.isActive, true)),
      ),
    // Issue #75 (ε): 期内の確定済み tutor を取得
    db
      .select({
        date: courseConfirmations.date,
        slotNumber: courseConfirmations.slotNumber,
        tutorId: courseConfirmations.tutorId,
      })
      .from(courseConfirmations)
      .where(eq(courseConfirmations.periodId, periodId)),
  ]);

  const counts: Record<string, number> = {};
  const tutorsByCell: Record<string, HeatmapTutor[]> = {};
  const submitted = new Set<string>();
  let maxCount = 0;

  for (const r of prefRows) {
    const key = `${r.date}|${r.slotNumber}`;
    const list = tutorsByCell[key] ?? (tutorsByCell[key] = []);
    list.push({
      id: r.tutorId,
      name: r.tutorName,
      track: r.tutorTrack,
      subjects: r.tutorSubjects,
    });
    const c = (counts[key] = (counts[key] ?? 0) + 1);
    if (c > maxCount) maxCount = c;
    submitted.add(r.tutorId);
  }

  const confirmedByCell: Record<string, string[]> = {};
  for (const r of confirmedRows) {
    const key = `${r.date}|${r.slotNumber}`;
    const list = confirmedByCell[key] ?? (confirmedByCell[key] = []);
    list.push(r.tutorId);
  }

  // Issue #75 post-merge fix: 希望提出していない確定済 tutor (orphan) の name を解決。
  // モーダルでチェックボックス描画 + 取消保存に必要。
  const submittedIds = new Set(prefRows.map((r) => r.tutorId));
  const orphanIdSet = new Set<string>();
  for (const r of confirmedRows) {
    if (!submittedIds.has(r.tutorId)) orphanIdSet.add(r.tutorId);
  }
  const orphanTutors: Record<string, HeatmapTutor> = {};
  if (orphanIdSet.size > 0) {
    const orphanRows = await db
      .select({
        id: profiles.id,
        name: profiles.displayName,
        track: profiles.track,
        subjects: profiles.teachableSubjects,
      })
      .from(profiles)
      .where(inArray(profiles.id, Array.from(orphanIdSet)));
    for (const o of orphanRows) {
      orphanTutors[o.id] = o;
    }
  }

  const slots: HeatmapSlot[] = slotNumbers(slotMeta).map((n) => {
    const m = slotMeta.get(n);
    return {
      slotNumber: n,
      label: m?.label ?? `${n}限`,
      startTime: m?.start ?? "",
      endTime: m?.end ?? "",
    };
  });

  const days: HeatmapDay[] = eachDate(p.startDate, p.endDate).map((date) => {
    const { key, label } = weekdayOf(date);
    return {
      date,
      weekdayLabel: label,
      isWeekend: key === "sat" || key === "sun",
    };
  });

  return {
    period: {
      id: p.id,
      name: p.name,
      startDate: p.startDate,
      endDate: p.endDate,
    },
    slots,
    days,
    counts,
    tutorsByCell,
    confirmedByCell,
    orphanTutors,
    maxCount,
    submittedTutorCount: submitted.size,
    totalTutorCount: totalRow[0]?.c ?? 0,
  };
}

/**
 * 室長レビュー要望11: 講習の提出状況をレギュラーと同じ形で出すための、講師 1 人分。
 * 有効な講師全員 (提出していない人も) を返す
 */
export type TrainingTutorStatus = {
  tutorId: string;
  name: string;
  email: string;
  track: string | null;
  subjects: string[];
  /** submitted = 「提出する」済み / draft = 一時保存だけ / none = 何も保存していない */
  status: "submitted" | "draft" | "none";
  submittedAt: string | null;
  /** 選んだコマ数 */
  slotCount: number;
  note: string;
  testFrom: string | null;
  testTo: string | null;
  summerFrom: string | null;
  summerTo: string | null;
};

/** 講習期間の講師ごとの提出状況 (有効な講師全員、名前順) */
export async function getTrainingTutorStatuses(
  periodId: string,
): Promise<TrainingTutorStatus[]> {
  const [tutorRows, noteRows, prefRows] = await Promise.all([
    db
      .select({
        id: profiles.id,
        name: profiles.displayName,
        email: profiles.email,
        track: profiles.track,
        subjects: profiles.teachableSubjects,
      })
      .from(profiles)
      .where(
        and(arrayContains(profiles.roles, ["tutor"]), eq(profiles.isActive, true)),
      )
      .orderBy(asc(profiles.displayName)),
    db
      .select({
        tutorId: trainingPeriodNotes.tutorId,
        note: trainingPeriodNotes.note,
        testFrom: trainingPeriodNotes.testFrom,
        testTo: trainingPeriodNotes.testTo,
        summerFrom: trainingPeriodNotes.summerFrom,
        summerTo: trainingPeriodNotes.summerTo,
        submittedAt: trainingPeriodNotes.submittedAt,
      })
      .from(trainingPeriodNotes)
      .where(eq(trainingPeriodNotes.periodId, periodId)),
    db
      .select({ tutorId: trainingPreferences.tutorId, c: count() })
      .from(trainingPreferences)
      .where(eq(trainingPreferences.periodId, periodId))
      .groupBy(trainingPreferences.tutorId),
  ]);
  const noteBy = new Map(noteRows.map((n) => [n.tutorId, n]));
  const countBy = new Map(prefRows.map((r) => [r.tutorId, Number(r.c)]));
  return tutorRows.map((t) => {
    const n = noteBy.get(t.id);
    const slotCount = countBy.get(t.id) ?? 0;
    return {
      tutorId: t.id,
      name: t.name,
      email: t.email,
      track: t.track,
      subjects: t.subjects,
      status: trainingStatusOf(n?.submittedAt ?? null, n !== undefined || slotCount > 0),
      submittedAt: n?.submittedAt?.toISOString() ?? null,
      slotCount,
      note: n?.note ?? "",
      testFrom: n?.testFrom ?? null,
      testTo: n?.testTo ?? null,
      summerFrom: n?.summerFrom ?? null,
      summerTo: n?.summerTo ?? null,
    };
  });
}

function trainingStatusOf(
  submittedAt: Date | null,
  hasSaved: boolean,
): TrainingTutorStatus["status"] {
  if (submittedAt) return "submitted";
  return hasSaved ? "draft" : "none";
}
