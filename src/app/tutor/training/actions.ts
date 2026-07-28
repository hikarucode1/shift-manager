"use server";

import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import { trainingPeriodNotes, trainingPreferences } from "@/db/schema";
import { assertTrainingEditable, validSlotNumbers } from "@/lib/training";
import { pgErrorCode } from "@/lib/db-errors";
import { isValidIsoDate } from "@/lib/week";

type ActionResult = { ok: true } | { ok: false; error: string };

const SlotInput = z.object({
  periodId: z.string().uuid(),
  date: z.string().refine(isValidIsoDate, "日付が不正です。"),
  slotNumber: z.number().int().min(1).max(20),
  on: z.boolean(),
});

const BulkSlotInput = SlotInput.omit({ slotNumber: true }).extend({
  slotNumbers: z.array(SlotInput.shape.slotNumber).min(1).max(20),
});

/**
 * 単一/一括共通の検証 + 書き込み。締切判定はサーバーで厳密に行う。
 * コマ定義が提出中に変更された場合、無効になったコマは除外して
 * 有効分のみ適用する (全体拒否だと一括ボタンが操作不能になるため)。
 */
async function applyTrainingSlots(
  tutorId: string,
  periodId: string,
  date: string,
  slotNumbers: number[],
  on: boolean,
): Promise<ActionResult> {
  const gate = await assertTrainingEditable(periodId);
  if (!gate.ok) return { ok: false, error: gate.reason };

  // クライアントを信用しない: date が期間範囲内かをサーバーで検証
  if (date < gate.startDate || date > gate.endDate) {
    return { ok: false, error: "対象期間外の日付です。" };
  }
  // 実コマ定義に存在するものだけ適用
  const validSlots = await validSlotNumbers();
  const targets = slotNumbers.filter((n) => validSlots.has(n));
  if (targets.length === 0) {
    return { ok: false, error: "存在しないコマです。" };
  }

  try {
    if (on) {
      await db
        .insert(trainingPreferences)
        .values(
          targets.map((slotNumber) => ({
            periodId,
            tutorId,
            date,
            slotNumber,
          })),
        )
        .onConflictDoNothing({
          target: [
            trainingPreferences.periodId,
            trainingPreferences.tutorId,
            trainingPreferences.date,
            trainingPreferences.slotNumber,
          ],
        });
    } else {
      await db
        .delete(trainingPreferences)
        .where(
          and(
            eq(trainingPreferences.periodId, periodId),
            eq(trainingPreferences.tutorId, tutorId),
            eq(trainingPreferences.date, date),
            inArray(trainingPreferences.slotNumber, targets),
          ),
        );
    }
  } catch (err) {
    // #165 (0031): 教室長の期範囲縮小と競合すると、日付範囲 trigger が 23514 を
    // 投げる (旧来は範囲外行が黙って入っていた経路)。業務エラー文言に変換する。
    // drizzle は PG エラーを wrapper で包み code は cause 側に入るため pgErrorCode で辿る。
    const code = pgErrorCode(err);
    if (code === "23514") {
      return {
        ok: false,
        error: "対象期間が変更されました。画面を再読み込みしてください。",
      };
    }
    console.error("applyTrainingSlots failed", err);
    return { ok: false, error: "保存に失敗しました。時間をおいて再度お試しください。" };
  }

  return { ok: true };
}

/** 1 コマの希望 ON/OFF */
export async function setTrainingSlot(input: unknown): Promise<ActionResult> {
  const { profile } = await requireRole("tutor");

  const parsed = SlotInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "入力が不正です。" };
  const { periodId, date, slotNumber, on } = parsed.data;

  return applyTrainingSlots(profile.id, periodId, date, [slotNumber], on);
}

/**
 * 1 日分のコマ希望をまとめて ON/OFF (#159)。
 * setTrainingSlot の逐次呼び出しを避け、1 リクエストで冪等に適用する。
 */
export async function setTrainingSlotsBulk(
  input: unknown,
): Promise<ActionResult> {
  const { profile } = await requireRole("tutor");

  const parsed = BulkSlotInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "入力が不正です。" };
  const { periodId, date, slotNumbers, on } = parsed.data;

  return applyTrainingSlots(profile.id, periodId, date, slotNumbers, on);
}

const NoteInput = z.object({
  periodId: z.string().uuid(),
  note: z.string().max(1000, "備考は1000文字以内にしてください。"),
});

/** 期間単位の備考を保存 (upsert) */
export async function saveTrainingNote(
  input: unknown,
): Promise<ActionResult> {
  const { profile } = await requireRole("tutor");

  const parsed = NoteInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "入力が不正です。",
    };
  }
  const { periodId, note } = parsed.data;

  const gate = await assertTrainingEditable(periodId);
  if (!gate.ok) return { ok: false, error: gate.reason };

  await db
    .insert(trainingPeriodNotes)
    .values({ periodId, tutorId: profile.id, note })
    .onConflictDoUpdate({
      target: [
        trainingPeriodNotes.periodId,
        trainingPeriodNotes.tutorId,
      ],
      set: { note, updatedAt: new Date() },
    });

  return { ok: true };
}
