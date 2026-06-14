import { and, asc, desc, eq, gte, lt, lte } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import {
  fixedShifts,
  fixedShiftSubmissions,
  profiles,
  regularAssignments,
  regularShiftPeriods,
  slotDefinitions,
} from "@/db/schema";
import { DEFAULT_SLOTS } from "@/lib/shift-constants";
import { lastDayOfMonth } from "@/lib/shift-period";
import { AdminSubmissionsOverview } from "./submissions-overview";

/** 当月の 1 日 (JST) を "YYYY-MM-DD" で返す */
function thisMonthIso(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

/** "2026-07-01" → "2026-08-01" (翌月の 1 日)。target_month の範囲フィルタ用 */
function nextMonthIso(monthIso: string): string {
  const [y, m] = monthIso.slice(0, 7).split("-").map(Number);
  const next = new Date(Date.UTC(y, m, 1));
  const ny = next.getUTCFullYear();
  const nm = String(next.getUTCMonth() + 1).padStart(2, "0");
  return `${ny}-${nm}-01`;
}

function isValidMonthIso(s: string): boolean {
  return /^\d{4}-\d{2}-01$/.test(s);
}

export default async function AdminFixedShiftsOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  await requireRole("admin");

  const sp = await searchParams;
  const targetMonth =
    sp.month && isValidMonthIso(sp.month) ? sp.month : thisMonthIso();
  const monthEnd = nextMonthIso(targetMonth);
  // 期検索 (#83) で「月末以前に始まる期」と判定するため月末日も先に算出。
  // monthEnd (翌月初) は effective_from < monthEnd の比較用、別用途。
  const monthEndIso = lastDayOfMonth(targetMonth);

  const [
    tutorRows,
    slotRows,
    periodRows,
    submissionRows,
    entryRows,
  ] = await Promise.all([
      // 対象月の集計対象になる active tutor (CSV 由来 stub 含む)
      db
        .select({
          id: profiles.id,
          displayName: profiles.displayName,
          email: profiles.email,
        })
        .from(profiles)
        .where(and(eq(profiles.role, "tutor"), eq(profiles.isActive, true)))
        .orderBy(asc(profiles.displayName)),
      db
        .select()
        .from(slotDefinitions)
        .where(eq(slotDefinitions.isActive, true))
        .orderBy(asc(slotDefinitions.slotNumber)),
      // Issue #72 (β) + #83: 対象月と range が重なる期 1 件を取得 (締切表示)。
      // 当初は start_date <= targetMonth で「月初日が期内」を条件にしていたが、
      // 期途中始動 (例: start_date=2026-04-16) で 4 月俯瞰が期を取りこぼしていた。
      // 月末日との重なり判定に変更: start_date <= 月末日 AND end_date >= 月初日。
      // 月選択ベースの俯瞰 UI が期にまたがるケースは「期内のうちの 1 ヶ月」を
      // 見ているだけなので、最も新しい該当期を採用する。
      db
        .select({
          id: regularShiftPeriods.id,
          label: regularShiftPeriods.label,
          startDate: regularShiftPeriods.startDate,
          endDate: regularShiftPeriods.endDate,
          submissionOpensAt: regularShiftPeriods.submissionOpensAt,
          submissionDueAt: regularShiftPeriods.submissionDueAt,
          isArchived: regularShiftPeriods.isArchived,
        })
        .from(regularShiftPeriods)
        .where(
          and(
            eq(regularShiftPeriods.isArchived, false),
            lte(regularShiftPeriods.startDate, monthEndIso),
            gte(regularShiftPeriods.endDate, targetMonth),
          ),
        )
        .orderBy(desc(regularShiftPeriods.startDate))
        .limit(1),
      // 対象月に effectiveFrom が入る提出 (月単位の運用 = effectiveFrom == targetMonth)
      db
        .select({
          tutorId: fixedShiftSubmissions.tutorId,
          effectiveFrom: fixedShiftSubmissions.effectiveFrom,
          effectiveTo: fixedShiftSubmissions.effectiveTo,
          desiredDays: fixedShiftSubmissions.desiredDays,
          desiredSlots: fixedShiftSubmissions.desiredSlots,
          note: fixedShiftSubmissions.note,
          status: fixedShiftSubmissions.status,
          submittedAt: fixedShiftSubmissions.submittedAt,
          lastStatusChangedAt: fixedShiftSubmissions.lastStatusChangedAt,
          lastStatusChangedBy: fixedShiftSubmissions.lastStatusChangedBy,
        })
        .from(fixedShiftSubmissions)
        .where(
          and(
            gte(fixedShiftSubmissions.effectiveFrom, targetMonth),
            lt(fixedShiftSubmissions.effectiveFrom, monthEnd),
          ),
        ),
      // 対象月の fixed_shifts (○/△ セル)
      db
        .select({
          tutorId: fixedShifts.tutorId,
          weekday: fixedShifts.weekday,
          slotNumber: fixedShifts.slotNumber,
          effectiveFrom: fixedShifts.effectiveFrom,
          availability: fixedShifts.availability,
        })
        .from(fixedShifts)
        .where(
          and(
            gte(fixedShifts.effectiveFrom, targetMonth),
            lt(fixedShifts.effectiveFrom, monthEnd),
          ),
        ),
    ]);

  // Issue #74 (δ): 対象月の確定行は period 解決後に取る (期 ID が無い月は空)。
  const period = periodRows[0] ?? null;
  const assignmentRows = period
    ? await db
        .select({
          tutorId: regularAssignments.tutorId,
          weekday: regularAssignments.weekday,
          slotNumber: regularAssignments.slotNumber,
        })
        .from(regularAssignments)
        .where(
          and(
            eq(regularAssignments.periodId, period.id),
            lte(regularAssignments.effectiveFrom, monthEndIso),
            gte(regularAssignments.effectiveTo, targetMonth),
          ),
        )
    : [];

  const slots =
    slotRows.length > 0
      ? slotRows.map((s) => ({
          slotNumber: s.slotNumber,
          label: s.label,
          startTime: s.startTime,
          endTime: s.endTime,
        }))
      : DEFAULT_SLOTS.map((s) => ({ ...s }));

  // 各 tutor の提出 (1 tutor あたり最大 1 行 / 月単位の運用前提)
  // 同月に複数 effectiveFrom が入る稀な場合は最新を採用
  const submissionByTutor = new Map<string, (typeof submissionRows)[number]>();
  for (const s of submissionRows) {
    const prev = submissionByTutor.get(s.tutorId);
    if (!prev || s.effectiveFrom > prev.effectiveFrom) {
      submissionByTutor.set(s.tutorId, s);
    }
  }

  // entries: tutorId → Map<"weekday:slot", availability>
  const entriesByTutor = new Map<string, Map<string, "yes" | "maybe" | "no">>();
  for (const e of entryRows) {
    if (!entriesByTutor.has(e.tutorId)) {
      entriesByTutor.set(e.tutorId, new Map());
    }
    entriesByTutor
      .get(e.tutorId)!
      .set(`${e.weekday}:${e.slotNumber}`, e.availability);
  }

  const tutorViews = tutorRows.map((t) => {
    const sub = submissionByTutor.get(t.id) ?? null;
    return {
      id: t.id,
      displayName: t.displayName,
      email: t.email,
      submission: sub
        ? {
            effectiveFrom: sub.effectiveFrom,
            effectiveTo: sub.effectiveTo,
            desiredDays: sub.desiredDays,
            desiredSlots: sub.desiredSlots,
            note: sub.note,
            status: sub.status,
            submittedAt: sub.submittedAt ? sub.submittedAt.toISOString() : null,
            lastStatusChangedAt: sub.lastStatusChangedAt
              ? sub.lastStatusChangedAt.toISOString()
              : null,
          }
        : null,
      entries: Array.from(entriesByTutor.get(t.id)?.entries() ?? []).map(
        ([key, availability]) => {
          const [weekday, slotStr] = key.split(":");
          return {
            weekday,
            slotNumber: Number(slotStr),
            availability,
          };
        },
      ),
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">固定シフト俯瞰 (C1)</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          対象月を選んで講師ごとの提出状況・希望コマを一覧します。教室長は提出を凍結
          (frozen) して以降の編集を止めたり、凍結を解除して下書きに戻したりできます。
        </p>
      </div>

      <AdminSubmissionsOverview
        key={targetMonth}
        targetMonth={targetMonth}
        slots={slots}
        tutors={tutorViews}
        initialConfirmed={assignmentRows.map((a) => ({
          tutorId: a.tutorId,
          weekday: a.weekday,
          slotNumber: a.slotNumber,
        }))}
        period={
          period
            ? {
                id: period.id,
                label: period.label,
                startDate: period.startDate,
                endDate: period.endDate,
                submissionOpensAt: period.submissionOpensAt.toISOString(),
                submissionDueAt: period.submissionDueAt.toISOString(),
              }
            : null
        }
      />
    </div>
  );
}
