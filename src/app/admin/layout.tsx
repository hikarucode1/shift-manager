import { requireRole } from "@/lib/auth";
import { AdminShell } from "@/components/admin-shell";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile } = await requireRole("admin");

  return <AdminShell profile={profile}>{children}</AdminShell>;
}
