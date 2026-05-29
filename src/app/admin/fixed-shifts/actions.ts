"use server";

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import { fixedShiftSubmissions } from "@/db/schema";
import {
  isValidStatusTransition,
  type ShiftSubmissionStatus,
} from "@/lib/shift-submission-state";

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const FreezeInput = z.object({
  tutorId: z.string().uuid(),
  effectiveFrom: IsoDate,
  /** true = frozen 化、false = frozen から draft に戻す */
  freeze: z.boolean(),
});

export type SetSubmissionFrozenResult =
  | { ok: true; newStatus: ShiftSubmissionStatus }
  | { ok: false; error: string };

/**
 * C1 #62: 教室長が講師の提出を frozen / unfreeze する。
 *
 * - freeze=true: 現状の draft / submitted を frozen に上書き
 * - freeze=false: 現状の frozen を draft に戻す (submitted には直接戻せない仕様。
 *   admin が解除したら講師に「再 submit してください」と促す経路)
 *
 * 防御:
 * - requireRole("admin") で UI 経路は権限ガード
 * - UPDATE WHERE に旧 status 条件を含め returning で空チェック (race / 並行操作)
 * - DB 側 trigger `fixed_shift_submissions_status_transition_trg` が
 *   不正遷移 (frozen → submitted 等) を最終防御
 * - 状態遷移ルールはアプリ層も `isValidStatusTransition` で事前検証
 */
export async function setSubmissionFrozen(
  input: unknown,
): Promise<SetSubmissionFrozenResult> {
  const parsed = FreezeInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "入力値が正しくありません。" };
  }
  const { tutorId, effectiveFrom, freeze } = parsed.data;

  const { profile: adminProfile } = await requireRole("admin");
  const now = new Date();

  const rows = await db
    .select({
      status: fixedShiftSubmissions.status,
      submittedAt: fixedShiftSubmissions.submittedAt,
    })
    .from(fixedShiftSubmissions)
    .where(
      and(
        eq(fixedShiftSubmissions.tutorId, tutorId),
        eq(fixedShiftSubmissions.effectiveFrom, effectiveFrom),
      ),
    )
    .limit(1);
  const current = rows[0];
  if (!current) {
    return { ok: false, error: "対象の提出が見つかりません。" };
  }

  const nextStatus: ShiftSubmissionStatus = freeze ? "frozen" : "draft";
  if (!isValidStatusTransition(current.status, nextStatus)) {
    return {
      ok: false,
      error: `この提出は ${current.status} 状態のため ${nextStatus} に変更できません。`,
    };
  }
  if (current.status === nextStatus) {
    // 既に目的の状態。冪等に成功扱い。
    return { ok: true, newStatus: nextStatus };
  }

  // frozen 化のとき submitted_at の扱い:
  //   submitted → frozen: 提出時刻を保持 (admin 解除→講師再 submit 時に上書き)
  //   draft → frozen: submitted_at は null のまま
  //   frozen → draft: submitted_at を null に戻す (draft の不変条件)
  const nextSubmittedAt =
    nextStatus === "draft" ? null : current.submittedAt;

  const updated = await db
    .update(fixedShiftSubmissions)
    .set({
      status: nextStatus,
      submittedAt: nextSubmittedAt,
      updatedAt: now,
      lastStatusChangedAt: now,
      lastStatusChangedBy: adminProfile.id,
    })
    .where(
      and(
        eq(fixedShiftSubmissions.tutorId, tutorId),
        eq(fixedShiftSubmissions.effectiveFrom, effectiveFrom),
        eq(fixedShiftSubmissions.status, current.status),
      ),
    )
    .returning({ status: fixedShiftSubmissions.status });

  if (updated.length === 0) {
    return {
      ok: false,
      error: "状態が変わりました。ページを再読込してください。",
    };
  }

  revalidatePath("/admin/fixed-shifts");
  revalidatePath("/tutor/fixed-shifts");
  return { ok: true, newStatus: updated[0].status as ShiftSubmissionStatus };
}
