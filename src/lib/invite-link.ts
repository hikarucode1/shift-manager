import {
  isAuthError,
  isAuthSessionMissingError,
} from "@supabase/supabase-js";
import { isAuthUnavailable } from "@/lib/auth-availability";

/**
 * 招待リンク → パスワード設定 (#264) の判定をまとめる。
 * 画面と server action から分けてあるのはテストを掛けるため。
 *
 * 流れ:
 *   招待メール `{{ .SiteURL }}/auth/confirm?token_hash=...&type=invite`
 *   → /auth/confirm でボタンを押す → verifyOtp でセッションを作る
 *   → /auth/set-password で updateUser({ password })
 */

/**
 * 受け付ける type は invite だけ。
 * recovery (パスワード再設定) や magiclink を通すと、このアプリが用意していない
 * ログイン経路が URL を書き換えるだけで開いてしまう。足すときは発行側と一緒に足す。
 */
export type InviteLink = { tokenHash: string; type: "invite" };

export function parseInviteLink(params: {
  token_hash?: unknown;
  type?: unknown;
}): InviteLink | null {
  const { token_hash: tokenHash, type } = params;
  if (type !== "invite") return null;
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

const SESSION_GONE =
  "ログインの有効期限が切れました。招待メールのリンクは使用済みのため、教室長に招待の再送を依頼してください。";

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
