import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile, landingPath } from "@/lib/auth";
import { LoginForm } from "./login-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string; error?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const profile = await getProfile(user.id);
    if (profile?.isActive) {
      redirect(landingPath(profile));
    }
  }

  const { reason, error } = await searchParams;
  const message =
    reason === "inactive"
      ? "アカウントが無効化されています。教室長にお問い合わせください。"
      : error === "invalid"
        ? "メールアドレスまたはパスワードが違います。"
        : null;

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Shift Manager</CardTitle>
          <CardDescription>シフト管理</CardDescription>
        </CardHeader>
        <CardContent>
          {message && (
            <div
              role="alert"
              className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {message}
            </div>
          )}
          <LoginForm />
        </CardContent>
      </Card>
    </main>
  );
}
