import { headers } from "next/headers";
import { requireRole } from "@/lib/auth";
import { TutorShell } from "@/components/tutor-shell";

export default async function TutorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile } = await requireRole("tutor");
  const h = await headers();
  const pathname = h.get("x-pathname") ?? undefined;

  return (
    <TutorShell profile={profile} currentPath={pathname}>
      {children}
    </TutorShell>
  );
}
