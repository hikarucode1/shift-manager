"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import { profiles, swapApplications, swapRequests, weeklyShifts } from "@/db/schema";

type ActionResult = { ok: true } | { ok: false; error: string };

/** 承認処理中の「ユーザーに見せてよい」業務エラー (DB エラー等と区別) */
class SwapBizError extends Error {}

function revalidateAll() {
  revalidatePath("/admin/requests");
  revalidatePath("/tutor/swaps");
  revalidatePath("/tutor/open-swaps");
  revalidatePath("/tutor");
}

const DecideInput = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("approved"),
    id: z.string().uuid(),
    applicationId: z.string().uuid(),
  }),
  z.object({
    decision: z.literal("rejected"),
    id: z.string().uuid(),
    decisionNote: z.string().trim().min(1, "却下理由を入力してください。").max(500),
  }),
]);

/**
 * 教室長: 交代申請を承認 / 却下。
 * 承認時は requester の weekly_shift を選ばれた応募者へ付け替え
 * (tutor_id 変更 + is_override=true)。shift_assignments は行に紐づくため
 * そのまま代講者へ引き継がれる。全てトランザクション内。
 */
export async function decideSwapRequest(
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
  const data = parsed.data;

  if (data.decision === "rejected") {
    const updated = await db
      .update(swapRequests)
      .set({
        status: "rejected",
        decidedBy: profile.id,
        decidedAt: new Date(),
        decisionNote: data.decisionNote,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(swapRequests.id, data.id),
          eq(swapRequests.status, "pending"),
        ),
      )
      .returning({ id: swapRequests.id });
    if (updated.length === 0) {
      return { ok: false, error: "処理できませんでした（対応済みの可能性）。" };
    }
    revalidateAll();
    return { ok: true };
  }

  // ---- 承認 ----
  try {
    await db.transaction(async (tx) => {
      const reqRows = await tx
        .select({
          requesterId: swapRequests.requesterId,
          date: swapRequests.date,
          slotNumber: swapRequests.slotNumber,
          status: swapRequests.status,
        })
        .from(swapRequests)
        .where(eq(swapRequests.id, data.id))
        .limit(1);
      if (reqRows.length === 0 || reqRows[0].status !== "pending") {
        throw new SwapBizError("対応済みの可能性があります。");
      }
      const req = reqRows[0];

      const appRows = await tx
        .select({
          applicantId: swapApplications.applicantId,
        })
        .from(swapApplications)
        .where(
          and(
            eq(swapApplications.id, data.applicationId),
            eq(swapApplications.swapRequestId, data.id),
            isNull(swapApplications.withdrawnAt),
          ),
        )
        .limit(1);
      if (appRows.length === 0) {
        throw new SwapBizError("選択した応募者が見つかりません。");
      }
      const applicantId = appRows[0].applicantId;

      // 代講者が同じコマに既に出勤予定なら不可 (weekly_shifts_unique)
      const clash = await tx
        .select({ id: weeklyShifts.id })
        .from(weeklyShifts)
        .where(
          and(
            eq(weeklyShifts.tutorId, applicantId),
            eq(weeklyShifts.date, req.date),
            eq(weeklyShifts.slotNumber, req.slotNumber),
          ),
        )
        .limit(1);
      if (clash.length > 0) {
        throw new SwapBizError("代講者は既にそのコマに出勤予定です。");
      }

      // 代講メモ用に氏名取得
      const names = await tx
        .select({ id: profiles.id, name: profiles.displayName })
        .from(profiles)
        .where(inArray(profiles.id, [req.requesterId, applicantId]));
      const nameOf = (id: string) =>
        names.find((n) => n.id === id)?.name ?? "不明";
      const subNote = `代講(承認済): ${nameOf(req.requesterId)} → ${nameOf(applicantId)}`;

      // requester の確定シフトを代講者へ付け替え
      const reassigned = await tx
        .update(weeklyShifts)
        .set({ tutorId: applicantId, isOverride: true, note: subNote })
        .where(
          and(
            eq(weeklyShifts.tutorId, req.requesterId),
            eq(weeklyShifts.date, req.date),
            eq(weeklyShifts.slotNumber, req.slotNumber),
          ),
        )
        .returning({ id: weeklyShifts.id });
      if (reassigned.length === 0) {
        throw new SwapBizError("付け替え対象の確定シフトが見つかりません。");
      }

      // status='pending' を条件に「奪う」更新。同時承認は rowcount 0 で弾く
      const claimed = await tx
        .update(swapRequests)
        .set({
          status: "approved",
          approvedApplicantId: applicantId,
          decidedBy: profile.id,
          decidedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(swapRequests.id, data.id),
            eq(swapRequests.status, "pending"),
          ),
        )
        .returning({ id: swapRequests.id });
      if (claimed.length === 0) {
        // 競合: 別承認が先に確定 → トランザクションごとロールバック
        throw new SwapBizError("既に他の操作で確定済みです。");
      }
    });
  } catch (e) {
    console.error("decideSwapRequest approve failed", e);
    // 想定内の業務エラーのみ文言を返す。DB エラー等は汎用文言
    if (e instanceof SwapBizError) {
      return { ok: false, error: e.message };
    }
    return {
      ok: false,
      error: "承認に失敗しました。時間をおいて再度お試しください。",
    };
  }

  revalidateAll();
  return { ok: true };
}
