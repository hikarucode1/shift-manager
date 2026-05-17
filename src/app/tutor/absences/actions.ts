"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import { absenceRequests, weeklyShifts } from "@/db/schema";
import { isValidIsoDate, jstToday } from "@/lib/week";

type ActionResult = { ok: true } | { ok: false; error: string };

const CreateInput = z.object({
  date: z.string().refine(isValidIsoDate, "日付が不正です。"),
  slotNumber: z.number().int().min(1).max(20),
  reason: z.string().trim().min(1, "理由を入力してください。").max(500),
});

/** 講師: 欠勤申請を作成 (自分の今後の確定シフトに対してのみ) */
export async function createAbsenceRequest(
  input: unknown,
): Promise<ActionResult> {
  const { profile } = await requireRole("tutor");

  const parsed = CreateInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "入力が不正です。",
    };
  }
  const { date, slotNumber, reason } = parsed.data;

  // 過去日は不可
  if (date < jstToday()) {
    return { ok: false, error: "過去の日付は申請できません。" };
  }

  // 実在する自分の確定シフトか (クライアントを信用しない)
  const shift = await db
    .select({ id: weeklyShifts.id })
    .from(weeklyShifts)
    .where(
      and(
        eq(weeklyShifts.tutorId, profile.id),
        eq(weeklyShifts.date, date),
        eq(weeklyShifts.slotNumber, slotNumber),
      ),
    )
    .limit(1);
  if (shift.length === 0) {
    return { ok: false, error: "対象の確定シフトが見つかりません。" };
  }

  // 既存の未処理/承認済み申請があれば重複させない
  // 事前チェック (UX 用のわかりやすいエラー)。最終的な一意性は
  // 部分ユニークインデックス absence_requests_active_uniq が DB レベルで保証。
  const dup = await db
    .select({ id: absenceRequests.id })
    .from(absenceRequests)
    .where(
      and(
        eq(absenceRequests.tutorId, profile.id),
        eq(absenceRequests.date, date),
        eq(absenceRequests.slotNumber, slotNumber),
        inArray(absenceRequests.status, ["pending", "approved"]),
      ),
    )
    .limit(1);
  if (dup.length > 0) {
    return { ok: false, error: "このコマには既に申請があります。" };
  }

  try {
    await db.insert(absenceRequests).values({
      tutorId: profile.id,
      date,
      slotNumber,
      reason,
    });
  } catch (e) {
    // 同時送信などで部分ユニーク制約に当たった場合
    if (
      e instanceof Error &&
      /absence_requests_active_uniq|unique/i.test(e.message)
    ) {
      return { ok: false, error: "このコマには既に申請があります。" };
    }
    console.error("createAbsenceRequest insert failed", e);
    return { ok: false, error: "申請に失敗しました。時間をおいてお試しください。" };
  }

  revalidatePath("/tutor/absences");
  revalidatePath("/admin/requests");
  return { ok: true };
}

const IdInput = z.object({ id: z.string().uuid() });

/** 講師: 自分の pending 申請を取り消し */
export async function cancelAbsenceRequest(
  input: unknown,
): Promise<ActionResult> {
  const { profile } = await requireRole("tutor");

  const parsed = IdInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "入力が不正です。" };

  const updated = await db
    .update(absenceRequests)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(
      and(
        eq(absenceRequests.id, parsed.data.id),
        eq(absenceRequests.tutorId, profile.id),
        eq(absenceRequests.status, "pending"),
      ),
    )
    .returning({ id: absenceRequests.id });

  if (updated.length === 0) {
    return {
      ok: false,
      error: "取り消せませんでした（既に処理済みの可能性があります）。",
    };
  }

  revalidatePath("/tutor/absences");
  revalidatePath("/admin/requests");
  return { ok: true };
}

const DecideInput = z.object({
  id: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
  decisionNote: z.string().trim().max(500).optional().default(""),
});

/** 教室長: 欠勤申請を承認 / 却下 */
export async function decideAbsenceRequest(
  input: unknown,
): Promise<ActionResult> {
  const { profile } = await requireRole("admin");

  const parsed = DecideInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "入力が不正です。",
    };
  }
  const { id, decision, decisionNote } = parsed.data;

  if (decision === "rejected" && decisionNote.length === 0) {
    return { ok: false, error: "却下する場合は理由を入力してください。" };
  }

  const updated = await db
    .update(absenceRequests)
    .set({
      status: decision,
      decidedBy: profile.id,
      decidedAt: new Date(),
      decisionNote: decisionNote.length > 0 ? decisionNote : null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(absenceRequests.id, id),
        eq(absenceRequests.status, "pending"),
      ),
    )
    .returning({ id: absenceRequests.id });

  if (updated.length === 0) {
    return {
      ok: false,
      error: "処理できませんでした（既に対応済みの可能性があります）。",
    };
  }

  revalidatePath("/admin/requests");
  revalidatePath("/tutor/absences");
  return { ok: true };
}
