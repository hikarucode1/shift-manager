"use server";

import { z } from "zod";
import { and, eq, gte } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import { fixedShifts, fixedShiftSubmissions } from "@/db/schema";

// 日曜は教室休校 (Issue #56) のため入力対象外。サーバ側でも拒否する。
// 'no' は「行不在」で表現するため Entry には含めない (Issue #55)。
const EntrySchema = z.object({
  weekday: z.enum(["mon", "tue", "wed", "thu", "fri", "sat"]),
  slotNumber: z.number().int().min(1).max(20),
  availability: z.enum(["yes", "maybe"]),
});

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const InputSchema = z
  .object({
    effectiveFrom: IsoDate,
    // Issue #58: 有効期間の終わり (任意, null可)
    effectiveTo: IsoDate.nullable().optional(),
    // Issue #57: 希望出勤日数 / コマ数 (任意)
    desiredDays: z.number().int().min(0).max(31).nullable().optional(),
    desiredSlots: z.number().int().min(0).max(200).nullable().optional(),
    // Issue #59: フリースペース (任意, 文字数上限)
    note: z.string().max(1000).nullable().optional(),
    entries: z.array(EntrySchema).max(200),
  })
  .refine(
    (v) =>
      v.effectiveTo == null || v.effectiveTo >= v.effectiveFrom,
    { message: "適用終了日は適用開始日以降である必要があります。", path: ["effectiveTo"] },
  );

export type SaveFixedShiftsResult =
  | { ok: true }
  | { ok: false; error: string };

export async function saveFixedShifts(
  input: unknown,
): Promise<SaveFixedShiftsResult> {
  const parsed = InputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "入力値が正しくありません。" };
  }
  const {
    effectiveFrom,
    effectiveTo = null,
    desiredDays = null,
    desiredSlots = null,
    note = null,
    entries,
  } = parsed.data;

  const { profile } = await requireRole("tutor");

  try {
    await db.transaction(async (tx) => {
      // 今後分 (effectiveFrom 以降) の既存レコードを削除し、今回の内容で置換。
      // shifts とメタを同じスコープで揃えないと、将来分の古いメタが孤立する (#65 P2)。
      await tx
        .delete(fixedShifts)
        .where(
          and(
            eq(fixedShifts.tutorId, profile.id),
            gte(fixedShifts.effectiveFrom, effectiveFrom),
          ),
        );
      await tx
        .delete(fixedShiftSubmissions)
        .where(
          and(
            eq(fixedShiftSubmissions.tutorId, profile.id),
            gte(fixedShiftSubmissions.effectiveFrom, effectiveFrom),
          ),
        );

      if (entries.length > 0) {
        await tx.insert(fixedShifts).values(
          entries.map((e) => ({
            tutorId: profile.id,
            weekday: e.weekday,
            slotNumber: e.slotNumber,
            effectiveFrom,
            availability: e.availability,
          })),
        );
      }

      // 提出単位メタ (Issue #57/#58/#59) を insert (直前に同スコープを delete 済)。
      // effective_to は entries が空でも保持されるよう submissions 側に寄せている。
      const trimmedNote = note?.trim() ? note.trim() : null;
      await tx.insert(fixedShiftSubmissions).values({
        tutorId: profile.id,
        effectiveFrom,
        effectiveTo,
        desiredDays,
        desiredSlots,
        note: trimmedNote,
      });
    });
  } catch (err) {
    console.error("saveFixedShifts failed", err);
    return { ok: false, error: "保存に失敗しました。時間をおいて再度お試しください。" };
  }

  revalidatePath("/tutor/fixed-shifts");
  return { ok: true };
}
