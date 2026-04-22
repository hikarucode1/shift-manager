import { headers } from "next/headers";
import { requireRole } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";

const nav = [
  { href: "/tutor", label: "ホーム" },
  { href: "/tutor/fixed-shifts", label: "固定シフト" },
  { href: "/tutor/training", label: "講習希望" },
  { href: "/tutor/absences", label: "欠勤申請" },
  { href: "/tutor/swaps", label: "交代申請" },
  { href: "/tutor/open-swaps", label: "代講募集" },
];

export default async function TutorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile } = await requireRole("tutor");
  const h = await headers();
  const pathname = h.get("x-pathname") ?? undefined;

  return (
    <AppShell profile={profile} nav={nav} currentPath={pathname}>
      {children}
    </AppShell>
  );
}
