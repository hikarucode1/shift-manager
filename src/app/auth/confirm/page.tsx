import Link from "next/link";
import { parseInviteLink } from "@/lib/invite-link";
import { readAuthUser } from "@/lib/auth-availability";
import { createClient } from "@/lib/supabase/server";
import { AuthAlert, AuthCard } from "../auth-card";
import { verifyInvite } from "./actions";
import { ConfirmSubmitButton } from "./submit-button";

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
    // ボタンを押した後 (= リンクは使用済み・セッションはある) にパスワードを
    // 決めずに離れた講師が、同じリンクを開き直すとここに来る。パスワードが
    // 無いので「ログインしてください」では戻れない。セッションが残っていれば
    // 設定画面へ案内する。
    if (await hasSession()) {
      return (
        <AuthCard title="パスワードの設定">
          <p className="text-sm">
            招待の確認は済んでいます。まだパスワードを決めていない場合は、続けて設定してください。
          </p>
          <Link
            href="/auth/set-password"
            className="block text-center text-sm underline underline-offset-4"
          >
            パスワードを設定する
          </Link>
        </AuthCard>
      );
    }
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
        <ConfirmSubmitButton />
      </form>
    </AuthCard>
  );
}

/**
 * 案内を出し分けるためだけに見る。認証 API に届かない・cookie が壊れている
 * 場合は「セッション無し」に倒す (どちらでも本来の失敗画面が出るだけで、
 * ここを理由に SystemUnavailable にはしない)。
 */
async function hasSession(): Promise<boolean> {
  try {
    const read = await readAuthUser(await createClient());
    return read.reachable && read.user !== null;
  } catch {
    return false;
  }
}
