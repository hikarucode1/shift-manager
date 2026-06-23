import "server-only";
import { and, arrayContains, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { profiles } from "@/db/schema";

export type SetActiveResult = { ok: true } | { ok: false; error: string };

/**
 * profile の有効/無効を切り替える共有ロジック (#111 review follow-up)。
 *
 * isActive は profile 単位の単一 boolean で role 別ではない。そのため admin role
 * を持つ profile の無効化は、経路 (setAdminActive / setTutorActive) を問わず
 * 「最後の active admin」guard を通す必要がある。兼任者 (admin+tutor) を講師ページ
 * 経由で無効化して admin 保護をすり抜ける穴を塞ぐため、guard を本ヘルパに集約する。
 *
 * - admins_active_count advisory lock 下で guard SELECT と UPDATE を直列化
 *   (2 admin が同時に互いを deactivate する split-brain race を防ぐ。#92 と同 namespace)
 * - 対象が requireTargetRole を含むことを要求 (各画面の対象種別チェック)
 * - 無効化かつ対象が admin role を含む場合のみ「最後の active admin」guard を適用
 *
 * self lockout 防止 (id === 操作者) は呼び出し側で別途ガードする。
 */
export async function setProfileActive(opts: {
  id: string;
  isActive: boolean;
  requireTargetRole: "admin" | "tutor";
  notTargetRoleError: string;
}): Promise<SetActiveResult> {
  const { id, isActive, requireTargetRole, notTargetRoleError } = opts;

  class BusinessError extends Error {
    constructor(public reason: string) {
      super(reason);
      this.name = "BusinessError";
    }
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
      const roles = target[0].roles;
      if (!roles.includes(requireTargetRole)) {
        throw new BusinessError(notTargetRoleError);
      }

      // 無効化 + 対象が admin を兼ねる場合のみ、最後の active admin を保護。
      // (deactivate 時のみ。activate はリスクなし)
      if (!isActive && roles.includes("admin")) {
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
    console.error("setProfileActive failed", err);
    return { ok: false, error: "更新に失敗しました。" };
  }

  return { ok: true };
}
