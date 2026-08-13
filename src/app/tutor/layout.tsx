import { requireRole } from "@/lib/auth";
import { resolveOrIncident } from "@/lib/shell-guard";
import { TutorShell } from "@/components/tutor-shell";
import { SystemUnavailable } from "@/components/system-unavailable";

export default async function TutorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // #188: requireRole() → getProfile() は drizzle で profiles を引くので、
  // DB に到達できないとここで throw する。layout の例外は同セグメントの
  // error.tsx では捕捉されず (loading.tsx があっても 500)、講師 7 画面すべてが
  // シェルごと消える。投げさせずに fallback を返してそれを防ぐ。
  // 認可の redirect() を握り潰さない保証は resolveOrIncident 側 (テスト済み)。
  const session = await resolveOrIncident("tutor-layout", () =>
    requireRole("tutor"),
  );

  if (!session.ok) {
    return (
      <SystemUnavailable contactLabel="教室長" incidentId={session.incidentId} />
    );
  }

  return <TutorShell profile={session.value.profile}>{children}</TutorShell>;
}
