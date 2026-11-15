"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, isNotNull } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { notify } from "@/lib/notifications";
import { db } from "@/db/client";
import {
  absenceRequests,
  swapApplications,
  swapRequests,
  weeklyShifts,
} from "@/db/schema";
import { isUniqueViolation } from "@/lib/db-errors";
import { hasSlotEnded, isTutorBusyAt } from "@/lib/swaps";
import { slotLabelSafe } from "@/lib/slot-meta";
import { approveSwapInTx, SwapBizError } from "@/lib/swap-approval";

/**
 * #331: 欠勤で教室長が指定した相手への代講依頼。
 *
 * 1. `requestDesignatedSubstitute` — 休む講師が、指定された相手に依頼する
 * 2. `acceptDesignatedSubstitution` — 相手が引き受ける。**その場で成立**
 *    (相手は教室長が既に決めているので、教室長の承認を待たない)
 * 3. `declineDesignatedSubstitution` — 相手が断る。依頼は閉じ、欠勤は承認
 *    されたまま残る (教室長が次の相手を決める)
 */

type ActionResult = { ok: true } | { ok: false; error: string };

function revalidateAll() {
  revalidatePath("/tutor/absences");
  revalidatePath("/tutor/swaps");
  revalidatePath("/tutor/open-swaps");
  revalidatePath("/tutor");
  revalidatePath("/admin/requests");
}

/** 休む講師: 教室長が指定した相手に代講を依頼する */
export async function requestDesignatedSubstitute(
  input: unknown,
): Promise<ActionResult> {
  const { profile } = await requireRole("tutor");
  const parsed = z.object({ absenceId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "入力が不正です。" };

  const [absence] = await db
    .select({
      id: absenceRequests.id,
      date: absenceRequests.date,
      slotNumber: absenceRequests.slotNumber,
      reason: absenceRequests.reason,
      designatedId: absenceRequests.designatedSubstituteId,
    })
    .from(absenceRequests)
    .where(
      and(
        eq(absenceRequests.id, parsed.data.absenceId),
        eq(absenceRequests.tutorId, profile.id),
        eq(absenceRequests.status, "approved"),
      ),
    )
    .limit(1);
  if (!absence) {
    return {
      ok: false,
      error: "対象の欠勤が見つかりません（承認済みの欠勤だけ依頼できます）。",
    };
  }
  const designatedId = absence.designatedId;
  if (!designatedId) {
    return { ok: false, error: "教室長が代講の相手を指定していません。" };
  }
  if (await hasSlotEnded(absence.date, absence.slotNumber)) {
    return { ok: false, error: "終了したコマは依頼できません。" };
  }
  // まだ自分の担当か (担当でなければ代わってもらうコマが無い)
  const [shift] = await db
    .select({ id: weeklyShifts.id })
    .from(weeklyShifts)
    .where(
      and(
        eq(weeklyShifts.tutorId, profile.id),
        eq(weeklyShifts.date, absence.date),
        eq(weeklyShifts.slotNumber, absence.slotNumber),
      ),
    )
    .limit(1);
  if (!shift) {
    return {
      ok: false,
      error:
        "このコマは今はあなたの担当ではありません。教室長に確認してください。",
    };
  }
  if (await isTutorBusyAt(absence.date, absence.slotNumber, designatedId)) {
    return {
      ok: false,
      error:
        "指定された講師が同じコマに出勤予定になっています。教室長に連絡してください。",
    };
  }

  try {
    await db.insert(swapRequests).values({
      requesterId: profile.id,
      createdBy: profile.id,
      kind: "named",
      nominatedTutorId: designatedId,
      date: absence.date,
      slotNumber: absence.slotNumber,
      reason: absence.reason,
      absenceRequestId: absence.id,
    });
  } catch (e) {
    // 同じコマに出したままの交代申請がある (依頼済みを含む)
    if (isUniqueViolation(e, "swap_requests_active_uniq")) {
      return { ok: false, error: "このコマには既に依頼中の申請があります。" };
    }
    console.error("requestDesignatedSubstitute failed", e);
    return {
      ok: false,
      error: "依頼に失敗しました。時間をおいてお試しください。",
    };
  }

  const slotLabel = await slotLabelSafe(absence.slotNumber);
  await notify([designatedId], {
    type: "swap_posted",
    title: "代講の依頼がありました（教室長の指定）",
    body: `対象: ${absence.date} ${slotLabel} ／ ${profile.displayName}さんの代講。「代講」の画面から引き受けるか断るかを選んでください`,
    href: "/tutor/open-swaps",
  });

  revalidateAll();
  return { ok: true };
}

const SwapIdInput = z.object({ swapRequestId: z.string().uuid() });

/** 指定された相手: 代講を引き受ける。その場で成立する */
export async function acceptDesignatedSubstitution(
  input: unknown,
): Promise<ActionResult> {
  const { profile } = await requireRole("tutor");
  const parsed = SwapIdInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "入力が不正です。" };
  const { swapRequestId } = parsed.data;

  // 決めた人 (decided_by) は、相手を指定した教室長にする (引き受けたのは本人
  // だが、誰にするかを決めたのは教室長なので)。帰属のためだけの読み取りで、
  // 判定は下のトランザクションの中でやり直す
  const [head] = await db
    .select({ designatedBy: absenceRequests.decidedBy })
    .from(swapRequests)
    .innerJoin(
      absenceRequests,
      eq(absenceRequests.id, swapRequests.absenceRequestId),
    )
    .where(eq(swapRequests.id, swapRequestId))
    .limit(1);
  if (!head) return { ok: false, error: "依頼が見つかりません。" };

  let info;
  try {
    info = await db.transaction((tx) =>
      approveSwapInTx(tx, {
        swapRequestId,
        decidedBy: head.designatedBy ?? profile.id,
        // ⚠️ 募集の行ロックを取ったあとに呼ばれる
        resolveApplicant: async () => {
          const [row] = await tx
            .select({
              nominatedTutorId: swapRequests.nominatedTutorId,
              absenceStatus: absenceRequests.status,
            })
            .from(swapRequests)
            .innerJoin(
              absenceRequests,
              eq(absenceRequests.id, swapRequests.absenceRequestId),
            )
            .where(
              and(
                eq(swapRequests.id, swapRequestId),
                eq(swapRequests.kind, "named"),
                isNotNull(swapRequests.absenceRequestId),
              ),
            )
            .limit(1);
          if (!row || row.nominatedTutorId !== profile.id) {
            throw new SwapBizError("この依頼はあなた宛てではありません。");
          }
          // 教室長が欠勤を取り消していたら、休む講師は出勤する
          if (row.absenceStatus !== "approved") {
            throw new SwapBizError(
              "欠勤が取り消されたため、この依頼は無効になりました。",
            );
          }
          // 引き受けを応募の行として残す (「応募して選ばれた」と同じ見え方にする)
          await tx
            .insert(swapApplications)
            .values({ swapRequestId, applicantId: profile.id })
            .onConflictDoUpdate({
              target: [
                swapApplications.swapRequestId,
                swapApplications.applicantId,
              ],
              set: { withdrawnAt: null },
            });
          return profile.id;
        },
      }),
    );
  } catch (e) {
    if (e instanceof SwapBizError) return { ok: false, error: e.message };
    console.error("acceptDesignatedSubstitution failed", e);
    return {
      ok: false,
      error: "引き受けに失敗しました。時間をおいてお試しください。",
    };
  }

  const slotLabel = await slotLabelSafe(info.slotNumber);
  await Promise.all([
    notify([info.requesterId], {
      type: "swap_result",
      title: "代講が決まりました",
      body: `対象: ${info.date} ${slotLabel} ／ 代講: ${info.applicantName}さん`,
      href: "/tutor/absences",
    }),
    notify([info.applicantId], {
      type: "swap_result",
      title: "代講が確定しました",
      body: `対象: ${info.date} ${slotLabel} (${info.requesterName}さんの代講)`,
      href: "/tutor",
    }),
  ]);

  revalidateAll();
  return { ok: true };
}

