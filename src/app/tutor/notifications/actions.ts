"use server";

import { getProfile, hasRole } from "@/lib/auth";
import { readAuthUser } from "@/lib/auth-availability";
import { getUnreadCount, markAllRead } from "@/lib/notifications";
import { createClient } from "@/lib/supabase/server";

/** 取得できた (0 件を含む) か、取得できなかったか (#207) */
export type UnreadCountResult = { ok: true; count: number } | { ok: false };

/**
 * ベルの未読バッジ用 (NotificationBell がバックグラウンドでポーリングする)。
 *
 * ⚠️ **redirect しないこと**。`requireRole` は未認証時に `redirect()` し、
 * server action の redirect はクライアント側でナビゲーションとして実行されるため、
 * ポーリングから呼ぶとセッション失効時に入力中の画面から強制遷移してしまう
 * (PR #168 レビュー指摘)。ここが `requireRole` を使わず素で書かれているのはこのため。
 *
 * ⚠️ **失敗を 0 として返さないこと** (#207)。以前は `getUser()` の error を捨てて
 * `!user` で 0 を返しており、認証 API が落ちている間ベルは自信満々に「未読なし」を
 * 表示していた。2026-07-30 の障害が 9 日間気づかれなかった理由の 1 つ目がこれ。
 * 「到達できないので分からない」と「本当に 0 件」は呼び出し側に区別させる。
 */
export async function getUnreadCountAction(): Promise<UnreadCountResult> {
  try {
    const supabase = await createClient();
    const read = await readAuthUser(supabase);

    // 認証 API に到達できない = 未読数は「分からない」。0 ではない
    if (!read.reachable) return { ok: false };

    // 到達できていて未ログイン / 非 tutor / 無効は、本当に出すものが無い
    if (!read.user) return { ok: true, count: 0 };
    const profile = await getProfile(read.user.id);
    if (!profile || !profile.isActive || !hasRole(profile, "tutor")) {
      return { ok: true, count: 0 };
    }

    return { ok: true, count: await getUnreadCount(profile.id) };
  } catch (e) {
    // DB 障害・壊れた cookie など。ここも 0 に潰さない
    console.error("getUnreadCountAction failed:", e);
    return { ok: false };
  }
}

/** 一覧を開いたときに本人の未読を全件既読化する */
export async function markAllReadAction(): Promise<void> {
  const supabase = await createClient();
  const read = await readAuthUser(supabase);

  // #207: 判別だけは通す。到達不能なら既読化を試みない (未ログイン扱いで
  // 黙って no-op すると、復帰後に「既読にしたはずが未読のまま」になる)。
  // 画面の振る舞いは変えない — 失敗は「バッジが消えない」として現れ、
  // ベル側 (#207) を直したことでそこは観測できるようになった。
  if (!read.reachable || !read.user) return;
  const user = read.user;
  const profile = await getProfile(user.id);
  if (!profile || !profile.isActive || !hasRole(profile, "tutor")) return;
  await markAllRead(profile.id);
}
