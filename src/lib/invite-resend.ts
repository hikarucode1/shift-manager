import { isAuthError } from "@supabase/supabase-js";
import { isAuthUnavailable } from "@/lib/auth-availability";

/**
 * 招待の再送 (#265) の判定をまとめる。server action と一覧画面から分けてあるのは
 * テストを掛けるため。
 *
 * 再送は `inviteUserByEmail` をもう一度呼ぶだけで成り立つ。GoTrue の Invite
 * (`supabase/auth` の `internal/api/invite.go`) は
 * - 同じメールの**未確認**ユーザーがいれば、作り直さずに同じユーザーへ送り直す。
 *   `confirmation_token` が差し替わるので**前に送ったリンクは使えなくなる**
 * - **確認済み**ユーザーには `email_exists` (422) で拒否する
 * 確認済み = `IsConfirmed()` = `email_confirmed_at` か `phone_confirmed_at` がある。
 */

/**
 * - pending : 招待メールをまだ使っていない (再送できる)
 * - accepted: 招待リンクを使った (再送できない)
 * - unknown : 認証 API から読めなかった / 対応する auth ユーザーが無い
 */
export type InviteStatus = "pending" | "accepted" | "unknown";

type ConfirmFields = {
  email_confirmed_at?: string | null;
  phone_confirmed_at?: string | null;
};

/** GoTrue の `IsConfirmed()` と同じ線で読む */
export function isInviteAccepted(user: ConfirmFields): boolean {
  return Boolean(user.email_confirmed_at || user.phone_confirmed_at);
}

export function inviteStatusOf(user: ConfirmFields | undefined): InviteStatus {
  if (!user) return "unknown";
  return isInviteAccepted(user) ? "accepted" : "pending";
}

/**
 * DB 側の前提を満たさない相手には Supabase を呼ぶ前に断る。招待の再送と
 * パスワード再設定メール (#268) で共通。
 * 無効化した講師に送ると、ログインできないアカウントのパスワードを決めさせることになる。
 */
export function mailTargetRefusal(
  target:
    | { roles: string[]; authUserId: string | null; isActive: boolean }
    | undefined,
): string | null {
  if (!target) return "対象の講師が見つかりません。";
  if (!target.roles.includes("tutor")) return "講師以外には送れません。";
  if (!target.authUserId) {
    return "この講師はまだ招待していません。「ログイン連携」から招待してください。";
  }
  if (!target.isActive) {
    return "無効な講師には送れません。先に有効化してください。";
  }
  return null;
}

/** GoTrue と同じ線でメールを比べるための形 (GoTrue は小文字で保存する) */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** DB のメールと auth 側のメールが同じ宛先か */
export function sameEmail(a: string, b: string): boolean {
  return normalizeEmail(a) === normalizeEmail(b);
}

/**
 * 招待しようとしたメールが、既にログイン連携済みの別の profile で使われている (#272)。
 * GoTrue は招待中 (未確認) の同じメールのユーザーをエラーにせず送り直すので、
 * こちらで断らないとその講師のリンクが無効になり、巻き戻しで消えてしまう。
 */
export function emailInUseMessage(ownerName: string): string {
  return `このメールアドレスは既に「${ownerName}」さんのログインに使われています。`;
}

/**
 * 事前確認をすり抜けて GoTrue が既存の講師へ送り直してしまった後 (#272)。
 * 巻き戻しでアカウントは残したが、その講師に前に届いたリンクはもう使えない
 * (confirmation_token が差し替わった) ので、教室長に知らせる。
 */
export function emailInUseAfterResendMessage(ownerName: string): string {
  return `${emailInUseMessage(ownerName)}「${ownerName}」さんへ招待メールが送り直されたため、前に届いたリンクは使えなくなっています。`;
}

export const ALREADY_ACCEPTED =
  "この講師は招待を受け取り済みのため、再送できません。パスワードが分からない場合は「パスワード再設定メール」を送ってください。";

/**
 * 教室長が講師へ送るメール (招待・招待の再送・パスワード再設定) の失敗を、
 * 次に何をすればよいかの文にする。
 * ⚠️ 429 は isAuthUnavailable より先に見る。isAuthUnavailable でも true に
 * なるが、メール送信の上限は「待てば直る」と具体的に言えるので分けて伝える。
 * GoTrue は同じユーザーへのメールを既定で 60 秒に 1 通に絞る。
 */
function mailErrorMessage(
  error: unknown,
  what: "招待" | "再設定メール",
  failed: string,
): string {
  if (isAuthError(error)) {
    switch (error.code) {
      case "over_email_send_rate_limit":
      case "over_request_rate_limit":
        return `短時間に${what}を送りすぎました。時間をおいて再度お試しください。`;
      case "user_not_found":
        return "この講師のログインアカウントが見つかりません。";
      // 宛先ではなくプロジェクトの設定の問題。メールアドレスを疑わせない
      // (Supabase 標準の SMTP はチームメンバー宛てにしか送れない、など)
      case "email_address_not_authorized":
      case "email_provider_disabled":
        return `メールの送信設定の都合で${what}を送れません。Supabase のメール設定を確認してください。`;
    }
    // 手前のプロキシが返す 429 は error_code を持たないことがある
    if (error.status === 429) {
      return `短時間に${what}を送りすぎました。時間をおいて再度お試しください。`;
    }
  }
  if (isAuthUnavailable(error)) {
    return `現在${what}を送れません。時間をおいて再度お試しください。`;
  }
  return `${failed}時間をおいて再度お試しください。`;
}

/**
 * 初めての招待 (inviteTutor) の inviteUserByEmail の失敗 (#269)。
 * 以前はメッセージの正規表現で分けていて、500 や到達不能まで「メールアドレスを
 * 確認」と出ていた。再送と同じく error.code と到達可否で分ける。
 * 分類できないもの (メールアドレスの形式が不正など) は入力を疑うよう伝える。
 */
export function inviteErrorMessage(error: unknown): string {
  // 受け取り済みの講師と同じメール。招待中の講師と同じメールはエラーに
  // ならず、そちらへの再送になるので inviteTutor が招待前に断る (#272)
  if (isAuthError(error) && error.code === "email_exists") {
    return "このメールアドレスは既に登録されています。";
  }
  return mailErrorMessage(
    error,
    "招待",
    "招待に失敗しました。メールアドレスを確認のうえ、",
  );
}

/** getUserById / inviteUserByEmail の失敗 */
export function resendErrorMessage(error: unknown): string {
  // 確認済みかを読んだ後に講師がリンクを使った場合もここに来る
  if (isAuthError(error) && error.code === "email_exists") {
    return ALREADY_ACCEPTED;
  }
  return mailErrorMessage(error, "招待", "招待を再送できませんでした。");
}

/**
 * パスワード再設定メール (#268) は、招待を受け取り済みの講師にだけ送る。
 * 招待中の講師に送っても GoTrue は受け付けて確認済みにしてしまうが、それなら
 * 招待の再送で足りる (届くメールの文面も招待のほうが合っている)。
 */
export const NOT_YET_ACCEPTED =
  "この講師はまだ招待を受け取っていません。「招待を再送」から送り直してください。";

/** getUserById / resetPasswordForEmail の失敗 */
export function resetErrorMessage(error: unknown): string {
  return mailErrorMessage(
    error,
    "再設定メール",
    "再設定メールを送れませんでした。",
  );
}
