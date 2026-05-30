"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import { monthlyRegularAssignments } from "@/db/schema";
import { dedupeAssignments } from "@/lib/shift-confirmation";

const IsoFirstOfMonth = z
  .string()
  .regex(/^\d{4}-\d{2}-01$/, "対象月は YYYY-MM-01 形式で指定してください。");

const InputWeekday = z.enum(["mon", "tue", "wed", "thu", "fri", "sat"]);

const AssignmentInput = z.object({
  tutorId: z.string().uuid(),
  weekday: InputWeekday,
  slotNumber: z.number().int().min(1).max(20),
});

const SaveInput = z.object({
  targetMonth: IsoFirstOfMonth,
  // 1 admin あたり 1 ヶ月確定の bulk save 想定で十分大きく上限。
  // 講師 50 × 曜日 6 × コマ 8 = 2400 を意識して 5000。
  assignments: z.array(AssignmentInput).max(5000),
});

export type SaveMonthlyConfirmationResult =
  | { ok: true; inserted: number }
  | { ok: false; error: string };

/**
 * C2 #63: 対象月の確定レギュラー枠を bulk replace で保存する。
 *
 * - 対象月の既存 monthly_regular_assignments を全 delete して新規 insert
 *   (admin が「この月の確定はこれが正」と上書きする運用)
 * - assignments が空 = その月の確定を全解除 (削除のみ)
 * - delete + insert は 1 transaction
 * - admin のみ
 *
 * 想定外の事故防止:
 * - 入力に同一 (tutor, weekday, slot) が複数あれば dedup
 * - 日曜は zod (InputWeekday) で弾く。DB CHECK でも weekday <> 'sun' を保証
 * - slot は zod + DB CHECK の二重ガード (1〜20)
 * - target_month は zod regex + DB CHECK (date_trunc) の二重ガード
 */
export async function saveMonthlyConfirmation(
  input: unknown,
): Promise<SaveMonthlyConfirmationResult> {
  const parsed = SaveInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "入力値が正しくありません。",
    };
  }
  const { targetMonth, assignments } = parsed.data;

  const { profile } = await requireRole("admin");
  const now = new Date();

  // 同一 (tutor, weekday, slot) の重複入力を de-dup (PK 衝突防止)
  const deduped = dedupeAssignments(assignments);

  try {
    await db.transaction(async (tx) => {
      await tx
        .delete(monthlyRegularAssignments)
        .where(eq(monthlyRegularAssignments.targetMonth, targetMonth));

      if (deduped.length > 0) {
        await tx.insert(monthlyRegularAssignments).values(
          deduped.map((a) => ({
            targetMonth,
            tutorId: a.tutorId,
            weekday: a.weekday,
            slotNumber: a.slotNumber,
            confirmedBy: profile.id,
            confirmedAt: now,
          })),
        );
      }
    });
  } catch (err) {
    console.error("saveMonthlyConfirmation failed", err);
    // postgres-js は err.code に SQLSTATE を載せるので、admin の自己解決に
    // つながる粒度で識別する (23503 FK 違反 / 23514 CHECK 違反)。
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? String((err as { code: unknown }).code)
        : null;
    if (code === "23503") {
      return {
        ok: false,
        error: "確定保存に失敗しました: 講師または教室長 ID が見つかりません。",
      };
    }
    if (code === "23514") {
      return {
        ok: false,
        error:
          "確定保存に失敗しました: 対象月・曜日・コマ番号が制約に違反しています (月初/sun 禁止/slot 1〜20)。",
      };
    }
    return { ok: false, error: "確定保存に失敗しました。" };
  }

  revalidatePath("/admin/fixed-shifts");
  revalidatePath("/tutor/fixed-shifts");
  return { ok: true, inserted: deduped.length };
}
