import { requireRole } from "@/lib/auth";
import { TutorShell } from "@/components/tutor-shell";

export default async function TutorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile } = await requireRole("tutor");

  return <TutorShell profile={profile}>{children}</TutorShell>;
}
