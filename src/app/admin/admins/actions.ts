"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, ne } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import { profiles } from "@/db/schema";

type ActionResult = { ok: true } | { ok: false; error: string };

const SetActiveSchema = z.object({
  id: z.string().uuid(),
  isActive: z.boolean(),
});

/**
 * Issue #92: 教室長 (admin) の有効/無効切替。
 *
 * confirmed_by (regular_assignments / course_confirmations) が ON DELETE
 * restrict なので、教室長アカウントの physical delete は確定行がある限り
 * できない。退職した教室長は本 action で無効化し、認証フロー (requireSession)
 * の `!profile.isActive` 分岐で login 不可にする運用。
 *
 * Guard:
 * - 自分自身は変更できない (self lockout 防止)
 * - 「最後の active admin」を deactivate しようとするとブロック
 *   (deactivate 時のみ。activate はリスクなし)
 */
export async function setAdminActive(input: unknown): Promise<ActionResult> {
  const { profile } = await requireRole("admin");

  const parsed = SetActiveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "入力が不正です。" };
  const { id, isActive } = parsed.data;

  if (id === profile.id) {
    return { ok: false, error: "自分自身は変更できません。" };
  }

  const target = await db
    .select({ role: profiles.role, isActive: profiles.isActive })
    .from(profiles)
    .where(eq(profiles.id, id))
    .limit(1);
  if (target.length === 0) {
    return { ok: false, error: "対象が見つかりません。" };
  }
  if (target[0].role !== "admin") {
    return { ok: false, error: "教室長以外は変更できません。" };
  }

  // 「最後の active admin」を deactivate しようとしているか確認。
  // 自分以外の admin で active な人が 1 人もいなければブロック。
  if (!isActive) {
    const otherActiveAdmin = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(
        and(
          eq(profiles.role, "admin"),
          eq(profiles.isActive, true),
          ne(profiles.id, id),
        ),
      )
      .limit(1);
    if (otherActiveAdmin.length === 0) {
      return {
        ok: false,
        error:
          "最後の有効な教室長は無効化できません。先に別の教室長を有効化してください。",
      };
    }
  }

  await db
    .update(profiles)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(profiles.id, id));

  revalidatePath("/admin/admins");
  return { ok: true };
}
