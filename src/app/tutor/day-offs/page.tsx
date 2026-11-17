import { requireRole } from "@/lib/auth";
import { firstDayOffDate, getTutorDayOffs } from "@/lib/day-offs";
import { getSlotMeta, slotNumbers } from "@/lib/slot-meta";
import { jstToday } from "@/lib/week";
import { TutorRequestsNav } from "@/components/tutor-requests-nav";
import { DayOffPanel } from "./day-off-panel";

/** #360: まだシフトが出ていない先の日の休み希望 */
export default async function TutorDayOffsPage() {
  const { profile } = await requireRole("tutor");
  const today = jstToday();
  const [first, history, meta] = await Promise.all([
    firstDayOffDate(today),
    getTutorDayOffs(profile.id, today),
    getSlotMeta(),
  ]);

  return (
    <div className="space-y-5">
      <TutorRequestsNav />

      <section className="rounded-xl bg-primary p-4 text-primary-foreground">
        <h1 className="text-xl font-bold">休み希望</h1>
        <p className="mt-1 text-xs text-primary-foreground/80">
          まだシフトが出ていない先の日に「この日は休みたい」を伝えます。教室長が承認すると、シフトを作るときに外してもらえます。
        </p>
      </section>

      <DayOffPanel
        firstDate={first}
        slots={slotNumbers(meta).map((n) => ({
          slotNumber: n,
          label: meta.get(n)?.label ?? `${n}限`,
        }))}
        history={history}
      />
    </div>
  );
}
