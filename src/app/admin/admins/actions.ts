"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, arrayContains, eq, ne, sql } from "drizzle-orm";
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
 * - role === "admin" 限定
 * - 「最後の active admin」を deactivate しようとするとブロック
 *   (deactivate 時のみ。activate はリスクなし)
 *
 * Race fix (#92 review P2-1): admin role 全体に対する mutex を
 * `pg_advisory_xact_lock(hashtext('admins_active_count'))` で取得。
 * 2 admin が同時に互いを deactivate する split-brain race を防ぐ。
 * guard SELECT と UPDATE を同一 tx 内に閉じ込め、BusinessError パターン
 * (PR #81 / Issue #89 で確立) で rollback。
 */
class BusinessError extends Error {
  constructor(public reason: string) {
    super(reason);
    this.name = "BusinessError";
  }
}

export async function setAdminActive(input: unknown): Promise<ActionResult> {
  const { profile } = await requireRole("admin");

  const parsed = SetActiveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "入力が不正です。" };
  const { id, isActive } = parsed.data;

  if (id === profile.id) {
    return { ok: false, error: "自分自身は変更できません。" };
  }

  try {
    await db.transaction(async (tx) => {
      // admin role mutation 全体を直列化。periodId 単位の lock とは別 namespace。
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext('admins_active_count'))`,
      );

      const target = await tx
        .select({ roles: profiles.roles })
        .from(profiles)
        .where(eq(profiles.id, id))
        .limit(1);
      if (target.length === 0) {
        throw new BusinessError("対象が見つかりません。");
      }
      if (!target[0].roles.includes("admin")) {
        throw new BusinessError("教室長以外は変更できません。");
      }

      if (!isActive) {
        const otherActiveAdmin = await tx
          .select({ id: profiles.id })
          .from(profiles)
          .where(
            and(
              arrayContains(profiles.roles, ["admin"]),
              eq(profiles.isActive, true),
              ne(profiles.id, id),
            ),
          )
          .limit(1);
        if (otherActiveAdmin.length === 0) {
          throw new BusinessError(
            "最後の有効な教室長は無効化できません。先に別の教室長を有効化してください。",
          );
        }
      }

      await tx
        .update(profiles)
        .set({ isActive, updatedAt: new Date() })
        .where(eq(profiles.id, id));
    });
  } catch (err) {
    if (err instanceof BusinessError) {
      return { ok: false, error: err.reason };
    }
    console.error("setAdminActive failed", err);
    return { ok: false, error: "更新に失敗しました。" };
  }

  revalidatePath("/admin/admins");
  return { ok: true };
}
