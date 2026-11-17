"use server";

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { requireSession } from "@/lib/auth";
import { db } from "@/db/client";
import { pushSubscriptions } from "@/db/schema";
import { sendPushToProfiles } from "@/lib/web-push";

/**
 * #318: スマホ通知 (Web Push) の ON / OFF。端末ごとに 1 行。
 * 講師・教室長どちらの画面からも呼ぶので、役割は問わずログインだけ見る。
 */

type ActionResult = { ok: true } | { ok: false; error: string };

const SubscriptionInput = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({
    p256dh: z.string().min(1).max(500),
    auth: z.string().min(1).max(500),
  }),
  userAgent: z.string().max(500).optional(),
  /** ON にした直後だけ true。画面を開くたびの付け直しでは送らない */
  sendTest: z.boolean().optional(),
});

export async function savePushSubscription(
  input: unknown,
): Promise<ActionResult> {
  const { profile } = await requireSession();
  const parsed = SubscriptionInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "入力が不正です。" };
  const { endpoint, keys, userAgent, sendTest } = parsed.data;
  try {
    // 同じ端末で別の人がログインし直した場合も、今の人の宛先に付け替える
    await db
      .insert(pushSubscriptions)
      .values({
        profileId: profile.id,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent: userAgent ?? null,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          profileId: profile.id,
          p256dh: keys.p256dh,
          auth: keys.auth,
          userAgent: userAgent ?? null,
        },
      });
  } catch (e) {
    console.error("savePushSubscription failed", e);
    return {
      ok: false,
      error: "保存に失敗しました。時間をおいてお試しください。",
    };
  }
  // ON にした直後に 1 通送り、届くことを本人が確かめられるようにする
  if (sendTest) {
    await sendPushToProfiles([profile.id], {
      title: "スマホ通知を ON にしました",
      body: "申請の結果やお知らせが、この端末に届きます。",
    });
  }
  return { ok: true };
}

export async function deletePushSubscription(
  input: unknown,
): Promise<ActionResult> {
  const { profile } = await requireSession();
  const parsed = z.object({ endpoint: z.string().max(2000) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "入力が不正です。" };
  try {
    await db
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.endpoint, parsed.data.endpoint),
          eq(pushSubscriptions.profileId, profile.id),
        ),
      );
  } catch (e) {
    console.error("deletePushSubscription failed", e);
    return {
      ok: false,
      error: "解除に失敗しました。時間をおいてお試しください。",
    };
  }
  return { ok: true };
}
