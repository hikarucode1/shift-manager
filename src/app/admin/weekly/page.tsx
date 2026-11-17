import { eq } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import { shiftConfirmations } from "@/db/schema";
import { getAdminWeekSchedule } from "@/lib/admin-schedule";
import { confirmationSummary } from "@/lib/weekly-confirmation";
import { isValidIsoDate, noticeDate, weekOf } from "@/lib/week";
import { getApprovedDayOffs, getDayOffConflicts } from "@/lib/day-offs";
import { dayOffSlotsLabel } from "@/lib/day-off-rule";
import { getSlotMeta } from "@/lib/slot-meta";
import { WeeklyGrid } from "./weekly-grid";

export default async function AdminWeeklyPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  await requireRole("admin");

  const { week } = await searchParams;
  // 実在する YYYY-MM-DD のみ採用。不正・未指定は今週にフォールバック
  const range = isValidIsoDate(week) ? weekOf(week) : weekOf();

  const [schedule, confirmations, dayOffs, slotMeta] = await Promise.all([
    getAdminWeekSchedule(range),
    // #317: この週のシフトを確認した講師
    db
      .select({ tutorId: shiftConfirmations.tutorId })
      .from(shiftConfirmations)
      .where(eq(shiftConfirmations.weekStart, range.start)),
    // #360: この週の承認済みの休み希望
    getApprovedDayOffs(range),
    getSlotMeta(),
  ]);
  const conflicts = await getDayOffConflicts(range, dayOffs);
  const slotLabel = (n: number) => slotMeta.get(n)?.label ?? `${n}限`;
  const summary = confirmationSummary(
    schedule.tutors,
    new Set(confirmations.map((c) => c.tutorId)),
  );

  return (
    <div className="weekly-print space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">登録済みシフト</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          公開済みの座席表を週ごとに俯瞰します。
        </p>
      </div>
      {/* #317: 講師がこの週のシフトを確認したか (LINE のスタンプの代わり)。
          印刷には出さない */}
      {schedule.published && summary.total > 0 && (
        <div className="rounded-lg border px-4 py-3 text-sm print:hidden">
          <p>
            <span className="font-semibold">
              確認済み {summary.confirmed} / {summary.total} 人
            </span>
            {summary.unconfirmedNames.length === 0 && (
              <span className="ml-2 text-primary">全員が確認しました</span>
            )}
          </p>
          {summary.unconfirmedNames.length > 0 && (
            <p className="mt-1 text-muted-foreground">
              まだ: {summary.unconfirmedNames.join("、")}
            </p>
          )}
        </div>
      )}
      {/* #360: 休み希望 (承認済み)。入れてしまっていたら赤で出す。印刷には出さない */}
      {dayOffs.length > 0 && (
        <div className="space-y-1 rounded-lg border px-4 py-3 text-sm print:hidden">
          <p className="font-semibold">この週の休み希望（承認済み）</p>
          <ul className="list-disc pl-5 text-muted-foreground">
            {dayOffs.map((d) => (
              <li key={d.id}>
                {d.tutorName} {noticeDate(d.date)}{" "}
                {dayOffSlotsLabel(d.slotNumbers, slotLabel)}
              </li>
            ))}
          </ul>
          {conflicts.length > 0 && (
            <div role="alert" className="pt-1 text-destructive">
              <p className="font-medium">
                休みの日に入っているコマが {conflicts.length} 件あります
              </p>
              <ul className="list-disc pl-5">
                {conflicts.map((c) => (
                  <li key={`${c.tutorName}|${c.date}|${c.slotNumber}`}>
                    {c.tutorName} {noticeDate(c.date)} {slotLabel(c.slotNumber)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {/* 週が変わったらフィルタ等のローカル state をリセットするため key を付与 */}
      <WeeklyGrid key={schedule.range.start} schedule={schedule} />
    </div>
  );
}
