"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, isNull, ne } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import { profiles } from "@/db/schema";
import { isUniqueViolation } from "@/lib/db-errors";
import { createAdminClient } from "@/lib/supabase/admin";

type ActionResult = { ok: true } | { ok: false; error: string };

/** 招待: 新規講師 (displayName) または 既存 stub への紐付け (profileId) */
const InviteSchema = z.union([
  z.object({
    mode: z.literal("new"),
    email: z.string().email("メールアドレスの形式が正しくありません。"),
    displayName: z.string().trim().min(1, "氏名を入力してください。").max(50),
  }),
  z.object({
    mode: z.literal("link"),
    email: z.string().email("メールアドレスの形式が正しくありません。"),
    profileId: z.string().uuid(),
  }),
]);

/**
 * 講師を招待 (Supabase Auth の招待メール送信)。
 * - new : profiles に tutor 行を新規作成し auth_user_id を紐付け
 * - link: 既存 stub profile (auth 未連携) に auth_user_id / email を紐付け
 */
export async function inviteTutor(input: unknown): Promise<ActionResult> {
  await requireRole("admin");

  const parsed = InviteSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "入力が不正です。",
    };
  }
  const data = parsed.data;

  if (data.mode === "link") {
    // link 対象が「tutor かつ auth 未連携」か検証
    const target = await db
      .select({ role: profiles.role, authUserId: profiles.authUserId })
      .from(profiles)
      .where(eq(profiles.id, data.profileId))
      .limit(1);
    if (target.length === 0) {
      return { ok: false, error: "対象の講師が見つかりません。" };
    }
    if (target[0].role !== "tutor") {
      return { ok: false, error: "講師以外は紐付けできません。" };
    }
    if (target[0].authUserId) {
      return { ok: false, error: "この講師は既にログイン連携済みです。" };
    }
  } else {
    // new モード: 同名講師が既に居れば二重作成を防ぎ、紐付けへ誘導
    const sameName = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(
        and(
          eq(profiles.role, "tutor"),
          eq(profiles.displayName, data.displayName),
        ),
      )
      .limit(1);
    if (sameName.length > 0) {
      return {
        ok: false,
        error:
          "同名の講師が既に登録されています。新規ではなく、一覧の「招待」からその講師に紐付けてください。",
      };
    }
  }

  const supabase = createAdminClient();
  const { data: invited, error } =
    await supabase.auth.admin.inviteUserByEmail(data.email);

  if (error || !invited?.user) {
    const msg = error?.message ?? "unknown";
    console.error("inviteTutor: inviteUserByEmail failed:", msg);
    if (/already|registered|exists/i.test(msg)) {
      return { ok: false, error: "このメールアドレスは既に登録されています。" };
    }
    if (/rate|limit|too many/i.test(msg)) {
      return {
        ok: false,
        error: "短時間に招待を送りすぎました。時間をおいて再度お試しください。",
      };
    }
    return {
      ok: false,
      error:
        "招待に失敗しました。メールアドレスを確認のうえ、時間をおいて再度お試しください。",
    };
  }
  const authUserId = invited.user.id;

  try {
    if (data.mode === "new") {
      await db.insert(profiles).values({
        authUserId,
        displayName: data.displayName,
        role: "tutor",
        email: data.email,
        isActive: true,
      });
    } else {
      // 二重リンク防止: auth_user_id IS NULL の行のみ更新
      const updated = await db
        .update(profiles)
        .set({ authUserId, email: data.email, updatedAt: new Date() })
        .where(
          and(
            eq(profiles.id, data.profileId),
            isNull(profiles.authUserId),
          ),
        )
        .returning({ id: profiles.id });
      if (updated.length === 0) {
        throw new Error("link target was already linked or missing");
      }
    }
  } catch (e) {
    // profiles 反映に失敗したら招待した auth ユーザーを巻き戻す (孤児防止)
    await supabase.auth.admin.deleteUser(authUserId).catch(() => {});
    console.error("inviteTutor: profile write failed", e);
    if (isUniqueViolation(e, "profiles_tutor_name_uniq")) {
      return {
        ok: false,
        error: "同名の講師が既に登録されています。別の氏名にしてください。",
      };
    }
    return {
      ok: false,
      error: "プロフィール反映に失敗しました。時間をおいて再度お試しください。",
    };
  }

  revalidatePath("/admin/tutors");
  return { ok: true };
}

const SetActiveSchema = z.object({
  id: z.string().uuid(),
  isActive: z.boolean(),
});

/** 講師の有効/無効を切り替え (削除は不可、無効化のみ) */
export async function setTutorActive(input: unknown): Promise<ActionResult> {
  const { profile } = await requireRole("admin");

  const parsed = SetActiveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "入力が不正です。" };
  const { id, isActive } = parsed.data;

  if (id === profile.id) {
    return { ok: false, error: "自分自身は変更できません。" };
  }

  const target = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, id))
    .limit(1);
  if (target.length === 0) return { ok: false, error: "対象が見つかりません。" };
  if (target[0].role !== "tutor") {
    return { ok: false, error: "講師以外は変更できません。" };
  }

  await db
    .update(profiles)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(profiles.id, id));

  revalidatePath("/admin/tutors");
  return { ok: true };
}

const RenameSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string().trim().min(1, "氏名を入力してください。").max(50),
});

/** 表示名を変更 (CSV の講師名と一致させるため) */
export async function renameTutor(input: unknown): Promise<ActionResult> {
  await requireRole("admin");

  const parsed = RenameSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "入力が不正です。" };
  }
  const { id, displayName } = parsed.data;

  const target = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, id))
    .limit(1);
  if (target.length === 0) return { ok: false, error: "対象が見つかりません。" };
  if (target[0].role !== "tutor") {
    return { ok: false, error: "講師以外は変更できません。" };
  }

  // 同名チェック (UX 用)。最終的な一意性は partial unique index
  // profiles_tutor_name_uniq が DB レベルで保証 (new 招待 / CSV と一貫)。
  const dup = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(
      and(
        eq(profiles.role, "tutor"),
        eq(profiles.displayName, displayName),
        ne(profiles.id, id),
      ),
    )
    .limit(1);
  if (dup.length > 0) {
    return {
      ok: false,
      error: "同名の講師が既に登録されています。別の氏名にしてください。",
    };
  }

  try {
    await db
      .update(profiles)
      .set({ displayName, updatedAt: new Date() })
      .where(eq(profiles.id, id));
  } catch (e) {
    if (isUniqueViolation(e, "profiles_tutor_name_uniq")) {
      return {
        ok: false,
        error: "同名の講師が既に登録されています。別の氏名にしてください。",
      };
    }
    console.error("renameTutor failed", e);
    return { ok: false, error: "変更に失敗しました。時間をおいてお試しください。" };
  }

  revalidatePath("/admin/tutors");
  return { ok: true };
}
