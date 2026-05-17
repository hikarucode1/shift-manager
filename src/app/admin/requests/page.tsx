import { requireRole } from "@/lib/auth";
import { getPendingAbsenceRequests } from "@/lib/absences";
import { RequestsPanel } from "./requests-panel";

export default async function AdminRequestsPage() {
  await requireRole("admin");

  const pending = await getPendingAbsenceRequests();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">申請承認</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          講師からの欠勤申請を承認 / 却下します。
        </p>
      </div>
      <RequestsPanel pending={pending} />
    </div>
  );
}
