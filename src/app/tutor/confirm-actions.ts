"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, between, eq } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import { shiftConfirmations, weeklyShifts } from "@/db/schema";
import { isValidIsoDate, weekOf } from "@/lib/week";

type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * 講師: 公開された週のシフトを「確認しました」(#317)。LINE のスタンプの代わり。
 * 同じ週を 2 回押しても 1 行のまま (最初に押した時刻を残す)。
 */
export async function confirmWeekShifts(input: unknown): Promise<ActionResult> {
  const { profile } = await requireRole("tutor");
  const parsed = z
    .object({ weekStart: z.string().refine(isValidIsoDate) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "入力が不正です。" };
  const range = weekOf(parsed.data.weekStart);
  if (range.start !== parsed.data.weekStart) {
    return { ok: false, error: "週の指定が正しくありません。" };
  }
  // その週に自分のコマが無ければ、確認するものが無い
  const [shift] = await db
    .select({ id: weeklyShifts.id })
    .from(weeklyShifts)
    .where(
      and(
        eq(weeklyShifts.tutorId, profile.id),
        between(weeklyShifts.date, range.start, range.end),
      ),
    )
    .limit(1);
  if (!shift) {
    return { ok: false, error: "この週にあなたのシフトはありません。" };
  }

  await db
    .insert(shiftConfirmations)
    .values({ tutorId: profile.id, weekStart: range.start })
    .onConflictDoNothing({
      target: [shiftConfirmations.tutorId, shiftConfirmations.weekStart],
    });

  revalidatePath("/tutor");
  revalidatePath("/admin/weekly");
  return { ok: true };
}
