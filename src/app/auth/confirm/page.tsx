import Link from "next/link";
import { parseEmailLink } from "@/lib/invite-link";
import { readAuthUser } from "@/lib/auth-availability";
import { createClient } from "@/lib/supabase/server";
import { AuthAlert, AuthCard } from "../auth-card";
import { verifyEmailLink } from "./actions";
import { ConfirmSubmitButton } from "./submit-button";

/**
 * 招待メール (#264) とパスワード再設定メール (#268) のリンクの着地点。
 * リンクは `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite`
 * (再設定は `type=recovery`)。テンプレートは docs/supabase/email-templates/
 * の invite.html / recovery.html。
 *
 * ここでは何も確かめない。ボタンを押したら verifyEmailLink が確かめる
 * (理由は actions.ts)。
 */
export default async function ConfirmEmailLinkPage({
  searchParams,
}: {
  searchParams: Promise<{
    token_hash?: string | string[];
    type?: string | string[];
    error?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const link = parseEmailLink(params);
  const isRecovery = params.type === "recovery";

  if (params.error === "invalid" || !link) {
    // ボタンを押した後 (= リンクは使用済み・セッションはある) にパスワードを
    // 決めずに離れた講師が、同じリンクを開き直すとここに来る。パスワードが
    // 無いので「ログインしてください」では戻れない。セッションが残っていれば
    // 設定画面へも案内する。
    // ⚠️ 「確認は済んでいます」とは言わない。期限切れのリンクでも来るし、
    // 共用 PC なら残っているのは**別の人** (教室長など) のセッションかもしれない。
    // そのまま設定へ進めると他人のパスワードを変えてしまうので、誰として
    // ログインしているかを見せて本人に判断してもらう。
    const sessionEmail = await currentSessionEmail();
    return (
      <AuthCard title="リンクを使えません">
        <AuthAlert>
          リンクの有効期限が切れているか、既に使われています。
          {isRecovery
            ? "教室長にパスワード再設定メールの再送を依頼してください。"
            : "教室長に招待の再送を依頼してください。"}
        </AuthAlert>
        {sessionEmail ? (
          <div className="space-y-2 text-sm">
            <p>
              現在 <span className="font-medium">{sessionEmail}</span>{" "}
              としてログインしています。ご自身のアカウントで、まだパスワードを決めていない場合は、続けて設定できます。
            </p>
            <Link
              href="/auth/set-password"
              className="block text-center underline underline-offset-4"
            >
              パスワードを設定する
            </Link>
          </div>
        ) : (
          <p className="text-center text-sm text-muted-foreground">
            パスワードを設定済みの方は
            <Link href="/login" className="underline underline-offset-4">
              ログイン
            </Link>
            してください。
          </p>
        )}
      </AuthCard>
    );
  }

  return (
    <AuthCard title={isRecovery ? "パスワードの再設定" : "ようこそ"}>
      {params.error === "unavailable" && (
        <AuthAlert>
          現在確認できません。時間をおいてもう一度押してください。
          解消しない場合は教室長にご連絡ください。
        </AuthAlert>
      )}
      <p className="text-sm">
        {isRecovery
          ? "ボタンを押して、新しいパスワードを決めてください。"
          : "教室長から招待が届いています。ボタンを押して、ログインに使うパスワードを決めてください。"}
      </p>
      <form action={verifyEmailLink}>
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
async function currentSessionEmail(): Promise<string | null> {
  try {
    const read = await readAuthUser(await createClient());
    return (read.reachable && read.user?.email) || null;
  } catch {
    return null;
  }
}
