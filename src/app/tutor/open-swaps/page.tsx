import { requireRole } from "@/lib/auth";
import { getOpenSwapsForTutor, getTutorApplications } from "@/lib/swaps";
import { TutorRequestsNav } from "@/components/tutor-requests-nav";
import { OpenSwapList } from "./open-swap-list";
import { MyApplications } from "./my-applications";

export default async function TutorOpenSwapsPage() {
  const { profile } = await requireRole("tutor");
  const [swaps, applications] = await Promise.all([
    getOpenSwapsForTutor(profile.id),
    // #245: 応募者向け通知の着地先。これが無いと決定済みの募集は
    // どこにも出ず、応募がどうなったか分からない
    getTutorApplications(profile.id),
  ]);
    // #178: 過去日は応募できないので「応募できる募集」に数えない。終了しただけの
  // 同日コマは応募できる (実際に代わった人が記録を残す経路) ので数える。
  const openCount = swaps.filter((s) => !s.applied && !s.isPastDate).length;

  return (
    <div className="space-y-5">
      <TutorRequestsNav />

      {/* ネイビー hero: 応募できる募集 N 件 (#130/#131/#132/#133 と統一) */}
      <section className="rounded-xl bg-primary p-4 text-primary-foreground">
        <h1 className="text-xl font-bold">代講募集</h1>
        <p className="mt-1 text-sm">
          <span className="text-primary-foreground/70">応募できる募集 </span>
          <span className="font-semibold text-accent">{openCount} 件</span>
        </p>
        <p className="mt-1 text-xs text-primary-foreground/80">
          他の講師の交代募集に応募できます。教室長が応募者から代講者を選びます。
        </p>
      </section>

      <OpenSwapList swaps={swaps} />

      <MyApplications applications={applications} />
    </div>
  );
}
