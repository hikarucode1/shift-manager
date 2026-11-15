import "server-only";

/**
 * 開発者あてのメールを Resend の HTTP API で送る (#320)。SDK は入れない。
 *
 * - `RESEND_API_KEY`: Resend の API キー
 * - `INQUIRY_TO_EMAIL`: 宛先 (開発者)。コードには書かない
 * - `INQUIRY_FROM_EMAIL`: 差出人。未設定なら Resend の共用アドレス。自分の
 *   ドメインを Resend で確認していない間は、共用アドレスから「Resend に登録した
 *   アドレス」宛てにしか送れない (宛先が開発者だけなので足りる)
 *
 * 設定が無いときや失敗したときは例外を投げずに結果を返す。問い合わせは
 * 先に DB に保存してあるので、メールが届かなくても失われない
 */
export type SendMailResult =
  | { sent: true }
  | { sent: false; reason: "not_configured" | "failed" };

const RESEND_URL = "https://api.resend.com/emails";
const DEFAULT_FROM = "Shift Manager <onboarding@resend.dev>";

export async function sendDeveloperMail(mail: {
  subject: string;
  text: string;
  replyTo?: string;
}): Promise<SendMailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const to = process.env.INQUIRY_TO_EMAIL?.trim();
  if (!apiKey || !to) {
    console.error("[send-mail] RESEND_API_KEY / INQUIRY_TO_EMAIL が未設定");
    return { sent: false, reason: "not_configured" };
  }
  const from = process.env.INQUIRY_FROM_EMAIL?.trim() || DEFAULT_FROM;
  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: mail.subject,
        text: mail.text,
        ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      // 本文に API キーは入らない。原因を追えるよう先頭だけ残す
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      console.error("[send-mail] Resend returned", res.status, detail);
      return { sent: false, reason: "failed" };
    }
    return { sent: true };
  } catch (e) {
    console.error("[send-mail] request failed", e);
    return { sent: false, reason: "failed" };
  }
}
