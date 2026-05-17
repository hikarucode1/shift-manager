"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import {
  profiles,
  swapApplications,
  swapRequests,
  weeklyShifts,
} from "@/db/schema";
import { isValidIsoDate, jstToday } from "@/lib/week";

type ActionResult = { ok: true } | { ok: false; error: string };

function revalidateAll() {
  revalidatePath("/tutor/swaps");
  revalidatePath("/tutor/open-swaps");
  revalidatePath("/admin/requests");
}

const CreateInput = z
  .object({
    date: z.string().refine(isValidIsoDate, "日付が不正です。"),
    slotNumber: z.number().int().min(1).max(20),
    reason: z.string().trim().min(1, "理由を入力してください。").max(500),
    kind: z.enum(["named", "open"]),
    nominatedTutorId: z.string().uuid().optional().nullable(),
  })
  .refine((v) => v.kind === "open" || !!v.nominatedTutorId, {
    message: "指名交代は相手の講師を選択してください。",
    path: ["nominatedTutorId"],
  });

/** 講師: 交代申請を作成 (自分の今後の確定シフトに対して) */
export async function createSwapRequest(
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
  const { date, slotNumber, reason, kind } = parsed.data;
  const nominatedTutorId =
    kind === "named" ? parsed.data.nominatedTutorId ?? null : null;

  if (date < jstToday()) {
    return { ok: false, error: "過去の日付は申請できません。" };
  }

  // 自分の実在する確定シフトか
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

  // 指名先の妥当性
  if (kind === "named") {
    if (nominatedTutorId === profile.id) {
      return { ok: false, error: "自分自身は指名できません。" };
    }
    const nt = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(
        and(
          eq(profiles.id, nominatedTutorId as string),
          eq(profiles.role, "tutor"),
          eq(profiles.isActive, true),
        ),
      )
      .limit(1);
    if (nt.length === 0) {
      return { ok: false, error: "指名先の講師が見つかりません。" };
    }
  }

  try {
    await db.insert(swapRequests).values({
      requesterId: profile.id,
      kind,
      nominatedTutorId,
      date,
      slotNumber,
      reason,
    });
  } catch (e) {
    if (e instanceof Error && /active_uniq|unique/i.test(e.message)) {
      return { ok: false, error: "このコマには既に交代申請があります。" };
    }
    console.error("createSwapRequest failed", e);
    return { ok: false, error: "申請に失敗しました。時間をおいてお試しください。" };
  }

  revalidateAll();
  return { ok: true };
}

const IdInput = z.object({ id: z.string().uuid() });

/** 講師: 自分の pending 申請を取消 */
export async function cancelSwapRequest(
  input: unknown,
): Promise<ActionResult> {
  const { profile } = await requireRole("tutor");
  const parsed = IdInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "入力が不正です。" };

  const updated = await db
    .update(swapRequests)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(
      and(
        eq(swapRequests.id, parsed.data.id),
        eq(swapRequests.requesterId, profile.id),
        eq(swapRequests.status, "pending"),
      ),
    )
    .returning({ id: swapRequests.id });
  if (updated.length === 0) {
    return { ok: false, error: "取り消せませんでした。" };
  }
  revalidateAll();
  return { ok: true };
}

const ApplyInput = z.object({
  swapRequestId: z.string().uuid(),
  note: z.string().trim().max(300).optional().default(""),
});

/** 講師: 代講募集に応募 (指名なら自分が指名先のときのみ) */
export async function applyToSwap(input: unknown): Promise<ActionResult> {
  const { profile } = await requireRole("tutor");
  const parsed = ApplyInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "入力が不正です。" };
  const { swapRequestId, note } = parsed.data;

  const reqRows = await db
    .select({
      requesterId: swapRequests.requesterId,
      kind: swapRequests.kind,
      nominatedTutorId: swapRequests.nominatedTutorId,
      status: swapRequests.status,
      date: swapRequests.date,
      slotNumber: swapRequests.slotNumber,
    })
    .from(swapRequests)
    .where(eq(swapRequests.id, swapRequestId))
    .limit(1);
  if (reqRows.length === 0) {
    return { ok: false, error: "募集が見つかりません。" };
  }
  const r = reqRows[0];
  if (r.status !== "pending") {
    return { ok: false, error: "この募集は既に締め切られています。" };
  }
  if (r.requesterId === profile.id) {
    return { ok: false, error: "自分の募集には応募できません。" };
  }
  if (r.kind === "named" && r.nominatedTutorId !== profile.id) {
    return { ok: false, error: "この交代はあなた宛ではありません。" };
  }

  // 同じコマに自分が既に出勤している場合は代講不可
  const clash = await db
    .select({ id: weeklyShifts.id })
    .from(weeklyShifts)
    .where(
      and(
        eq(weeklyShifts.tutorId, profile.id),
        eq(weeklyShifts.date, r.date),
        eq(weeklyShifts.slotNumber, r.slotNumber),
      ),
    )
    .limit(1);
  if (clash.length > 0) {
    return {
      ok: false,
      error: "そのコマは既にあなたが出勤予定のため応募できません。",
    };
  }

  // 取り下げ済みなら復活、無ければ作成 (unique: swap_request × applicant)
  const existing = await db
    .select({ id: swapApplications.id })
    .from(swapApplications)
    .where(
      and(
        eq(swapApplications.swapRequestId, swapRequestId),
        eq(swapApplications.applicantId, profile.id),
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    await db
      .update(swapApplications)
      .set({ withdrawnAt: null, note: note || null })
      .where(eq(swapApplications.id, existing[0].id));
  } else {
    await db.insert(swapApplications).values({
      swapRequestId,
      applicantId: profile.id,
      note: note || null,
    });
  }

  revalidateAll();
  return { ok: true };
}

/** 講師: 応募を取り下げ */
export async function withdrawApplication(
  input: unknown,
): Promise<ActionResult> {
  const { profile } = await requireRole("tutor");
  const parsed = IdInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "入力が不正です。" };

  const updated = await db
    .update(swapApplications)
    .set({ withdrawnAt: new Date() })
    .where(
      and(
        eq(swapApplications.swapRequestId, parsed.data.id),
        eq(swapApplications.applicantId, profile.id),
        isNull(swapApplications.withdrawnAt),
      ),
    )
    .returning({ id: swapApplications.id });
  if (updated.length === 0) {
    return { ok: false, error: "取り下げられませんでした。" };
  }
  revalidateAll();
  return { ok: true };
}
