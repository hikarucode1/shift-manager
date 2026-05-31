import "server-only";
import { and, asc, count, eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  courseConfirmations,
  periods,
  profiles,
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

export type HeatmapTutor = { id: string; name: string };

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

/** 教室長: ヒートマップ対象の講習期間 (kind=training, 未アーカイブ, 新しい順) */
export async function getHeatmapPeriods(): Promise<HeatmapPeriod[]> {
  const rows = await db
    .select({
      id: periods.id,
      name: periods.name,
      startDate: periods.startDate,
      endDate: periods.endDate,
    })
    .from(periods)
    .where(and(eq(periods.kind, "training"), eq(periods.isArchived, false)))
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
      kind: periods.kind,
      name: periods.name,
      startDate: periods.startDate,
      endDate: periods.endDate,
      isArchived: periods.isArchived,
    })
    .from(periods)
    .where(eq(periods.id, periodId))
    .limit(1);

  if (
    prow.length === 0 ||
    prow[0].kind !== "training" ||
    prow[0].isArchived
  ) {
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
      })
      .from(trainingPreferences)
      .innerJoin(profiles, eq(profiles.id, trainingPreferences.tutorId))
      .where(
        and(
          eq(trainingPreferences.periodId, periodId),
          // 提出者は「有効な講師」に限定 (totalTutorCount と母集団を揃える)
          eq(profiles.role, "tutor"),
          eq(profiles.isActive, true),
        ),
      )
      .orderBy(asc(profiles.displayName)),
    db
      .select({ c: count() })
      .from(profiles)
      .where(and(eq(profiles.role, "tutor"), eq(profiles.isActive, true))),
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
    list.push({ id: r.tutorId, name: r.tutorName });
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
    maxCount,
    submittedTutorCount: submitted.size,
    totalTutorCount: totalRow[0]?.c ?? 0,
  };
}
