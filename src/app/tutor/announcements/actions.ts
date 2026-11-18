"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import {
  confirmAnnouncement,
  TUTOR_ANNOUNCEMENTS_PATH,
} from "@/lib/announcements-db";

type ActionResult = { ok: true } | { ok: false; error: string };

/** 講師: お知らせを「確認しました」(LINE のスタンプの代わり) */
export async function confirmAnnouncementAction(
  input: unknown,
): Promise<ActionResult> {
  const { profile } = await requireRole("tutor");
  const parsed = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "入力が不正です。" };
  const ok = await confirmAnnouncement(profile.id, parsed.data.id);
  if (!ok) {
    return { ok: false, error: "このお知らせは見つかりませんでした。" };
  }
  revalidatePath(TUTOR_ANNOUNCEMENTS_PATH);
  revalidatePath("/tutor");
  revalidatePath("/admin/announcements");
  return { ok: true };
}
