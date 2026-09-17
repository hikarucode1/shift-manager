"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { reportIncident } from "@/lib/incident";
import {
  classifyVerifyError,
  parseInviteLink,
  type VerifyFailure,
} from "@/lib/invite-link";

/**
 * 招待リンクを確かめてセッションを作る (#264)。
 *
 * ⚠️ **ページを開いただけでは呼ばない**。招待リンクは 1 回しか使えず、
 * メールのセキュリティ製品 (Outlook の Safe Links など) はリンクを先に GET する。
 * GET で verifyOtp すると、本人が開く前にリンクが使い切られる。
 * ボタン (POST) を押したときだけ確かめる。
 *
 * セッション cookie は `verifyOtp` の中で書かれる (`lib/supabase/server.ts` の
 * setAll)。server action からなので cookies() への書き込みは有効。
 */
export async function verifyInvite(formData: FormData) {
  const link = parseInviteLink({
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
      if (failure === "unavailable") reportIncident("verify-invite", error);
    }
  } catch (e) {
    // auth-js は AuthError 以外をそのまま throw する。判定できていないので
    // リンクは使える側に倒す (invalid にすると、押し直せば通る人に再送させてしまう)
    failure = "unavailable";
    reportIncident("verify-invite", e);
  }

  // redirect() は例外で抜けるので try の外で呼ぶ
  if (failure) redirect(failurePath(failure, link.tokenHash));
  redirect("/auth/set-password");
}

function failurePath(failure: VerifyFailure, tokenHash?: string): string {
  const params = new URLSearchParams({ error: failure });
  // 到達不能ならリンクはまだ使えるので、押し直せるように残す
  if (failure === "unavailable" && tokenHash) {
    params.set("token_hash", tokenHash);
    params.set("type", "invite");
  }
  return `/auth/confirm?${params}`;
}
