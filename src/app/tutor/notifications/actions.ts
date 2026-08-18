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
 *
 * ⚠️ **ここだけは意図的に「認証 API に到達できない」と「未ログイン」を同一視する**
 * (#193 で他の経路は `lib/auth-availability.ts` の `readAuthUser` に寄せた)。
 * 障害中はバッジが黙って 0 に落ち、markAllRead は no-op になる。fail-closed
 * なので実害は無いが、**バッジの 0 は通知機能の生死の証拠にならない** という
 * 既知の穴 (#191) をここでも増やしている。直すなら #191 と一緒に。
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
