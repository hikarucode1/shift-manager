import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { getTutorSwapRequests } from "@/lib/swaps";
import { TutorRequestsNav } from "@/components/tutor-requests-nav";
import { SwapPanel } from "./swap-panel";

export default async function TutorSwapsPage() {
  const { profile } = await requireRole("tutor");
  const requests = await getTutorSwapRequests(profile.id);

  return (
    <div className="space-y-5">
      <TutorRequestsNav />

      {/* ネイビー hero (#130/#131/#132/#133 と統一) */}
      <section className="rounded-xl bg-primary p-4 text-primary-foreground">
        <h1 className="text-xl font-bold">交代申請</h1>
        {/* #331 (2026/11/17): 講師が自分で相手を選ぶ交代申請はやめた。
            ここは今までの交代・代講の記録だけを見る画面 */}
        <p className="mt-1 text-xs text-primary-foreground/80">
          交代の相手は教室長が決めます。休むときは
          <Link href="/tutor/absences" className="underline underline-offset-2">
            欠勤申請
          </Link>
          をしてください。教室長が相手を指定したら、欠勤申請の画面からその人に依頼できます。
        </p>
      </section>

      <SwapPanel requests={requests} />
    </div>
  );
}
