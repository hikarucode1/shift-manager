import { requireRole } from "@/lib/auth";
import { getTutorWeekSchedule } from "@/lib/tutor-schedule";
import { weekOf, nextWeek } from "@/lib/week";
import { WeekScheduleView } from "./week-schedule-view";

export default async function TutorHome() {
  const { profile } = await requireRole("tutor");

  const thisRange = weekOf();
  const nextRange = nextWeek(thisRange);

  const [thisWeek, next] = await Promise.all([
    getTutorWeekSchedule(profile.id, thisRange),
    getTutorWeekSchedule(profile.id, nextRange),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">今週のシフト</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {profile.displayName} さんの確定シフトです。教室長が座席表を公開すると反映されます。
        </p>
      </div>

      <WeekScheduleView
        thisWeek={thisWeek}
        nextWeek={next.hasAnyShift ? next : null}
      />
    </div>
  );
}
