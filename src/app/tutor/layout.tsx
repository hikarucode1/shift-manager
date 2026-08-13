import { unstable_rethrow } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { reportIncident } from "@/lib/incident";
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
  let session: Awaited<ReturnType<typeof requireRole>>;
  try {
    session = await requireRole("tutor");
  } catch (e) {
    // 未ログイン/権限不足の redirect() を握り潰さない (飲み込むと権限バイパス)。
    // unstable_rethrow は error.cause を再帰的に辿るので、drizzle の
    // DrizzleQueryError に包まれた制御フロー例外も取りこぼさない。
    unstable_rethrow(e);
    const incidentId = reportIncident("tutor-layout", e);
    return <SystemUnavailable contactLabel="教室長" incidentId={incidentId} />;
  }

  return <TutorShell profile={session.profile}>{children}</TutorShell>;
}
