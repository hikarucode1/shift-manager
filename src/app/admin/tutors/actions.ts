"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, arrayContains, eq, isNull, ne } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import { profiles } from "@/db/schema";
import { isUniqueViolation } from "@/lib/db-errors";
import { setProfileActive } from "@/lib/profile-active";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ALREADY_ACCEPTED,
  NOT_YET_ACCEPTED,
  isInviteAccepted,
  mailTargetRefusal,
  resendErrorMessage,
  resetErrorMessage,
  sameEmail,
} from "@/lib/invite-resend";

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
      .select({ roles: profiles.roles, authUserId: profiles.authUserId })
      .from(profiles)
      .where(eq(profiles.id, data.profileId))
      .limit(1);
    if (target.length === 0) {
      return { ok: false, error: "対象の講師が見つかりません。" };
    }
    if (!target[0].roles.includes("tutor")) {
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
          arrayContains(profiles.roles, ["tutor"]),
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
        roles: ["tutor"],
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

const MailTargetSchema = z.object({ profileId: z.string().uuid() });

type MailTarget =
  | { ok: true; authUserId: string; email: string; accepted: boolean }
  | { ok: false; error: string };

/**
 * 招待の再送とパスワード再設定メール (#268) の送り先を確かめる。
 * どちらも GoTrue がメールアドレスでユーザーを引くので、紐付いている auth
 * ユーザーのメールと profiles のメールが一致するときだけ送る。
 * 招待は宛先がずれると別のユーザーを新規作成し、再設定は該当者がいなくても
 * 黙って 200 を返す (recover.go) ので、どちらも送る前に止める。
 */
async function loadMailTarget(
  input: unknown,
  label: string,
  errorMessage: (error: unknown) => string,
): Promise<MailTarget> {
  const parsed = MailTargetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "入力が不正です。" };

  const [target] = await db
    .select({
      roles: profiles.roles,
      authUserId: profiles.authUserId,
      email: profiles.email,
      isActive: profiles.isActive,
    })
    .from(profiles)
    .where(eq(profiles.id, parsed.data.profileId))
    .limit(1);
  const refusal = mailTargetRefusal(target);
  if (refusal) return { ok: false, error: refusal };
  const authUserId = target.authUserId!;

  const supabase = createAdminClient();
  const { data: found, error: readError } =
    await supabase.auth.admin.getUserById(authUserId);
  if (readError || !found?.user) {
    console.error(`${label}: getUserById failed:`, readError?.message);
    return { ok: false, error: errorMessage(readError) };
  }
  const authEmail = found.user.email;
  if (!authEmail || !sameEmail(authEmail, target.email)) {
    console.error(`${label}: profile email differs from auth email`, {
      authUserId,
    });
    return {
      ok: false,
      error:
        "登録されているメールアドレスがログインアカウントと一致しないため、送れません。",
    };
  }
  return {
    ok: true,
    authUserId,
    email: authEmail,
    accepted: isInviteAccepted(found.user),
  };
}

/**
 * 招待メールの再送 (#265)。招待リンクは 1 回きり・期限付きなので、期限切れや
 * 取りこぼしのときに教室長が送り直す。判定は lib/invite-resend.ts。
 * DB には書かない (auth ユーザーも profiles の紐付けも変わらない)。
 */
export async function resendInvite(input: unknown): Promise<ActionResult> {
  await requireRole("admin");

  const target = await loadMailTarget(
    input,
    "resendInvite",
    resendErrorMessage,
  );
  if (!target.ok) return target;
  if (target.accepted) return { ok: false, error: ALREADY_ACCEPTED };
  const { authUserId } = target;

  const supabase = createAdminClient();
  const { data: invited, error } = await supabase.auth.admin.inviteUserByEmail(
    target.email,
  );
  if (error || !invited?.user) {
    console.error("resendInvite: inviteUserByEmail failed:", error?.message);
    return { ok: false, error: resendErrorMessage(error) };
  }
  if (invited.user.id !== authUserId) {
    // loadMailTarget の一致確認があるので起きない想定 (GoTrue がメールと aud で別ユーザーを
    // 引いた = 新規作成した)。紐付いていない auth ユーザーを残さないよう消す
    // (inviteTutor の巻き戻しと同じ)。消せばメールのリンクも使えなくなる。
    console.error("resendInvite: invite went to a different auth user", {
      expected: authUserId,
      actual: invited.user.id,
    });
    await supabase.auth.admin.deleteUser(invited.user.id).catch(() => {});
    return {
      ok: false,
      error:
        "ログインアカウントの紐付けが一致しないため、再送できませんでした。",
    };
  }

  revalidatePath("/admin/tutors");
  return { ok: true };
}

/**
 * パスワード再設定メールを送る (#268)。招待を受け取った後にパスワードを
 * 決めずに離れた講師や、パスワードを忘れた講師が戻る手段。
 * 講師が自分で送る入口 (/login の「パスワードを忘れた」) は置かない。誰でも
 * 任意の宛先へ送らせられると、教室用 Gmail の送信枠と評判を削られるため。
 *
 * メールのリンクは /auth/confirm (type=recovery) → /auth/set-password。
 * DB には書かない。
 */
export async function sendPasswordReset(input: unknown): Promise<ActionResult> {
  await requireRole("admin");

  const target = await loadMailTarget(
    input,
    "sendPasswordReset",
    resetErrorMessage,
  );
  if (!target.ok) return target;
  if (!target.accepted) return { ok: false, error: NOT_YET_ACCEPTED };

  // ⚠️ 管理用クライアント (flowType 既定の implicit) から呼ぶこと。
  // @supabase/ssr のクライアントは PKCE なので、code_verifier が**教室長の**
  // ブラウザの cookie に書かれ、メールの token_hash も pkce_ 付きになる。
  // implicit なら素の token_hash が届き、講師の端末で verifyOtp できる。
  const supabase = createAdminClient();
  const { error } = await supabase.auth.resetPasswordForEmail(target.email);
  if (error) {
    console.error("sendPasswordReset: resetPasswordForEmail failed:", error.message);
    return { ok: false, error: resetErrorMessage(error) };
  }

  return { ok: true };
}

const SetActiveSchema = z.object({
  id: z.string().uuid(),
  isActive: z.boolean(),
});

/**
 * 講師の有効/無効を切り替え (削除は不可、無効化のみ)。
 * #111 review: 兼任者 (admin+tutor) を本経路で無効化しても admin 保護 guard を
 * 通すよう、active 切替を共有ヘルパ setProfileActive に集約 (setAdminActive と共通)。
 */
export async function setTutorActive(input: unknown): Promise<ActionResult> {
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
    requireTargetRole: "tutor",
    notTargetRoleError: "講師以外は変更できません。",
  });
  if (result.ok) revalidatePath("/admin/tutors");
  return result;
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
    .select({ roles: profiles.roles })
    .from(profiles)
    .where(eq(profiles.id, id))
    .limit(1);
  if (target.length === 0) return { ok: false, error: "対象が見つかりません。" };
  if (!target[0].roles.includes("tutor")) {
    return { ok: false, error: "講師以外は変更できません。" };
  }

  // 同名チェック (UX 用)。最終的な一意性は partial unique index
  // profiles_tutor_name_uniq が DB レベルで保証 (new 招待 / CSV と一貫)。
  const dup = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(
      and(
        arrayContains(profiles.roles, ["tutor"]),
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
