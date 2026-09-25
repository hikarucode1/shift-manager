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
 * DB 側の前提を満たさない相手には Supabase を呼ぶ前に断る。
 * 無効化した講師に送り直すと、ログインできないアカウントのパスワードを決めさせることになる。
 */
export function resendRefusal(
  target:
    | { roles: string[]; authUserId: string | null; isActive: boolean }
    | undefined,
): string | null {
  if (!target) return "対象の講師が見つかりません。";
  if (!target.roles.includes("tutor")) return "講師以外には再送できません。";
  if (!target.authUserId) {
    return "この講師はまだ招待していません。「ログイン連携」から招待してください。";
  }
  if (!target.isActive) {
    return "無効な講師には再送できません。先に有効化してください。";
  }
  return null;
}

/** DB のメールと auth 側のメールが同じ宛先か (GoTrue は小文字で保存する) */
export function sameEmail(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export const ALREADY_ACCEPTED =
  "この講師は招待を受け取り済みのため、再送できません。";

/** getUserById / inviteUserByEmail の失敗を、教室長が次に何をすればよいかの文にする */
export function resendErrorMessage(error: unknown): string {
  // ⚠️ isAuthUnavailable より先に見る。429 は isAuthUnavailable でも true に
  // なるが、メール送信の上限は「待てば直る」と具体的に言えるので分けて伝える。
  if (isAuthError(error)) {
    switch (error.code) {
      // 確認済みかを読んだ後に講師がリンクを使った場合もここに来る
      case "email_exists":
        return ALREADY_ACCEPTED;
      case "over_email_send_rate_limit":
      case "over_request_rate_limit":
        return "短時間に招待を送りすぎました。時間をおいて再度お試しください。";
      case "user_not_found":
        return "この講師のログインアカウントが見つかりません。";
    }
  }
  if (isAuthUnavailable(error)) {
    return "現在招待を送れません。時間をおいて再度お試しください。";
  }
  return "招待を再送できませんでした。時間をおいて再度お試しください。";
}