/** 指定された相手: 代講を断る。依頼は閉じ、欠勤は承認されたまま残る */
export async function declineDesignatedSubstitution(
  input: unknown,
): Promise<ActionResult> {
  const { profile } = await requireRole("tutor");
  const parsed = SwapIdInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "入力が不正です。" };

  const updated = await db
    .update(swapRequests)
    .set({
      status: "cancelled",
      closeKind: "nominee_declined",
      decidedBy: profile.id,
      decidedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(swapRequests.id, parsed.data.swapRequestId),
        eq(swapRequests.status, "pending"),
        eq(swapRequests.nominatedTutorId, profile.id),
        isNotNull(swapRequests.absenceRequestId),
      ),
    )
    .returning({
      requesterId: swapRequests.requesterId,
      date: swapRequests.date,
      slotNumber: swapRequests.slotNumber,
    });
  if (updated.length === 0) {
    return {
      ok: false,
      error: "処理できませんでした（既に対応済みの可能性があります）。",
    };
  }

  const u = updated[0];
  const slotLabel = await slotLabelSafe(u.slotNumber);
  await notify([u.requesterId], {
    type: "swap_result",
    title: "代講の依頼が断られました",
    body: `対象: ${u.date} ${slotLabel} ／ ${profile.displayName}さんが都合がつきませんでした。教室長からの連絡を待ってください`,
    href: "/tutor/absences",
  });

  revalidateAll();
  return { ok: true };
}
