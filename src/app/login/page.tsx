import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile, landingPath } from "@/lib/auth";
import { LoginForm } from "./login-form";
import { Card, CardContent } from "@/components/ui/card";

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
    <main className="flex flex-1 items-center justify-center bg-muted p-6">
      <Card className="w-full max-w-[360px] rounded-xl shadow-sm">
        <CardContent className="space-y-6 p-8">
          {/* ロゴ + タイトル */}
          <div className="flex flex-col items-center gap-2 text-center">
            <div
              className="flex size-[46px] items-center justify-center rounded-xl bg-primary text-xl font-bold text-primary-foreground"
              aria-hidden
            >
              S
            </div>
            <div>
              <h1 className="text-lg font-semibold leading-tight">
                Shift Manager
              </h1>
              <p className="text-sm text-muted-foreground">
                個別指導塾シフト管理
              </p>
            </div>
          </div>

          {message && (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {message}
            </div>
          )}

          <LoginForm />

          <p className="text-center text-xs text-muted-foreground">
            パスワードをお忘れの場合は教室長にお問い合わせください。
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
