import { unstable_rethrow } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { AdminShell } from "@/components/admin-shell";
import { SystemUnavailable } from "@/components/system-unavailable";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // #188: 理由は tutor/layout.tsx のコメント参照 (DB 全断で layout ごと
  // throw し、管理 11 画面がシェルごと 500 になるのを防ぐ)。
  let session: Awaited<ReturnType<typeof requireRole>>;
  try {
    session = await requireRole("admin");
  } catch (e) {
    unstable_rethrow(e);
    console.error("admin layout: session/profile unavailable", e);
    return <SystemUnavailable contactLabel="開発者" />;
  }

  return <AdminShell profile={session.profile}>{children}</AdminShell>;
}
