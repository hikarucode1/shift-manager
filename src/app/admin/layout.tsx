import { headers } from "next/headers";
import { requireRole } from "@/lib/auth";
import { AdminShell } from "@/components/admin-shell";

const nav = [
  { href: "/admin", label: "ダッシュボード" },
  { href: "/admin/tutors", label: "講師管理" },
  { href: "/admin/admins", label: "教室長管理" },
  { href: "/admin/periods", label: "講習期間" },
  { href: "/admin/submission-periods", label: "月別提出期間" },
  { href: "/admin/regular-periods", label: "レギュラー期間" },
  { href: "/admin/fixed-shifts", label: "固定シフト俯瞰" },
  { href: "/admin/training", label: "講習希望" },
  { href: "/admin/uploads", label: "Excel取り込み" },
  { href: "/admin/weekly", label: "週次シフト" },
  { href: "/admin/requests", label: "申請承認" },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile } = await requireRole("admin");
  const h = await headers();
  const pathname = h.get("x-pathname") ?? undefined;

  return (
    <AdminShell profile={profile} nav={nav} currentPath={pathname}>
      {children}
    </AdminShell>
  );
}
