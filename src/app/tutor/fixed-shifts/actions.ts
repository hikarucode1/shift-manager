"use server";

import { z } from "zod";
import { and, eq, gte } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import { fixedShifts } from "@/db/schema";

const EntrySchema = z.object({
  weekday: z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]),
  slotNumber: z.number().int().min(1).max(20),
});

const InputSchema = z.object({
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  entries: z.array(EntrySchema).max(200),
});

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
  const { effectiveFrom, entries } = parsed.data;

  const { profile } = await requireRole("tutor");

  try {
    await db.transaction(async (tx) => {
      // 今後分 (effectiveFrom 以降) の既存レコードを削除し、今回の内容で置換
      await tx
        .delete(fixedShifts)
        .where(
          and(
            eq(fixedShifts.tutorId, profile.id),
            gte(fixedShifts.effectiveFrom, effectiveFrom),
          ),
        );

      if (entries.length === 0) return;

      await tx.insert(fixedShifts).values(
        entries.map((e) => ({
          tutorId: profile.id,
          weekday: e.weekday,
          slotNumber: e.slotNumber,
          effectiveFrom,
        })),
      );
    });
  } catch (err) {
    console.error("saveFixedShifts failed", err);
    return { ok: false, error: "保存に失敗しました。時間をおいて再度お試しください。" };
  }

  revalidatePath("/tutor/fixed-shifts");
  return { ok: true };
}
