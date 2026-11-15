import { eq } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import { shiftConfirmations } from "@/db/schema";
import { getAdminWeekSchedule } from "@/lib/admin-schedule";
import { confirmationSummary } from "@/lib/weekly-confirmation";
import { isValidIsoDate, weekOf } from "@/lib/week";
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

  const [schedule, confirmations] = await Promise.all([
    getAdminWeekSchedule(range),
    // #317: この週のシフトを確認した講師
    db
      .select({ tutorId: shiftConfirmations.tutorId })
      .from(shiftConfirmations)
      .where(eq(shiftConfirmations.weekStart, range.start)),
  ]);
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
      {/* 週が変わったらフィルタ等のローカル state をリセットするため key を付与 */}
      <WeeklyGrid key={schedule.range.start} schedule={schedule} />
    </div>
  );
}
