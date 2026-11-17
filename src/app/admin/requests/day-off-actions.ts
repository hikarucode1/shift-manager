"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import { dayOffRequests } from "@/db/schema";
import { dayOffSlotsLabel } from "@/lib/day-off-rule";
import { notify } from "@/lib/notifications";
import { getSlotMeta } from "@/lib/slot-meta";
import { noticeDate } from "@/lib/week";

/**
 * #360: 先の日の休み希望 (教室長側)。承認すると、その週のシフトを作るとき
 * (取り込み・週の表) に休みとして出る。
 */

type ActionResult = { ok: true } | { ok: false; error: string };

const DecideInput = z
  .object({
    id: z.string().uuid(),
    decision: z.enum(["approved", "rejected"]),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.decision === "approved" || !!v.note, {
    message: "却下する場合は理由を入力してください。",
    path: ["note"],
  });

export async function decideDayOffRequest(
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
  const { id, decision, note } = parsed.data;

  const [row] = await db
    .update(dayOffRequests)
    .set({
      status: decision,
      decidedBy: profile.id,
      decidedAt: new Date(),
      decisionNote: note || null,
    })
    .where(and(eq(dayOffRequests.id, id), eq(dayOffRequests.status, "pending")))
    .returning({
      tutorId: dayOffRequests.tutorId,
      date: dayOffRequests.date,
      slotNumbers: dayOffRequests.slotNumbers,
    });
  if (!row) {
    return {
      ok: false,
      error: "この休み希望は既に処理されています。画面を読み込み直してください。",
    };
  }

  const meta = await getSlotMeta().catch(() => new Map());
  const label = (n: number) => meta.get(n)?.label ?? `${n}限`;
  const what = `${noticeDate(row.date)} ${dayOffSlotsLabel(row.slotNumbers, label)}`;
  await notify([row.tutorId], {
    type: "day_off_result",
    title:
      decision === "approved"
        ? "休み希望が承認されました"
        : "休み希望が却下されました",
    body:
      decision === "approved"
        ? `${what} ／ この日はシフトに入れません`
        : `${what} ／ 教室長より: ${note}`,
    href: "/tutor/day-offs",
  });
  revalidatePath("/admin/requests");
  revalidatePath("/admin/weekly");
  revalidatePath("/tutor/day-offs");
  return { ok: true };
}
