import {
  isAuthError,
  isAuthSessionMissingError,
} from "@supabase/supabase-js";
import { isAuthUnavailable } from "@/lib/auth-availability";

/**
 * 招待リンク → パスワード設定 (#264) と、パスワード再設定リンク (#268) の
 * 判定をまとめる。画面と server action から分けてあるのはテストを掛けるため。
 *
 * 流れ (type 以外は同じ):
 *   招待メール     `{{ .SiteURL }}/auth/confirm?token_hash=...&type=invite`
 *   再設定メール   `{{ .SiteURL }}/auth/confirm?token_hash=...&type=recovery`
 *   → /auth/confirm でボタンを押す → verifyOtp でセッションを作る
 *   → /auth/set-password で updateUser({ password })
 */

/**
 * 受け付ける type は、このアプリがメールを送る 2 つだけ。
 * - invite  : 教室長の招待 (inviteTutor / resendInvite)
 * - recovery: 教室長が送るパスワード再設定 (sendPasswordReset, #268)
 * magiclink などを通すと、このアプリが用意していないログイン経路が URL を
 * 書き換えるだけで開いてしまう。足すときは発行側と一緒に足す。
 */
export type EmailLinkType = "invite" | "recovery";
export type EmailLink = { tokenHash: string; type: EmailLinkType };

export function parseEmailLink(params: {
  token_hash?: unknown;
  type?: unknown;
}): EmailLink | null {
  const { token_hash: tokenHash, type } = params;
  if (type !== "invite" && type !== "recovery") return null;
  if (typeof tokenHash !== "string" || tokenHash.trim() === "") return null;
  return { tokenHash, type };
}

/**
 * verifyOtp の失敗の分類。
 * - unavailable: 認証 API が答えられなかった。**リンクはまだ使える**ので押し直せる
 * - invalid: 期限切れ・使用済み・改ざん。押し直しても通らないので再送を頼んでもらう
 */
export type VerifyFailure = "unavailable" | "invalid";

export function classifyVerifyError(error: unknown): VerifyFailure {
  return isAuthUnavailable(error) ? "unavailable" : "invalid";
}

/**
 * GoTrue は bcrypt で保存するため 72 バイトを超えると拒否する。
 * 下限は Supabase の既定 (6) より厳しくしている。
 */
export const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_BYTES = 72;

export function validateNewPassword(
  password: string,
  confirmation: string,
): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `パスワードは${PASSWORD_MIN_LENGTH}文字以上にしてください。`;
  }
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) {
    return "パスワードが長すぎます。短くしてください。";
  }
  if (password !== confirmation) {
    return "確認用のパスワードが一致しません。";
  }
  return null;
}

// 招待・再設定のどちらから来ても、使ったリンクはもう通らない。教室長は
// 状態に応じて招待の再送か再設定メールを送れる (#268) ので、どちらかは言わない
const SESSION_GONE =
  "ログインの有効期限が切れました。メールのリンクは使用済みのため、教室長にメールの再送を依頼してください。";

/** updateUser({ password }) の失敗を、本人が次に何をすればよいかの文にする */
export function passwordUpdateErrorMessage(error: unknown): string {
  if (isAuthUnavailable(error)) {
    return "現在パスワードを保存できません。時間をおいて再度お試しください。解消しない場合は教室長にご連絡ください。";
  }
  // ⚠️ `isAuthApiError` では絞らない。auth-js は weak_password だけ
  // `AuthWeakPasswordError` (AuthApiError ではない) に作り替えるので落ちる。
  // セッションが無いときも `AuthSessionMissingError` で code を持たない。
  if (isAuthSessionMissingError(error)) return SESSION_GONE;
  if (isAuthError(error)) {
    switch (error.code) {
      case "weak_password":
        return "このパスワードは推測されやすいため使えません。別のパスワードにしてください。";
      case "same_password":
        return "今と同じパスワードです。別のパスワードにしてください。";
      case "session_not_found":
      case "session_expired":
        return SESSION_GONE;
    }
  }
  return "パスワードを保存できませんでした。時間をおいて再度お試しください。解消しない場合は教室長にご連絡ください。";
}
