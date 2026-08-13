import { requireRole } from "@/lib/auth";
import { resolveOrIncident } from "@/lib/shell-guard";
import { AdminShell } from "@/components/admin-shell";
import { SystemUnavailable } from "@/components/system-unavailable";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // #188: 理由は tutor/layout.tsx のコメント参照 (DB 全断で layout ごと
  // throw し、管理 11 画面がシェルごと 500 になるのを防ぐ)。
  const session = await resolveOrIncident("admin-layout", () =>
    requireRole("admin"),
  );

  if (!session.ok) {
    return (
      <SystemUnavailable contactLabel="開発者" incidentId={session.incidentId} />
    );
  }

  return <AdminShell profile={session.value.profile}>{children}</AdminShell>;
}
