"use server";

import { z } from "zod";
import { and, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import { regularAssignments, regularShiftPeriods } from "@/db/schema";
import { dedupeAssignments } from "@/lib/shift-confirmation";
import { lastDayOfMonth, splitRangeRemovingMonth } from "@/lib/shift-period";

const IsoFirstOfMonth = z
  .string()
  .regex(/^\d{4}-\d{2}-01$/, "対象月は YYYY-MM-01 形式で指定してください。");

const InputWeekday = z.enum(["mon", "tue", "wed", "thu", "fri", "sat"]);

const AssignmentInput = z.object({
  tutorId: z.string().uuid(),
  weekday: InputWeekday,
  slotNumber: z.number().int().min(1).max(20),
});

const MonthlySaveInput = z.object({
  periodId: z.string().uuid(),
  targetMonth: IsoFirstOfMonth,
  assignments: z.array(AssignmentInput).max(5000),
});

export type SaveMonthlyConfirmationResult =
  | { ok: true; inserted: number }
  | { ok: false; error: string };

/**
 * Issue #74 (δ) + post-merge review fixes: 単月の確定を
 * effective_from = 月初、effective_to = 月末 で保存。
 *
 * - period を SELECT して targetMonth が start/end と overlap するか検証 (range check)
 * - 同 period の **当月と重なる** 全ての既存行を取得し、それぞれ
 *   splitRangeRemovingMonth で「対象月の外側」に分割して再 INSERT
 *   → 期一括行 (4/1〜6/30) と単月行 (5/1〜5/31) の重複行が共存しない
 * - assignments 空 = 当月の確定を全解除 (= overlap 行を split のみ)
 * - すべて 1 transaction 内
 *
 * effective_to NULL の既存行は overlap select で取れるが、split 時に
 * 「NULL = 期末まで」を period.endDate に解決してから分割する。
 *
 * 期途中の日単位 effective_from 編集 UI は別 Issue で後追い。
 */
export async function saveMonthlyConfirmation(
  input: unknown,
): Promise<SaveMonthlyConfirmationResult> {
  const parsed = MonthlySaveInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "入力値が正しくありません。",
    };
  }
  const { periodId, targetMonth, assignments } = parsed.data;
  const { profile } = await requireRole("admin");
  const now = new Date();

  const monthStart = targetMonth; // YYYY-MM-01
  const monthEnd = lastDayOfMonth(targetMonth); // YYYY-MM-LL
  if (!monthEnd) {
    return { ok: false, error: "対象月の形式が不正です。" };
  }
  const deduped = dedupeAssignments(assignments);

  // PR #81 Codex review: 早期 reject は前 SELECT で行うが、本検証は tx 内 (TOCTOU 対策)。
  const earlyPeriodRows = await db
    .select({ id: regularShiftPeriods.id })
    .from(regularShiftPeriods)
    .where(eq(regularShiftPeriods.id, periodId))
    .limit(1);
  if (earlyPeriodRows.length === 0) {
    return { ok: false, error: "対象の期が見つかりません。" };
  }

  // 業務エラー (range/archived) を transaction の throw として運ぶための型。
  class BusinessError extends Error {
    constructor(public reason: string) {
      super(reason);
      this.name = "BusinessError";
    }
  }

  try {
    await db.transaction(async (tx) => {
      // PR #81 Codex P1 (再): periodId 単位で advisory lock を取得。
      // (periodId × targetMonth) 単位の lock では、同 period 内の異なる月保存どうしが
      // 並行で同じ既存 range を overlap 取得 → split & INSERT し、重複 range を再生成し得る。
      // 同 period の単月保存と期一括保存はすべてこの lock で直列化する
      // (saveRegularConfirmation も同じ key を取得)。
      // hashtext は int4 を返すので bigint 1 引数版に流し込み (上位 32bit を 0)。
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${periodId}))`,
      );

      // PR #81 Codex P2-1: period の archived / range 検証を tx 内で再実行 (TOCTOU 対策)。
      // 同じ tx 内なので、ここで取得した period.endDate は以降の split 計算で安全に使える。
      const periodRows = await tx
        .select({
          id: regularShiftPeriods.id,
          startDate: regularShiftPeriods.startDate,
          endDate: regularShiftPeriods.endDate,
          isArchived: regularShiftPeriods.isArchived,
        })
        .from(regularShiftPeriods)
        .where(eq(regularShiftPeriods.id, periodId))
        .limit(1);
      const period = periodRows[0];
      if (!period) {
        throw new BusinessError("対象の期が見つかりません。");
      }
      if (period.isArchived) {
        throw new BusinessError("対象の期はアーカイブ済みです。");
      }
      if (monthEnd < period.startDate || monthStart > period.endDate) {
        throw new BusinessError(
          `対象月 ${monthStart} は期 (${period.startDate} 〜 ${period.endDate}) の範囲外です。`,
        );
      }

      // 同 period で当月と effective range が重なる既存行を全て取得
      const overlapping = await tx
        .select({
          id: regularAssignments.id,
          tutorId: regularAssignments.tutorId,
          weekday: regularAssignments.weekday,
          slotNumber: regularAssignments.slotNumber,
          effectiveFrom: regularAssignments.effectiveFrom,
          effectiveTo: regularAssignments.effectiveTo,
        })
        .from(regularAssignments)
        .where(
          and(
            eq(regularAssignments.periodId, periodId),
            lte(regularAssignments.effectiveFrom, monthEnd),
            or(
              isNull(regularAssignments.effectiveTo),
              gte(regularAssignments.effectiveTo, monthStart),
            ),
          ),
        );

      if (overlapping.length > 0) {
        // 既存重なり行を全削除
        const ids = overlapping.map((r) => r.id);
        // drizzle inArray helper を使うため、複数 OR でも素朴に書ける
        for (const id of ids) {
          await tx
            .delete(regularAssignments)
            .where(eq(regularAssignments.id, id));
        }

        // 各既存行を「対象月の外側」だけ残して再 INSERT (split)
        const splitInserts: Array<{
          periodId: string;
          tutorId: string;
          weekday: "mon" | "tue" | "wed" | "thu" | "fri" | "sat";
          slotNumber: number;
          effectiveFrom: string;
          effectiveTo: string;
          confirmedBy: string;
          confirmedAt: Date;
        }> = [];
        for (const r of overlapping) {
          // effective_to NULL は period.endDate に coalesce
          const effectiveTo = r.effectiveTo ?? period.endDate;
          const remainder = splitRangeRemovingMonth(
            { effectiveFrom: r.effectiveFrom, effectiveTo },
            monthStart,
            monthEnd,
          );
          for (const seg of remainder) {
            splitInserts.push({
              periodId,
              tutorId: r.tutorId,
              weekday: r.weekday as
                | "mon"
                | "tue"
                | "wed"
                | "thu"
                | "fri"
                | "sat",
              slotNumber: r.slotNumber,
              effectiveFrom: seg.effectiveFrom,
              effectiveTo: seg.effectiveTo,
              // 既存の confirmedBy/At は失うが、split は admin の意図的な
              // 上書き操作の副作用なので "今 admin" の責任で再記録する。
              confirmedBy: profile.id,
              confirmedAt: now,
            });
          }
        }
        if (splitInserts.length > 0) {
          await tx.insert(regularAssignments).values(splitInserts);
        }
      }

      // 当月の新確定行
      if (deduped.length > 0) {
        await tx.insert(regularAssignments).values(
          deduped.map((a) => ({
            periodId,
            tutorId: a.tutorId,
            weekday: a.weekday,
            slotNumber: a.slotNumber,
            effectiveFrom: monthStart,
            effectiveTo: monthEnd,
            confirmedBy: profile.id,
            confirmedAt: now,
          })),
        );
      }
    });
  } catch (err) {
    // BusinessError は tx 内検証 (range/archived) の rollback。ユーザー向けに reason を返す。
    if (err instanceof BusinessError) {
      return { ok: false, error: err.reason };
    }
    console.error("saveMonthlyConfirmation failed", err);
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? String((err as { code: unknown }).code)
        : null;
    if (code === "23503") {
      return {
        ok: false,
        error: "確定保存に失敗しました: 講師・教室長 ID または期 ID が見つかりません。",
      };
    }
    if (code === "23514") {
      return {
        ok: false,
        error:
          "確定保存に失敗しました: 曜日・コマ番号・日付範囲が制約に違反しています (sun 禁止/slot 1〜20/effective_from <= effective_to)。",
      };
    }
    return { ok: false, error: "確定保存に失敗しました。" };
  }

  revalidatePath("/admin/fixed-shifts");
  revalidatePath("/tutor/fixed-shifts");
  return { ok: true, inserted: deduped.length };
}

const RegularSaveInput = z.object({
  periodId: z.string().uuid(),
  assignments: z.array(AssignmentInput).max(5000),
});

export type SaveRegularConfirmationResult =
  | { ok: true; inserted: number }
  | { ok: false; error: string };

/**
 * Issue #74 (δ) / #73 (γ): 期全体の確定を effective_from = 期 start_date、
 * effective_to = 期 end_date で 1 行ずつ保存する (1 期 = 1 行)。
 *
 * - 同 period_id の既存行を全削除 (replace 方式)
 * - assignments 空 = その期の確定を全解除
 * - 1 transaction
 *
 * 月単位の saveMonthlyConfirmation は維持 (期途中で当月だけ調整したい運用)。
 */
export async function saveRegularConfirmation(
  input: unknown,
): Promise<SaveRegularConfirmationResult> {
  const parsed = RegularSaveInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "入力値が正しくありません。",
    };
  }
  const { periodId, assignments } = parsed.data;

  const { profile } = await requireRole("admin");
  const now = new Date();

  const periodRows = await db
    .select({
      startDate: regularShiftPeriods.startDate,
      endDate: regularShiftPeriods.endDate,
    })
    .from(regularShiftPeriods)
    .where(eq(regularShiftPeriods.id, periodId))
    .limit(1);
  const period = periodRows[0];
  if (!period) {
    return { ok: false, error: "対象の期が見つかりません。" };
  }

  const deduped = dedupeAssignments(assignments);

  try {
    await db.transaction(async (tx) => {
      // PR #81 Codex P1 (再): saveMonthlyConfirmation と同じ periodId 単位の lock を取得。
      // 期一括保存と単月保存の並行実行で、既存 range の delete/split が交錯して
      // 重複 / lost update が起き得るため、同 period 内の確定保存はすべて直列化する。
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${periodId}))`,
      );

      await tx
        .delete(regularAssignments)
        .where(eq(regularAssignments.periodId, periodId));

      if (deduped.length > 0) {
        await tx.insert(regularAssignments).values(
          deduped.map((a) => ({
            periodId,
            tutorId: a.tutorId,
            weekday: a.weekday,
            slotNumber: a.slotNumber,
            effectiveFrom: period.startDate,
            effectiveTo: period.endDate,
            confirmedBy: profile.id,
            confirmedAt: now,
          })),
        );
      }
    });
  } catch (err) {
    console.error("saveRegularConfirmation failed", err);
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? String((err as { code: unknown }).code)
        : null;
    if (code === "23503") {
      return {
        ok: false,
        error: "期一括確定に失敗しました: 講師・教室長 ID または期 ID が見つかりません。",
      };
    }
    if (code === "23514") {
      return {
        ok: false,
        error:
          "期一括確定に失敗しました: 曜日・コマ番号・日付範囲が制約に違反しています (sun 禁止/slot 1〜20)。",
      };
    }
    return { ok: false, error: "期一括確定に失敗しました。" };
  }

  revalidatePath("/admin/fixed-shifts");
  revalidatePath("/tutor/fixed-shifts");
  // 「期全体の枠」が確定された (= 期内全日適用)
  return { ok: true, inserted: deduped.length };
}
