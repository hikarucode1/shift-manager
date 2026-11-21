"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import { appSettings } from "@/db/schema";
import {
  normalizeProgressSheetUrl,
  SHEET_LINK_KINDS,
  SHEET_LINKS,
} from "@/lib/progress-sheet";

type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * 教室長: 進行表 (#339)・講師マニュアル (要望13) の URL を登録する。
 * 空で保存すると登録を消す。kind を省くと進行表。
 */
export async function saveProgressSheetUrl(
  input: unknown,
): Promise<ActionResult> {
  const { profile } = await requireRole("admin");
  const parsed = z
    .object({
      url: z.string(),
      kind: z.enum(SHEET_LINK_KINDS).default("progress"),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "入力が不正です。" };
  const key = SHEET_LINKS[parsed.data.kind].key;
  const norm = normalizeProgressSheetUrl(parsed.data.url);
  if (!norm.ok) return norm;

  if (norm.url === null) {
    await db.delete(appSettings).where(eq(appSettings.key, key));
  } else {
    await db
      .insert(appSettings)
      .values({
        key,
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
