import { requireRole } from "@/lib/auth";
import { getPendingAbsenceRequests } from "@/lib/absences";
import { getPendingSwapRequests } from "@/lib/swaps";
import { RequestsPanel } from "./requests-panel";
import { SwapRequestsPanel } from "./swap-requests-panel";

export default async function AdminRequestsPage() {
  await requireRole("admin");

  const [pendingAbsences, pendingSwaps] = await Promise.all([
    getPendingAbsenceRequests(),
    getPendingSwapRequests(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">申請承認</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          講師からの欠勤申請・交代申請を承認 / 却下します。
        </p>
      </div>
      <SwapRequestsPanel pending={pendingSwaps} />
      <RequestsPanel pending={pendingAbsences} />
    </div>
  );
}
