import "server-only";
import webpush from "web-push";
import { inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { pushSubscriptions } from "@/db/schema";

/**
 * #318: スマホ通知 (Web Push) の送信。
 *
 * - アプリ内通知 (ベル) が本体で、Push は**おまけのチャネル**。ここで何が
 *   起きても throw しない (通知の作成・本処理を失敗させない)
 * - VAPID 鍵が未設定なら何もしない (ローカル・設定前の本番でもそのまま動く)
 * - Push サービスが 404/410 を返した購読は期限切れなので消す
 */

export type PushPayload = {
  title: string;
  body?: string;
  /** タップしたときに開くアプリ内パス */
  href?: string;
};

type VapidConfig = { publicKey: string; privateKey: string; subject: string };

export function getVapidConfig(): VapidConfig | null {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;
  // subject は Push サービスが問題時に連絡する先。未設定ならアプリの URL
  const subject =
    process.env.VAPID_SUBJECT ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "https://example.com");
  return { publicKey, privateKey, subject };
}

/** 期限切れ・取り消し済みの購読 (二度と届かない) */
export function isGoneStatus(statusCode: number | undefined): boolean {
  return statusCode === 404 || statusCode === 410;
}

export async function sendPushToProfiles(
  profileIds: string[],
  payload: PushPayload,
): Promise<void> {
  try {
    const vapid = getVapidConfig();
    const ids = [...new Set(profileIds)];
    if (!vapid || ids.length === 0) return;

    const subs = await db
      .select({
        id: pushSubscriptions.id,
        endpoint: pushSubscriptions.endpoint,
        p256dh: pushSubscriptions.p256dh,
        auth: pushSubscriptions.auth,
      })
      .from(pushSubscriptions)
      .where(inArray(pushSubscriptions.profileId, ids));
    if (subs.length === 0) return;

    const body = JSON.stringify(payload);
    const gone: string[] = [];
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            body,
            {
              vapidDetails: vapid,
              // 1 日届かなければ捨てる (前日の通知が翌々日に来ても役に立たない)
              TTL: 60 * 60 * 24,
              timeout: 5000,
            },
          );
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          if (isGoneStatus(status)) {
            gone.push(s.id);
          } else {
            console.error("web push failed:", status, e);
          }
        }
      }),
    );
    if (gone.length > 0) {
      await db
        .delete(pushSubscriptions)
        .where(inArray(pushSubscriptions.id, gone));
    }
  } catch (e) {
    console.error("sendPushToProfiles failed:", e);
  }
}
