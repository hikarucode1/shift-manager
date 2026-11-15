import { z } from "zod";

/**
 * アプリ内の「お問い合わせ」(#320)。講師・教室長から開発者へ。
 * 送り手の名前・メール・役割はログイン中のアカウントから付ける (入力させない)。
 */
export const INQUIRY_KINDS = ["question", "bug", "request"] as const;
export type InquiryKind = (typeof INQUIRY_KINDS)[number];

export const INQUIRY_KIND_LABEL: Record<InquiryKind, string> = {
  question: "使い方の質問",
  bug: "不具合の報告",
  request: "要望・その他",
};

export const MAX_INQUIRY_BODY = 2000;
const MAX_PAGE_PATH = 300;

export const InquiryInputSchema = z.object({
  kind: z.enum(INQUIRY_KINDS),
  body: z
    .string()
    .trim()
    .min(1, "内容を入力してください。")
    .max(MAX_INQUIRY_BODY, `内容は${MAX_INQUIRY_BODY}文字以内にしてください。`),
  wantsReply: z.boolean(),
  pagePath: z.string().nullable(),
});

/**
 * 「どの画面から開いたか」はクライアントから来るので、アプリ内のパスだけを残す。
 * 外のURL (`//evil.example` / `https://...`) や長すぎるものは捨てる。
 * メール本文にそのまま載るので、改行なども入れさせない
 */
export function sanitizePagePath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw.length > MAX_PAGE_PATH) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  if (!/^[\x21-\x7e]+$/.test(raw)) return null;
  return raw;
}

export function roleLabel(roles: readonly string[]): string {
  const admin = roles.includes("admin");
  const tutor = roles.includes("tutor");
  if (admin && tutor) return "教室長・講師";
  if (admin) return "教室長";
  if (tutor) return "講師";
  return "不明";
}

export type InquiryMailInput = {
  kind: InquiryKind;
  body: string;
  pagePath: string | null;
  wantsReply: boolean;
  senderName: string;
  senderEmail: string;
  senderRoles: readonly string[];
  userAgent: string | null;
  createdAt: Date;
  id: string;
};

/** 開発者に届くメールの件名と本文 (プレーンテキスト) */
export function buildInquiryMail(i: InquiryMailInput): {
  subject: string;
  text: string;
} {
  const role = roleLabel(i.senderRoles);
  const subject = `【Shift Manager】${INQUIRY_KIND_LABEL[i.kind]}: ${i.senderName}さん（${role}）`;
  const text = [
    `種類: ${INQUIRY_KIND_LABEL[i.kind]}`,
    `送信者: ${i.senderName}（${role}） <${i.senderEmail}>`,
    `返信: ${i.wantsReply ? "ほしい" : "不要"}`,
    `日時: ${formatJstDateTime(i.createdAt)}`,
    `画面: ${i.pagePath ?? "（不明）"}`,
    `ブラウザ: ${i.userAgent ?? "（不明）"}`,
    `ID: ${i.id}`,
    "",
    "----- 内容 -----",
    i.body,
  ].join("\n");
  return { subject, text };
}

/** 2026-11-14T09:30:00Z → "2026/11/14 18:30" (JST) */
export function formatJstDateTime(at: Date): string {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}/${get("month")}/${get("day")} ${get("hour")}:${get("minute")}`;
}
