"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import { regularShiftPeriods } from "@/db/schema";
import { isValidIsoDate } from "@/lib/week";

type ActionResult = { ok: true } | { ok: false; error: string };

const isoDate = z
  .string()
  .refine((v) => isValidIsoDate(v), "日付の形式が正しくありません。");

const isoDateTime = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), "日時の形式が正しくありません。");

const labelInput = z
  .string()
  .trim()
  .min(1, "ラベルを入力してください。")
  .max(100, "ラベルは 100 文字以内で入力してください。");

const PeriodInput = z
  .object({
    label: labelInput,
    startDate: isoDate,
    endDate: isoDate,
    submissionOpensAt: isoDateTime,
    submissionDueAt: isoDateTime,
  })
  .refine((v) => v.startDate <= v.endDate, {
    message: "期の終了日は開始日以降にしてください。",
    path: ["endDate"],
  })
  .refine(
    (v) => Date.parse(v.submissionOpensAt) < Date.parse(v.submissionDueAt),
    {
      message: "提出締切は提出開始より後にしてください。",
      path: ["submissionDueAt"],
    },
  );

export async function createRegularPeriod(
  input: unknown,
): Promise<ActionResult> {
  const { profile } = await requireRole("admin");

  const parsed = PeriodInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "入力が不正です。",
    };
  }
  const v = parsed.data;

  try {
    await db.insert(regularShiftPeriods).values({
      label: v.label,
      startDate: v.startDate,
      endDate: v.endDate,
      submissionOpensAt: new Date(v.submissionOpensAt),
      submissionDueAt: new Date(v.submissionDueAt),
      createdBy: profile.id,
    });
  } catch (err) {
    console.error("createRegularPeriod failed", err);
    return { ok: false, error: "作成に失敗しました。" };
  }

  revalidatePath("/admin/regular-periods");
  return { ok: true };
}

const UpdateInput = z
  .object({
    id: z.string().uuid(),
    label: labelInput,
    startDate: isoDate,
    endDate: isoDate,
    submissionOpensAt: isoDateTime,
    submissionDueAt: isoDateTime,
  })
  .refine((v) => v.startDate <= v.endDate, {
    message: "期の終了日は開始日以降にしてください。",
    path: ["endDate"],
  })
  .refine(
    (v) => Date.parse(v.submissionOpensAt) < Date.parse(v.submissionDueAt),
    {
      message: "提出締切は提出開始より後にしてください。",
      path: ["submissionDueAt"],
    },
  );

/** 期は作成後も全項目編集可。後追い Issue #74 (期中変更 UX) で参照先テーブルとの整合チェックを強化予定。 */
export async function updateRegularPeriod(
  input: unknown,
): Promise<ActionResult> {
  await requireRole("admin");

  const parsed = UpdateInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "入力が不正です。",
    };
  }
  const v = parsed.data;

  // Issue #89: saveMonthlyConfirmation / saveRegularConfirmation と同じ
  // periodId 単位の advisory lock を取得。確定保存 tx が同 period を持っている
  // 場合、本 update 完了まで待たされ、保存側は tx 内 再 SELECT で最新の
  // startDate/endDate/isArchived を読める。
  let updated: { id: string }[] = [];
  try {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${v.id}))`,
      );
      updated = await tx
        .update(regularShiftPeriods)
        .set({
          label: v.label,
          startDate: v.startDate,
          endDate: v.endDate,
          submissionOpensAt: new Date(v.submissionOpensAt),
          submissionDueAt: new Date(v.submissionDueAt),
          updatedAt: new Date(),
        })
        .where(eq(regularShiftPeriods.id, v.id))
        .returning({ id: regularShiftPeriods.id });
    });
  } catch (err) {
    console.error("updateRegularPeriod failed", err);
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? String((err as { code: unknown }).code)
        : null;
    // 0026 trigger: 範囲外 child (regular_assignments.effective_from/to) が残っているケース。
    if (code === "23514") {
      return {
        ok: false,
        error:
          "期間内に範囲外のレギュラー確定枠が存在します。先に該当枠を削除してから期間を変更してください。",
      };
    }
    return { ok: false, error: "更新に失敗しました。" };
  }
  if (updated.length === 0) {
    return { ok: false, error: "対象の期が見つかりません。" };
  }

  revalidatePath("/admin/regular-periods");
  return { ok: true };
}

const ArchiveInput = z.object({
  id: z.string().uuid(),
  value: z.boolean(),
});

export async function setRegularPeriodArchived(
  input: unknown,
): Promise<ActionResult> {
  await requireRole("admin");
  const parsed = ArchiveInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "入力が不正です。" };

  // Issue #89: updateRegularPeriod と同じ periodId 単位の advisory lock。
  let updated: { id: string }[] = [];
  try {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${parsed.data.id}))`,
      );
      updated = await tx
        .update(regularShiftPeriods)
        .set({ isArchived: parsed.data.value, updatedAt: new Date() })
        .where(eq(regularShiftPeriods.id, parsed.data.id))
        .returning({ id: regularShiftPeriods.id });
    });
  } catch (err) {
    console.error("setRegularPeriodArchived failed", err);
    return { ok: false, error: "更新に失敗しました。" };
  }
  if (updated.length === 0) {
    return { ok: false, error: "対象の期が見つかりません。" };
  }

  revalidatePath("/admin/regular-periods");
  return { ok: true };
}
