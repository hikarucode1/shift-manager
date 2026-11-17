"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, gte } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import { periods, regularShiftPeriods, shiftChangeRequests } from "@/db/schema";
import { isUniqueViolation } from "@/lib/db-errors";
import { notifyAdmins } from "@/lib/notifications";
import { closeExpiredGrants, closeGrant } from "@/lib/shift-change";
import { pickRegularChangeTarget } from "@/lib/shift-change-rule";
import { computeEditable } from "@/lib/training";

/**
 * #333: 提出期間外のシフト変更申請 (講師側)。
 *
 * 承認されると `unlocked_until` までその講師だけ編集できる。レギュラーは
 * 出し直す (提出) と、講習は「変更を終える」を押すと許可を閉じる。
 */

type ActionResult = { ok: true } | { ok: false; error: string };

const RequestInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("regular"),
    reason: z.string().trim().min(1, "理由を入力してください。").max(500),
  }),
  z.object({
    kind: z.literal("training"),
    trainingPeriodId: z.string().uuid(),
    reason: z.string().trim().min(1, "理由を入力してください。").max(500),
  }),
]);

function revalidate() {
  revalidatePath("/tutor/fixed-shifts");
  revalidatePath("/tutor/training");
  revalidatePath("/admin/requests");
}

export async function requestShiftChange(
  input: unknown,
): Promise<ActionResult> {
  const { profile } = await requireRole("tutor");
  const parsed = RequestInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "入力が不正です。",
    };
  }
  const data = parsed.data;
  const now = new Date();
  await closeExpiredGrants(profile.id, now);

  let regularPeriodId: string | null = null;
  let trainingPeriodId: string | null = null;
  let targetLabel: string;

  if (data.kind === "regular") {
    const rows = await db
      .select({
        id: regularShiftPeriods.id,
        label: regularShiftPeriods.label,
        startDate: regularShiftPeriods.startDate,
        submissionOpensAt: regularShiftPeriods.submissionOpensAt,
        submissionDueAt: regularShiftPeriods.submissionDueAt,
      })
      .from(regularShiftPeriods)
      .where(eq(regularShiftPeriods.isArchived, false));
    const accepting = rows.some(
      (p) =>
        p.submissionOpensAt.getTime() <= now.getTime() &&
        now.getTime() <= p.submissionDueAt.getTime(),
    );
    if (accepting) {
      return {
        ok: false,
        error: "今は提出期間中です。申請しなくても、そのまま変更できます。",
      };
    }
    const target = pickRegularChangeTarget(rows, now);
    regularPeriodId = target?.id ?? null;
    targetLabel = target ? `レギュラー（${target.label}）` : "レギュラー";
  } else {
    const [p] = await db
      .select({
        name: periods.name,
        submissionDeadline: periods.submissionDeadline,
        isReopened: periods.isReopened,
        isArchived: periods.isArchived,
      })
      .from(periods)
      .where(eq(periods.id, data.trainingPeriodId))
      .limit(1);
    if (!p || p.isArchived || p.submissionDeadline === null) {
      return { ok: false, error: "対象の講習期間が見つかりません。" };
    }
    if (computeEditable(p.submissionDeadline, p.isReopened, now).editable) {
      return {
        ok: false,
        error: "まだ締切前です。申請しなくても、そのまま変更できます。",
      };
    }
    trainingPeriodId = data.trainingPeriodId;
    targetLabel = p.name;
  }

  try {
    await db.insert(shiftChangeRequests).values({
      tutorId: profile.id,
      kind: data.kind,
      regularPeriodId,
      trainingPeriodId,
      reason: data.reason,
    });
  } catch (e) {
    if (
      isUniqueViolation(e, "shift_change_requests_active_regular_uniq") ||
      isUniqueViolation(e, "shift_change_requests_active_training_uniq")
    ) {
      return {
        ok: false,
        error: "すでに申請中か、変更できる状態です。画面を読み込み直してください。",
      };
    }
    console.error("requestShiftChange failed", e);
    return {
      ok: false,
      error: "申請に失敗しました。時間をおいてお試しください。",
    };
  }

  const short =
    data.reason.length > 60 ? `${data.reason.slice(0, 60)}…` : data.reason;
  await notifyAdmins(
    {
      type: "shift_change_requested",
      title: `${profile.displayName}さんからシフトの変更申請が届きました`,
      body: `対象: ${targetLabel} ／ 理由: ${short}`,
      href: "/admin/requests",
    },
    { exceptProfileId: profile.id },
  );
  revalidate();
  return { ok: true };
}

/** 申請中の変更申請を取り下げる */
export async function cancelShiftChangeRequest(
  input: unknown,
): Promise<ActionResult> {
  const { profile } = await requireRole("tutor");
  const parsed = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "入力が不正です。" };
  const rows = await db
    .update(shiftChangeRequests)
    .set({ status: "closed", closedAt: new Date() })
    .where(
      and(
        eq(shiftChangeRequests.id, parsed.data.id),
        eq(shiftChangeRequests.tutorId, profile.id),
        eq(shiftChangeRequests.status, "pending"),
      ),
    )
    .returning({ id: shiftChangeRequests.id });
  if (rows.length === 0) {
    return {
      ok: false,
      error: "取り下げられませんでした。画面を読み込み直してください。",
    };
  }
  revalidate();
  return { ok: true };
}

/**
 * 講習: 承認された変更を終える。講習は押すたびに保存されるので「提出」が無い。
 * 終えた合図で許可を閉じ、教室長に知らせる
 */
export async function finishTrainingChange(
  input: unknown,
): Promise<ActionResult> {
  const { profile } = await requireRole("tutor");
  const parsed = z.object({ trainingPeriodId: z.string().uuid() }).safeParse(
    input,
  );
  if (!parsed.success) return { ok: false, error: "入力が不正です。" };
  const now = new Date();
  const [row] = await db
    .select({ id: shiftChangeRequests.id, name: periods.name })
    .from(shiftChangeRequests)
    .innerJoin(periods, eq(periods.id, shiftChangeRequests.trainingPeriodId))
    .where(
      and(
        eq(shiftChangeRequests.tutorId, profile.id),
        eq(shiftChangeRequests.kind, "training"),
        eq(shiftChangeRequests.trainingPeriodId, parsed.data.trainingPeriodId),
        eq(shiftChangeRequests.status, "approved"),
        gte(shiftChangeRequests.unlockedUntil, now),
      ),
    )
    .limit(1);
  if (!row || !(await closeGrant(row.id, now))) {
    return {
      ok: false,
      error: "変更できる状態ではありません。画面を読み込み直してください。",
    };
  }
  await notifyAdmins(
    {
      type: "shift_change_done",
      title: `${profile.displayName}さんが講習の希望を変更しました`,
      body: `対象: ${row.name} ／ 変更申請が承認されたあとの変更です。提出状況で中身を確認してください`,
      href: `/admin/training?period=${parsed.data.trainingPeriodId}`,
    },
    { exceptProfileId: profile.id },
  );
  revalidate();
  return { ok: true };
}

