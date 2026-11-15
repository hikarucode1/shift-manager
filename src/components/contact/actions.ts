"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { requireSession } from "@/lib/auth";
import { db } from "@/db/client";
import { inquiries } from "@/db/schema";
import {
  buildInquiryMail,
  InquiryInputSchema,
  sanitizePagePath,
} from "@/lib/inquiry";
import { sendDeveloperMail } from "@/lib/send-mail";

type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * お問い合わせを保存し、開発者にメールで知らせる (#320)。
 *
 * 先に DB に保存し、保存できたら成功として返す。メールは保存の後に送り、
 * 失敗しても利用者には成功と出す (内容は DB に残っており、開発者が後から
 * 見られる)。保存自体が失敗したときだけエラーを返し、画面は入力を消さない
 */
export async function sendInquiry(input: unknown): Promise<ActionResult> {
  const { profile } = await requireSession();

  const parsed = InquiryInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "入力が正しくありません。",
    };
  }
  const { kind, body, wantsReply } = parsed.data;
  const pagePath = sanitizePagePath(parsed.data.pagePath);
  const userAgent = (await headers()).get("user-agent")?.slice(0, 500) ?? null;

  let saved: { id: string; createdAt: Date };
  try {
    [saved] = await db
      .insert(inquiries)
      .values({
        senderId: profile.id,
        senderName: profile.displayName,
        senderEmail: profile.email,
        senderRoles: profile.roles,
        kind,
        body,
        pagePath,
        wantsReply,
        userAgent,
      })
      .returning({ id: inquiries.id, createdAt: inquiries.createdAt });
  } catch (e) {
    console.error("sendInquiry: insert failed", e);
    return {
      ok: false,
      error: "送信できませんでした。時間をおいてもう一度お試しください。",
    };
  }

  const mail = buildInquiryMail({
    id: saved.id,
    kind,
    body,
    pagePath,
    wantsReply,
    senderName: profile.displayName,
    senderEmail: profile.email,
    senderRoles: profile.roles,
    userAgent,
    createdAt: saved.createdAt,
  });
  const sent = await sendDeveloperMail({ ...mail, replyTo: profile.email });
  if (sent.sent) {
    // 記録できなくても問い合わせ自体は届いているので、利用者には成功と返す
    await db
      .update(inquiries)
      .set({ emailSentAt: new Date() })
      .where(eq(inquiries.id, saved.id))
      .catch((e) => console.error("sendInquiry: mark sent failed", e));
  }

  return { ok: true };
}
