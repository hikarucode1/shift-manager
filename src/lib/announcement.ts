import { z } from "zod";

/**
 * 教室長からのお知らせ (DB に触れない部分)。
 * 今まで LINE でシフトと一緒に送っていた連絡を、教室長が好きなときに出す。
 */

export const MAX_ANNOUNCEMENT_TITLE = 50;
export const MAX_ANNOUNCEMENT_BODY = 3000;
/** スマホ通知・ベルに出す本文の長さ (それ以上は「…」で切る) */
const PREVIEW_LENGTH = 80;

export const AnnouncementInputSchema = z.object({
  title: z
    .string()
    .trim()
    .max(
      MAX_ANNOUNCEMENT_TITLE,
      `件名は${MAX_ANNOUNCEMENT_TITLE}文字までです。`,
    ),
  body: z
    .string()
    .trim()
    .min(1, "本文を入力してください。")
    .max(MAX_ANNOUNCEMENT_BODY, `本文は${MAX_ANNOUNCEMENT_BODY}文字までです。`),
});

/**
 * 件名が空なら本文の 1 行目を件名にする (LINE の文面をそのまま貼る使い方を
 * 想定。「お疲れ様です。」のような挨拶だけの行は飛ばす)
 */
export function resolveAnnouncementTitle(title: string, body: string): string {
  const t = title.trim();
  if (t) return t;
  const lines = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
  const first =
    lines.find((l) => !/^お疲れ(様|さま)です[。！!]?$/.test(l)) ??
    lines[0] ??
    "お知らせ";
  return truncate(first, MAX_ANNOUNCEMENT_TITLE);
}

/** ベル・スマホ通知に出す本文 (改行は空白にまとめて短く) */
export function announcementPreview(body: string): string {
  return truncate(body.replace(/\s+/g, " ").trim(), PREVIEW_LENGTH);
}

function truncate(s: string, max: number): string {
  const chars = [...s];
  return chars.length <= max ? s : chars.slice(0, max - 1).join("") + "…";
}
