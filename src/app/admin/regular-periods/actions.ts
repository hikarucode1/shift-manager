"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { pgConstraintName, pgErrorCode } from "@/lib/db-errors";
import { db } from "@/db/client";
import { regularShiftPeriods } from "@/db/schema";
import { isValidIsoDate, jstDateOf } from "@/lib/week";

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

/**
 * 0021 の CHECK `regular_shift_periods_due_within_period_chk`
 * (`(submission_due_at AT TIME ZONE 'Asia/Tokyo')::date <= end_date`) を
 * アプリ側でも先に見る (#221)。
 *
 * ⚠️ **これが無いと 23514 で落ちる。** 期の終了日を締切より前に縮める操作は
 * UI から普通に到達でき、そのとき DB は「範囲外のレギュラー確定枠」と
 * 区別のつかない 23514 を返す。原因と無関係な削除を案内してしまう。
 *
 * ⚠️ 作成・更新の**両方**に掛ける。CHECK は INSERT にも効くので、片方だけだと
 * 作成時に「作成に失敗しました。」しか出ない。
 */
const dueWithinPeriod = (v: {
  endDate: string;
  submissionDueAt: string;
}): boolean => {
  const t = Date.parse(v.submissionDueAt);
  // ⚠️ **形式不正はここで判定しない。** `isoDateTime` の refine が既に
  // 「日時の形式が正しくありません。」を出しており、フィールド級の refine が
  // 落ちても zod は status を dirty にするだけで**オブジェクト級の refine を
  // 実行する**。ここで `new Date("")` を渡すと `jstDateOf` の `toISOString()`
  // が RangeError を投げ、safeParse を素通りして server action ごと 500 に
  // なる (締切を空にして保存すると踏む)。true を返して形式の文言に譲る
  if (Number.isNaN(t)) return true;
  return jstDateOf(new Date(t)) <= v.endDate;
};

const DUE_WITHIN_PERIOD_MESSAGE =
  "提出締切は期の終了日までにしてください。";

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
  )
  .refine(dueWithinPeriod, {
    message: DUE_WITHIN_PERIOD_MESSAGE,
    path: ["submissionDueAt"],
  });

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
  )
  .refine(dueWithinPeriod, {
    message: DUE_WITHIN_PERIOD_MESSAGE,
    path: ["submissionDueAt"],
  });

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
    const code = pgErrorCode(err);
    // ⚠️ **23514 はこのテーブルで 2 経路ある** (#221)。
    // - 0021 CHECK `..._due_within_period_chk` = 締切が期の外に出た
    // - 0026 trigger = 範囲外の regular_assignments が残っている
    //
    // 案内が正反対 (締切を直す / 枠を消す) なので制約名で分ける。**trigger が
    // RAISE したエラーは制約名を持たない**ため、取れなかったときだけ #176 の
    // `updatePeriod` と同じ併記に落とす (そちらは 2 経路とも trigger で
    // 判別できず、併記以外に選択肢が無かった)。
    if (code === "23514") {
      if (
        pgConstraintName(err) === "regular_shift_periods_due_within_period_chk"
      ) {
        return { ok: false, error: DUE_WITHIN_PERIOD_MESSAGE };
      }
      return {
        ok: false,
        error:
          "期間内に範囲外のレギュラー確定枠が残っているか、提出締切が期間の外に出ています。該当枠を削除するか、締切を期間内に収めてください。",
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
