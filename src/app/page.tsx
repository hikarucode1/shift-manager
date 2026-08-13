import { redirect, unstable_rethrow } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile, landingPath } from "@/lib/auth";
import { reportIncident } from "@/lib/incident";
import { SystemUnavailable } from "@/components/system-unavailable";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // #188: ここは layout の外なので TutorLayout/AdminLayout のガードが効かない。
  // 素通しにすると DB 障害中に素の 500 になり、しかも到達経路が 2 つある:
  //   - AdminShell のロゴが <Link href="/">
  //   - login-form が サインイン成功後に router.replace("/")
  // = 障害に気づいたユーザーが再ログインすると必ずここへ来る。
  let profile: Awaited<ReturnType<typeof getProfile>>;
  try {
    profile = await getProfile(user.id);
  } catch (e) {
    unstable_rethrow(e);
    const incidentId = reportIncident("root-page", e);
    // この時点ではロールが分からない。利用者の大半は講師なので教室長宛にする
    // (教室長本人が見た場合は自分宛になるが、実害は無い)。
    return <SystemUnavailable contactLabel="教室長" incidentId={incidentId} />;
  }

  if (!profile) redirect("/login");

  redirect(landingPath(profile));
}
