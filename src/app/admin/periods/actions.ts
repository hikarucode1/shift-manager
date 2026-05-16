"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import { periods } from "@/db/schema";
import { isValidIsoDate } from "@/lib/week";

type ActionResult = { ok: true } | { ok: false; error: string };

const isoDate = z
  .string()
  .refine((v) => isValidIsoDate(v), "日付の形式が正しくありません。");

/**
 * 講習期間の締切は「その日の終わり (JST 23:59:59.999)」として timestamp 化。
 * 締切当日いっぱい (ミリ秒末まで) を提出可能にするため .999 を含める。
 */
function deadlineToTimestamp(dateIso: string): Date {
  return new Date(`${dateIso}T23:59:59.999+09:00`);
}

const PeriodInput = z
  .object({
    kind: z.enum(["normal", "training"]),
    name: z.string().trim().min(1, "名称を入力してください。").max(80),
    startDate: isoDate,
    endDate: isoDate,
    /** 講習のみ。normal では無視 */
    submissionDeadline: isoDate.optional().nullable(),
  })
  .refine((v) => v.startDate <= v.endDate, {
    message: "開始日は終了日以前にしてください。",
    path: ["endDate"],
  })
  .refine(
    (v) =>
      v.kind === "normal" ||
      (typeof v.submissionDeadline === "string" &&
        v.submissionDeadline.length > 0),
    { message: "講習期間は提出締切日が必須です。", path: ["submissionDeadline"] },
  )
  .refine(
    (v) =>
      v.kind === "training" ||
      v.submissionDeadline == null ||
      v.submissionDeadline === "",
    { message: "通常期間に締切日は設定できません。", path: ["submissionDeadline"] },
  )
  .refine(
    (v) =>
      v.kind !== "training" ||
      !v.submissionDeadline ||
      v.submissionDeadline <= v.startDate,
    {
      message: "提出締切日は講習開始日以前にしてください。",
      path: ["submissionDeadline"],
    },
  );

export async function createPeriod(input: unknown): Promise<ActionResult> {
  const { profile } = await requireRole("admin");

  const parsed = PeriodInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "入力が不正です。",
    };
  }
  const v = parsed.data;

  await db.insert(periods).values({
    kind: v.kind,
    name: v.name,
    startDate: v.startDate,
    endDate: v.endDate,
    submissionDeadline:
      v.kind === "training" && v.submissionDeadline
        ? deadlineToTimestamp(v.submissionDeadline)
        : null,
    createdBy: profile.id,
  });

  revalidatePath("/admin/periods");
  return { ok: true };
}

const UpdateInput = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, "名称を入力してください。").max(80),
  startDate: isoDate,
  endDate: isoDate,
  submissionDeadline: isoDate.optional().nullable(),
});

export async function updatePeriod(input: unknown): Promise<ActionResult> {
  await requireRole("admin");

  const parsed = UpdateInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "入力が不正です。",
    };
  }
  const v = parsed.data;
  if (v.startDate > v.endDate) {
    return { ok: false, error: "開始日は終了日以前にしてください。" };
  }

  const rows = await db
    .select({ kind: periods.kind })
    .from(periods)
    .where(eq(periods.id, v.id))
    .limit(1);
  if (rows.length === 0) {
    return { ok: false, error: "対象の期間が見つかりません。" };
  }
  const kind = rows[0].kind;

  if (kind === "training") {
    if (!(typeof v.submissionDeadline === "string" && v.submissionDeadline)) {
      return { ok: false, error: "講習期間は提出締切日が必須です。" };
    }
    if (v.submissionDeadline > v.startDate) {
      return {
        ok: false,
        error: "提出締切日は講習開始日以前にしてください。",
      };
    }
  }

  await db
    .update(periods)
    .set({
      name: v.name,
      startDate: v.startDate,
      endDate: v.endDate,
      submissionDeadline:
        kind === "training" && v.submissionDeadline
          ? deadlineToTimestamp(v.submissionDeadline)
          : null,
      updatedAt: new Date(),
    })
    .where(eq(periods.id, v.id));

  revalidatePath("/admin/periods");
  return { ok: true };
}

const ToggleInput = z.object({
  id: z.string().uuid(),
  value: z.boolean(),
});

/** アーカイブ / 復帰 */
export async function setPeriodArchived(
  input: unknown,
): Promise<ActionResult> {
  await requireRole("admin");
  const parsed = ToggleInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "入力が不正です。" };

  await db
    .update(periods)
    .set({ isArchived: parsed.data.value, updatedAt: new Date() })
    .where(eq(periods.id, parsed.data.id));

  revalidatePath("/admin/periods");
  return { ok: true };
}

/** 締切後の再開放 / 解除 (講習のみ意味を持つ) */
export async function setPeriodReopened(
  input: unknown,
): Promise<ActionResult> {
  await requireRole("admin");
  const parsed = ToggleInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "入力が不正です。" };

  const rows = await db
    .select({ kind: periods.kind })
    .from(periods)
    .where(eq(periods.id, parsed.data.id))
    .limit(1);
  if (rows.length === 0) {
    return { ok: false, error: "対象の期間が見つかりません。" };
  }
  if (rows[0].kind !== "training") {
    return { ok: false, error: "通常期間に再開放はありません。" };
  }

  await db
    .update(periods)
    .set({ isReopened: parsed.data.value, updatedAt: new Date() })
    .where(eq(periods.id, parsed.data.id));

  revalidatePath("/admin/periods");
  return { ok: true };
}
