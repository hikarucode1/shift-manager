import { headers } from "next/headers";
import { requireRole } from "@/lib/auth";
import { AdminShell } from "@/components/admin-shell";

// #120: 11 項目 → 7 項目。グループは代表ページに着地し、各グループページ上部の
// サブナビ (AdminTutorsNav / AdminPeriodsNav) で内訳を行き来する。
const startsWithAny =
  (roots: string[]) =>
  (p: string | undefined): boolean =>
    roots.some((r) => p === r || (p?.startsWith(r + "/") ?? false));

const nav = [
  { href: "/admin", label: "ダッシュボード", match: (p?: string) => p === "/admin" },
  { href: "/admin/weekly", label: "週次シフト" },
  {
    href: "/admin/tutors",
    label: "講師管理",
    match: startsWithAny(["/admin/tutors", "/admin/admins"]),
  },
  {
    href: "/admin/periods",
    label: "期間管理",
    match: startsWithAny([
      "/admin/periods",
      "/admin/submission-periods",
      "/admin/regular-periods",
      "/admin/fixed-shifts",
    ]),
  },
  { href: "/admin/training", label: "講習希望" },
  { href: "/admin/uploads", label: "Excel取り込み" },
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
