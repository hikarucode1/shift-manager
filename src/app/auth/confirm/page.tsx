import Link from "next/link";
import { Button } from "@/components/ui/button";
import { parseInviteLink } from "@/lib/invite-link";
import { AuthAlert, AuthCard } from "../auth-card";
import { verifyInvite } from "./actions";

/**
 * 招待メールのリンクの着地点 (#264)。
 * リンクは `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite`
 * (テンプレートは docs/supabase/email-templates/invite.html)。
 *
 * ここでは何も確かめない。ボタンを押したら verifyInvite が確かめる
 * (理由は actions.ts)。
 */
export default async function ConfirmInvitePage({
  searchParams,
}: {
  searchParams: Promise<{
    token_hash?: string | string[];
    type?: string | string[];
    error?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const link = parseInviteLink(params);

  if (params.error === "invalid" || !link) {
    return (
      <AuthCard title="招待リンクを使えません">
        <AuthAlert>
          リンクの有効期限が切れているか、既に使われています。
          教室長に招待の再送を依頼してください。
        </AuthAlert>
        <p className="text-center text-sm text-muted-foreground">
          パスワードを設定済みの方は
          <Link href="/login" className="underline underline-offset-4">
            ログイン
          </Link>
          してください。
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="ようこそ">
      {params.error === "unavailable" && (
        <AuthAlert>
          現在確認できません。時間をおいてもう一度押してください。
          解消しない場合は教室長にご連絡ください。
        </AuthAlert>
      )}
      <p className="text-sm">
        教室長から招待が届いています。ボタンを押して、ログインに使うパスワードを決めてください。
      </p>
      <form action={verifyInvite}>
        <input type="hidden" name="token_hash" value={link.tokenHash} />
        <input type="hidden" name="type" value={link.type} />
        <Button type="submit" className="w-full">
          パスワードの設定へ進む
        </Button>
      </form>
    </AuthCard>
  );
}
