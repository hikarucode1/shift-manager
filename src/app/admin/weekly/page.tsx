import { requireRole } from "@/lib/auth";
import { getAdminWeekSchedule } from "@/lib/admin-schedule";
import { weekOf } from "@/lib/week";
import { WeeklyGrid } from "./weekly-grid";

export default async function AdminWeeklyPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  await requireRole("admin");

  const { week } = await searchParams;
  // week が "YYYY-MM-DD" ならその週、無効/未指定なら今週
  const range = /^\d{4}-\d{2}-\d{2}$/.test(week ?? "")
    ? weekOf(week)
    : weekOf();

  const schedule = await getAdminWeekSchedule(range);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">週次シフト</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          公開済みの座席表を週ごとに俯瞰します。
        </p>
      </div>
      <WeeklyGrid schedule={schedule} />
    </div>
  );
}
