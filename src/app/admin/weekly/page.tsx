import { requireRole } from "@/lib/auth";
import { getAdminWeekSchedule } from "@/lib/admin-schedule";
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

  const schedule = await getAdminWeekSchedule(range);

  return (
    <div className="weekly-print space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">登録済みシフト</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          公開済みの座席表を週ごとに俯瞰します。
        </p>
      </div>
      {/* 週が変わったらフィルタ等のローカル state をリセットするため key を付与 */}
      <WeeklyGrid key={schedule.range.start} schedule={schedule} />
    </div>
  );
}
