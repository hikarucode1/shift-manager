import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { getUserOrThrow } from "@/lib/auth-availability";
import { resolveOrIncident } from "@/lib/shell-guard";
import { SystemUnavailable } from "@/components/system-unavailable";
import { AuthCard } from "../auth-card";
import { SetPasswordForm } from "./set-password-form";

/**
 * パスワードを決める画面 (#264)。招待リンク → /auth/confirm の次に来る。
 *
 * /auth 配下は layout のガードも error.tsx も無いので、/login と同じく
 * resolveOrIncident で包む (#188)。
 */
export default async function SetPasswordPage() {
  const supabase = await createClient();

  const resolved = await resolveOrIncident("set-password-page", async () => {
    const user = await getUserOrThrow(supabase);
    if (!user) redirect("/login");
    return getProfile(user.id);
  });

  if (!resolved.ok) {
    return (
      <SystemUnavailable
        contactLabel="教室長"
        incidentId={resolved.incidentId}
      />
    );
  }

  const profile = resolved.value;
  if (!profile?.isActive) redirect("/login?reason=inactive");

  return (
    <AuthCard title="パスワードの設定">
      <p className="text-sm">
        {profile.displayName} さん、次回からのログインに使うパスワードを決めてください。
      </p>
      <SetPasswordForm email={profile.email} />
    </AuthCard>
  );
}
