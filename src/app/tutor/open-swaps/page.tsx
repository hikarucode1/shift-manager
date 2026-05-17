import { requireRole } from "@/lib/auth";
import { getOpenSwapsForTutor } from "@/lib/swaps";
import { OpenSwapList } from "./open-swap-list";

export default async function TutorOpenSwapsPage() {
  const { profile } = await requireRole("tutor");
  const swaps = await getOpenSwapsForTutor(profile.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">代講募集</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          他の講師の交代募集に応募できます。教室長が応募者から代講者を選びます。
        </p>
      </div>
      <OpenSwapList swaps={swaps} />
    </div>
  );
}
