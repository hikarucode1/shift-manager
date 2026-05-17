"use server";

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import { trainingPeriodNotes, trainingPreferences } from "@/db/schema";
import { assertTrainingEditable, validSlotNumbers } from "@/lib/training";
import { isValidIsoDate } from "@/lib/week";

type ActionResult = { ok: true } | { ok: false; error: string };

const SlotInput = z.object({
  periodId: z.string().uuid(),
  date: z.string().refine(isValidIsoDate, "日付が不正です。"),
  slotNumber: z.number().int().min(1).max(20),
  on: z.boolean(),
});

/** 1 コマの希望 ON/OFF。締切判定はサーバーで厳密に行う */
export async function setTrainingSlot(input: unknown): Promise<ActionResult> {
  const { profile } = await requireRole("tutor");

  const parsed = SlotInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "入力が不正です。" };
  const { periodId, date, slotNumber, on } = parsed.data;

  const gate = await assertTrainingEditable(periodId);
  if (!gate.ok) return { ok: false, error: gate.reason };

  // クライアントを信用しない: date が期間範囲内かをサーバーで検証
  if (date < gate.startDate || date > gate.endDate) {
    return { ok: false, error: "対象期間外の日付です。" };
  }
  // slotNumber が実コマ定義に存在するか検証
  const validSlots = await validSlotNumbers();
  if (!validSlots.has(slotNumber)) {
    return { ok: false, error: "存在しないコマです。" };
  }

  if (on) {
    await db
      .insert(trainingPreferences)
      .values({ periodId, tutorId: profile.id, date, slotNumber })
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
          eq(trainingPreferences.tutorId, profile.id),
          eq(trainingPreferences.date, date),
          eq(trainingPreferences.slotNumber, slotNumber),
        ),
      );
  }

  return { ok: true };
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
