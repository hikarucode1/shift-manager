"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { landingPath, requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { reportIncident } from "@/lib/incident";
import {
  passwordUpdateErrorMessage,
  validateNewPassword,
} from "@/lib/invite-link";

export type SetPasswordState = { error: string } | null;

/**
 * ログイン中の本人のパスワードを決める (#264)。
 * 招待リンクから来た講師は、verifyInvite が作ったセッションでここに着く。
 */
export async function setPassword(
  _prev: SetPasswordState,
  formData: FormData,
): Promise<SetPasswordState> {
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");

  const invalid = validateNewPassword(password, confirmation);
  if (invalid) return { error: invalid };

  let destination: string;
  try {
    // 未ログイン・無効化済みなら /login へ redirect (unstable_rethrow で通す)
    const { profile } = await requireSession();

    const supabase = await createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      reportIncident("set-password", error);
      return { error: passwordUpdateErrorMessage(error) };
    }
    destination = landingPath(profile);
  } catch (e) {
    unstable_rethrow(e);
    // requireSession の到達不能 (AuthUnavailableError) や DB 障害
    reportIncident("set-password", e);
    return { error: passwordUpdateErrorMessage(e) };
  }

  redirect(destination);
}
