"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import {
  AnnouncementInputSchema,
  resolveAnnouncementTitle,
} from "@/lib/announcement";
import {
  createAnnouncement,
  deleteAnnouncement,
  TUTOR_ANNOUNCEMENTS_PATH,
} from "@/lib/announcements-db";

type ActionResult<T = object> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

/** 教室長: お知らせを講師全員に送る */
export async function sendAnnouncement(
  input: unknown,
): Promise<ActionResult<{ recipientCount: number }>> {
  const { profile } = await requireRole("admin");
  const parsed = AnnouncementInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "入力が正しくありません。",
    };
  }
  const body = parsed.data.body;
  const title = resolveAnnouncementTitle(parsed.data.title, body);

  try {
    const { recipientCount } = await createAnnouncement(profile.id, {
      title,
      body,
    });
    revalidatePath("/admin/announcements");
    revalidatePath(TUTOR_ANNOUNCEMENTS_PATH);
    revalidatePath("/tutor");
    return { ok: true, recipientCount };
  } catch (e) {
    console.error("sendAnnouncement failed", e);
    return {
      ok: false,
      error: "送れませんでした。時間をおいてもう一度お試しください。",
    };
  }
}

/** 教室長: 送ったお知らせを取り消す (講師の画面とベルから消える) */
export async function removeAnnouncement(
  input: unknown,
): Promise<ActionResult> {
  await requireRole("admin");
  const parsed = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "入力が不正です。" };
  try {
    const found = await deleteAnnouncement(parsed.data.id);
    if (!found) {
      return { ok: false, error: "このお知らせはもう取り消されています。" };
    }
  } catch (e) {
    console.error("removeAnnouncement failed", e);
    return {
      ok: false,
      error: "取り消せませんでした。もう一度お試しください。",
    };
  }
  revalidatePath("/admin/announcements");
  revalidatePath(TUTOR_ANNOUNCEMENTS_PATH);
  revalidatePath("/tutor");
  return { ok: true };
}
