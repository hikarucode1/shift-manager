import { requireRole } from "@/lib/auth";
import {
  getTutorAbsenceRequests,
  getTutorUpcomingShifts,
} from "@/lib/absences";
import { AbsencePanel } from "./absence-panel";

export default async function TutorAbsencesPage() {
  const { profile } = await requireRole("tutor");

  const [upcoming, history] = await Promise.all([
    getTutorUpcomingShifts(profile.id),
    getTutorAbsenceRequests(profile.id),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">欠勤申請</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          確定済みシフトのうち出勤できないコマを申請します。教室長の承認後に反映されます。
        </p>
      </div>
      <AbsencePanel upcoming={upcoming} history={history} />
    </div>
  );
}
