"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import { appSettings } from "@/db/schema";
import {
  normalizeProgressSheetUrl,
  PROGRESS_SHEET_KEY,
} from "@/lib/progress-sheet";

type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * 教室長: 進行表の URL を登録する (#339)。空で保存すると登録を消す。
 */
export async function saveProgressSheetUrl(
  input: unknown,
): Promise<ActionResult> {
  const { profile } = await requireRole("admin");
  const parsed = z.object({ url: z.string() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "入力が不正です。" };
  const norm = normalizeProgressSheetUrl(parsed.data.url);
  if (!norm.ok) return norm;

  if (norm.url === null) {
    await db.delete(appSettings).where(eq(appSettings.key, PROGRESS_SHEET_KEY));
  } else {
    await db
      .insert(appSettings)
      .values({
        key: PROGRESS_SHEET_KEY,
        value: norm.url,
        updatedBy: profile.id,
      })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: norm.url, updatedBy: profile.id, updatedAt: new Date() },
      });
  }

  revalidatePath("/admin");
  revalidatePath("/tutor");
  return { ok: true };
}
