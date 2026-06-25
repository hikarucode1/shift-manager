import { requireRole } from "@/lib/auth";
import {
  getActiveTutorsExcept,
  getTutorSwapRequests,
  getTutorSwappableShifts,
} from "@/lib/swaps";
import { TutorRequestsNav } from "@/components/tutor-requests-nav";
import { SwapPanel } from "./swap-panel";

export default async function TutorSwapsPage() {
  const { profile } = await requireRole("tutor");

  const [shifts, tutors, requests] = await Promise.all([
    getTutorSwappableShifts(profile.id),
    getActiveTutorsExcept(profile.id),
    getTutorSwapRequests(profile.id),
  ]);

  return (
    <div className="space-y-5">
      <TutorRequestsNav />

      {/* ネイビー hero (#130/#131/#132/#133 と統一) */}
      <section className="rounded-xl bg-primary p-4 text-primary-foreground">
        <h1 className="text-xl font-bold">交代申請</h1>
        <p className="mt-1 text-xs text-primary-foreground/80">
          確定シフトを別の講師に代わってもらう申請をします。指名するか、代講を募集できます。
        </p>
      </section>

      <SwapPanel shifts={shifts} tutors={tutors} requests={requests} />
    </div>
  );
}
