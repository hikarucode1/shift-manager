"use server";

import { getProfile, hasRole } from "@/lib/auth";
import { getUnreadCount, markAllRead } from "@/lib/notifications";
import { createClient } from "@/lib/supabase/server";

/**
 * ベルの未読バッジ用 (NotificationBell がバックグラウンドでポーリングする)。
 * requireRole は未認証時に redirect() し、server action の redirect は
 * クライアント側でナビゲーションとして実行されるため、ポーリングから呼ぶと
 * セッション失効時に入力中の画面から強制遷移してしまう (PR #168 レビュー指摘)。
 * ここでは redirect せず 0 を返す。
 */
export async function getUnreadCountAction(): Promise<number> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return 0;
  const profile = await getProfile(user.id);
  if (!profile || !profile.isActive || !hasRole(profile, "tutor")) return 0;
  return getUnreadCount(profile.id);
}

/** 一覧を開いたときに本人の未読を全件既読化する */
export async function markAllReadAction(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  const profile = await getProfile(user.id);
  if (!profile || !profile.isActive || !hasRole(profile, "tutor")) return;
  await markAllRead(profile.id);
}
