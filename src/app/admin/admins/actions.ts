"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { setProfileActive, type SetActiveResult } from "@/lib/profile-active";

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
 * Guard (#92 + #111 review): 自分自身は変更不可 (self lockout 防止)。対象が admin
 * を含むこと・「最後の active admin」保護・advisory lock による race 防止は
 * 共有ヘルパ setProfileActive に集約 (setTutorActive と同一 guard を共有)。
 */
export async function setAdminActive(input: unknown): Promise<SetActiveResult> {
  const { profile } = await requireRole("admin");

  const parsed = SetActiveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "入力が不正です。" };
  const { id, isActive } = parsed.data;

  if (id === profile.id) {
    return { ok: false, error: "自分自身は変更できません。" };
  }

  const result = await setProfileActive({
    id,
    isActive,
    requireTargetRole: "admin",
    notTargetRoleError: "教室長以外は変更できません。",
  });
  if (result.ok) revalidatePath("/admin/admins");
  return result;
}
