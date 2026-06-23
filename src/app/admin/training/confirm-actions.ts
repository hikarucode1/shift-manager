"use server";

import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import { courseConfirmations, periods } from "@/db/schema";

type ActionResult =
  | { ok: true; inserted: number }
  | { ok: false; error: string };

const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "日付は YYYY-MM-DD 形式で指定してください。");

const SaveInput = z.object({
  periodId: z.string().uuid(),
  date: IsoDate,
  slotNumber: z.number().int().min(1).max(20),
  // 1 コマ複数講師 OK (アシスタント等の都合)。空配列 = 当該セルの確定を全解除
  tutorIds: z.array(z.string().uuid()).max(200),
});

/**
 * Issue #75 (ε): 講習シフトの (期, 日, コマ) に対する確定講師リストを bulk replace する。
 *
 * - date は期の start_date 〜 end_date 内
 * - 同 (period, date, slot) の既存 course_confirmations を全 DELETE → 新規 INSERT
 * - 1 transaction 内
 * - 入力 tutor_id 重複は dedup
 *
 * 削除のみは tutorIds = [] で実現。
 */
export async function saveCourseConfirmations(
  input: unknown,
): Promise<ActionResult> {
  const parsed = SaveInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "入力値が正しくありません。",
    };
  }
  const { periodId, date, slotNumber, tutorIds } = parsed.data;
  const { profile } = await requireRole("admin");
  const now = new Date();

  // 期の存在 + 日付範囲を 1 クエリで検証 (#110 で kind 撤廃、全期間=講習期間)
  const periodRows = await db
    .select({
      id: periods.id,
      startDate: periods.startDate,
      endDate: periods.endDate,
      isArchived: periods.isArchived,
    })
    .from(periods)
    .where(eq(periods.id, periodId))
    .limit(1);
  const period = periodRows[0];
  if (!period) {
    return { ok: false, error: "対象の講習期間が見つかりません。" };
  }
  if (period.isArchived) {
    return { ok: false, error: "対象期間はアーカイブ済みです。" };
  }
  if (date < period.startDate || date > period.endDate) {
    return {
      ok: false,
      error: `日付 ${date} は期間 (${period.startDate} 〜 ${period.endDate}) の範囲外です。`,
    };
  }

  // 入力 tutor_id を dedup
  const dedupedTutors = Array.from(new Set(tutorIds));

  try {
    await db.transaction(async (tx) => {
      // Issue #104: updatePeriod と同じ periodId 単位の advisory lock。
      // 期マスタ更新 tx が走っているとここで待たされ、commit 後の startDate/
      // endDate/isArchived を踏まえて 0022 child trigger が判定する。
      // regular_assignments 側 (saveMonthlyConfirmation) と同パターン (#89, PR #81)。
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${periodId}))`,
      );
      await tx
        .delete(courseConfirmations)
        .where(
          and(
            eq(courseConfirmations.periodId, periodId),
            eq(courseConfirmations.date, date),
            eq(courseConfirmations.slotNumber, slotNumber),
          ),
        );

      if (dedupedTutors.length > 0) {
        await tx.insert(courseConfirmations).values(
          dedupedTutors.map((tutorId) => ({
            periodId,
            date,
            slotNumber,
            tutorId,
            confirmedBy: profile.id,
            confirmedAt: now,
          })),
        );
      }
    });
  } catch (err) {
    console.error("saveCourseConfirmations failed", err);
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? String((err as { code: unknown }).code)
        : null;
    if (code === "23503") {
      return {
        ok: false,
        error:
          "確定保存に失敗しました: 講師・教室長・期 ID のいずれかが見つかりません。",
      };
    }
    if (code === "23514") {
      return {
        ok: false,
        error:
          "確定保存に失敗しました: コマ番号が範囲外です (1〜20)。",
      };
    }
    return { ok: false, error: "確定保存に失敗しました。" };
  }

  revalidatePath(`/admin/training/${periodId}`);
  revalidatePath("/tutor/training");
  return { ok: true, inserted: dedupedTutors.length };
}
