import { requireRole } from "@/lib/auth";
import {
  getTutorAbsenceRequests,
  getTutorUpcomingShifts,
} from "@/lib/absences";
import { TutorRequestsNav } from "@/components/tutor-requests-nav";
import { AbsencePanel } from "./absence-panel";

export default async function TutorAbsencesPage() {
  const { profile } = await requireRole("tutor");

  const [upcoming, history] = await Promise.all([
    getTutorUpcomingShifts(profile.id),
    getTutorAbsenceRequests(profile.id),
  ]);

  return (
    <div className="space-y-5">
      <TutorRequestsNav />

      {/* ネイビー hero (#130/#131/#132 と統一) */}
      <section className="rounded-xl bg-primary p-4 text-primary-foreground">
        <h1 className="text-xl font-bold">欠勤申請</h1>
        <p className="mt-1 text-xs text-primary-foreground/80">
          確定済みシフトのうち出勤できないコマを申請します。教室長の承認後に反映されます。
        </p>
      </section>

      <AbsencePanel upcoming={upcoming} history={history} />
    </div>
  );
}
