import { requireRole } from "@/lib/auth";
import {
  getActiveTutorsExcept,
  getTutorSwapRequests,
  getTutorSwappableShifts,
} from "@/lib/swaps";
import { SwapPanel } from "./swap-panel";

export default async function TutorSwapsPage() {
  const { profile } = await requireRole("tutor");

  const [shifts, tutors, requests] = await Promise.all([
    getTutorSwappableShifts(profile.id),
    getActiveTutorsExcept(profile.id),
    getTutorSwapRequests(profile.id),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">交代申請</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          確定シフトを別の講師に代わってもらう申請をします。指名するか、代講を募集できます。
        </p>
      </div>
      <SwapPanel shifts={shifts} tutors={tutors} requests={requests} />
    </div>
  );
}
