"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { reportIncident } from "@/lib/incident";
import {
  classifyVerifyError,
  parseEmailLink,
  type EmailLink,
  type VerifyFailure,
} from "@/lib/invite-link";

/**
 * 招待リンク・パスワード再設定リンク (#268) を確かめてセッションを作る (#264)。
 *
 * ⚠️ **ページを開いただけでは呼ばない**。どちらのリンクも 1 回しか使えず、
 * メールのセキュリティ製品 (Outlook の Safe Links など) はリンクを先に GET する。
 * GET で verifyOtp すると、本人が開く前にリンクが使い切られる。
 * ボタン (POST) を押したときだけ確かめる。
 *
 * セッション cookie は `verifyOtp` の中で書かれる (`lib/supabase/server.ts` の
 * setAll)。server action からなので cookies() への書き込みは有効。
 */
export async function verifyEmailLink(formData: FormData) {
  const link = parseEmailLink({
    token_hash: formData.get("token_hash"),
    type: formData.get("type"),
  });
  if (!link) redirect(failurePath("invalid"));

  let failure: VerifyFailure | null = null;
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      type: link.type,
      token_hash: link.tokenHash,
    });
    if (error) {
      failure = classifyVerifyError(error);
      if (failure === "unavailable") reportIncident("verify-email-link", error);
    }
  } catch (e) {
    // auth-js は AuthError 以外をそのまま throw する。判定できていないので
    // リンクは使える側に倒す (invalid にすると、押し直せば通る人に再送させてしまう)
    failure = "unavailable";
    reportIncident("verify-email-link", e);
  }

  // redirect() は例外で抜けるので try の外で呼ぶ
  if (failure) redirect(failurePath(failure, link));
  redirect("/auth/set-password");
}

function failurePath(failure: VerifyFailure, link?: EmailLink): string {
  const params = new URLSearchParams({ error: failure });
  if (link) {
    // 失敗画面の文言を招待・再設定で出し分けるため、type は常に残す
    params.set("type", link.type);
    // 到達不能ならリンクはまだ使えるので、押し直せるように残す
    if (failure === "unavailable") params.set("token_hash", link.tokenHash);
  }
  return `/auth/confirm?${params}`;
}
