"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import {
  fixedShiftSubmissions,
  periods,
  profiles,
  regularShiftPeriods,
  shiftChangeRequests,
} from "@/db/schema";
import { isUniqueViolation } from "@/lib/db-errors";
import { notify } from "@/lib/notifications";
import { closeExpiredGrants } from "@/lib/shift-change";
import { unlockUntilFrom } from "@/lib/shift-change-rule";
import { noticeDate, jstToday } from "@/lib/week";

/**
 * #333: 提出期間外のシフト変更申請 (教室長側)。
 *
 * 承認 = 「変えてよい」という許可。中身はそのあと講師が入れ直す。
 * `unlocked_until` (承認から 3 日) までその講師だけ編集できる。
 */

type ActionResult = { ok: true } | { ok: false; error: string };

function revalidate() {
  revalidatePath("/admin/requests");
  revalidatePath("/admin/training");
  revalidatePath("/admin/fixed-shifts");
  revalidatePath("/tutor/fixed-shifts");
  revalidatePath("/tutor/training");
}

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

/** 期限の日付 (JST) を通知の文に出す形で */
function untilLabel(until: Date): string {
  return noticeDate(jstToday(until));
}

/**
 * レギュラーの承認: その期の提出 (提出済み・凍結) を下書きに戻し、講師が
 * すぐ直せるようにする。期が無いときは最新の提出 1 件を戻す。
 */
async function reopenRegularSubmission(
  tutorId: string,
  regularPeriodId: string | null,
  adminId: string,
  now: Date,
) {
  let effectiveFroms: string[] = [];
  if (regularPeriodId) {
    const [p] = await db
      .select({
        startDate: regularShiftPeriods.startDate,
        endDate: regularShiftPeriods.endDate,
      })
      .from(regularShiftPeriods)
      .where(eq(regularShiftPeriods.id, regularPeriodId))
      .limit(1);
    if (!p) return;
    const rows = await db
      .select({ effectiveFrom: fixedShiftSubmissions.effectiveFrom })
      .from(fixedShiftSubmissions)
      .where(
        and(
          eq(fixedShiftSubmissions.tutorId, tutorId),
          gte(fixedShiftSubmissions.effectiveFrom, p.startDate),
          lte(fixedShiftSubmissions.effectiveFrom, p.endDate),
        ),
      );
    effectiveFroms = rows.map((r) => r.effectiveFrom);
  } else {
    const rows = await db
      .select({ effectiveFrom: fixedShiftSubmissions.effectiveFrom })
      .from(fixedShiftSubmissions)
      .where(eq(fixedShiftSubmissions.tutorId, tutorId))
      .orderBy(desc(fixedShiftSubmissions.effectiveFrom))
      .limit(1);
    effectiveFroms = rows.map((r) => r.effectiveFrom);
  }
  if (effectiveFroms.length === 0) return;
  await db
    .update(fixedShiftSubmissions)
    .set({
      status: "draft",
      submittedAt: null,
      updatedAt: now,
      lastStatusChangedAt: now,
      lastStatusChangedBy: adminId,
    })
    .where(
      and(
        eq(fixedShiftSubmissions.tutorId, tutorId),
        inArray(fixedShiftSubmissions.effectiveFrom, effectiveFroms),
        inArray(fixedShiftSubmissions.status, ["submitted", "frozen"]),
      ),
    );
}

export async function decideShiftChange(input: unknown): Promise<ActionResult> {
  const { profile } = await requireRole("admin");
  const parsed = DecideInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "入力が不正です。",
    };
  }
  const { id, decision, note } = parsed.data;
  const now = new Date();
  const until = unlockUntilFrom(now);

  const [row] = await db
    .update(shiftChangeRequests)
    .set({
      status: decision,
      decidedBy: profile.id,
      decidedAt: now,
      decisionNote: note || null,
      unlockedUntil: decision === "approved" ? until : null,
    })
    .where(
      and(
        eq(shiftChangeRequests.id, id),
        eq(shiftChangeRequests.status, "pending"),
      ),
    )
    .returning({
      tutorId: shiftChangeRequests.tutorId,
      kind: shiftChangeRequests.kind,
      regularPeriodId: shiftChangeRequests.regularPeriodId,
      trainingPeriodId: shiftChangeRequests.trainingPeriodId,
    });
  if (!row) {
    return {
      ok: false,
      error: "この申請は既に処理されています。画面を読み込み直してください。",
    };
  }

  if (decision === "approved" && row.kind === "regular") {
    try {
      await reopenRegularSubmission(
        row.tutorId,
        row.regularPeriodId,
        profile.id,
        now,
      );
    } catch (e) {
      // 下書きに戻せなくても許可は有効 (講師が「下書きに戻す」を押せば直せる)
      console.error("reopenRegularSubmission failed", e);
    }
  }

  const label = row.kind === "regular" ? "レギュラー" : "講習";
  const href =
    row.kind === "regular"
      ? "/tutor/fixed-shifts"
      : `/tutor/training?period=${row.trainingPeriodId}`;
  await notify([row.tutorId], {
    type: "shift_change_result",
    title:
      decision === "approved"
        ? `${label}の変更申請が承認されました`
        : `${label}の変更申請が却下されました`,
    body:
      decision === "approved"
        ? row.kind === "regular"
          ? `${untilLabel(until)}まで変更できます。変えたら「提出」を押してください`
          : `${untilLabel(until)}まで変更できます。変え終わったら「変更を終える」を押してください`
        : `教室長より: ${note}`,
    href,
  });
  revalidate();
  return { ok: true };
}

/**
 * 講習: 教室長が、申請なしで 1 人だけ再開する (本人の要望、2026/11/17)。
 * 申請中のものがあればそれを承認し、無ければ承認済みの行を作る。
 */
export async function grantTrainingChange(
  input: unknown,
): Promise<ActionResult> {
  const { profile } = await requireRole("admin");
  const parsed = z
    .object({
      tutorId: z.string().uuid(),
      trainingPeriodId: z.string().uuid(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "入力が不正です。" };
  const { tutorId, trainingPeriodId } = parsed.data;
  const now = new Date();
  const until = unlockUntilFrom(now);

  const [[tutor], [period]] = await Promise.all([
    db
      .select({ id: profiles.id })
      .from(profiles)
      .where(and(eq(profiles.id, tutorId), eq(profiles.isActive, true)))
      .limit(1),
    db
      .select({ name: periods.name, isArchived: periods.isArchived })
      .from(periods)
      .where(eq(periods.id, trainingPeriodId))
      .limit(1),
  ]);
  if (!tutor) return { ok: false, error: "講師が見つかりません。" };
  if (!period || period.isArchived) {
    return { ok: false, error: "講習期間が見つかりません。" };
  }

  await closeExpiredGrants(tutorId, now);
  const decided = {
    status: "approved" as const,
    decidedBy: profile.id,
    decidedAt: now,
    unlockedUntil: until,
  };
  // 申請中があれば、それを承認する
  const approvedPending = await db
    .update(shiftChangeRequests)
    .set(decided)
    .where(
      and(
        eq(shiftChangeRequests.tutorId, tutorId),
        eq(shiftChangeRequests.kind, "training"),
        eq(shiftChangeRequests.trainingPeriodId, trainingPeriodId),
        eq(shiftChangeRequests.status, "pending"),
      ),
    )
    .returning({ id: shiftChangeRequests.id });
  if (approvedPending.length === 0) {
    try {
      await db.insert(shiftChangeRequests).values({
        tutorId,
        kind: "training",
        trainingPeriodId,
        reason: "教室長が再開",
        ...decided,
      });
    } catch (e) {
      if (isUniqueViolation(e, "shift_change_requests_active_training_uniq")) {
        return { ok: false, error: "この講師は既に変更できる状態です。" };
      }
      console.error("grantTrainingChange failed", e);
      return {
        ok: false,
        error: "再開に失敗しました。時間をおいてお試しください。",
      };
    }
  }

  await notify([tutorId], {
    type: "shift_change_result",
    title: "講習の希望を変更できるようになりました",
    body: `対象: ${period.name} ／ 教室長が再開しました。${untilLabel(until)}まで変更できます。変え終わったら「変更を終える」を押してください`,
    href: `/tutor/training?period=${trainingPeriodId}`,
  });
  revalidate();
  return { ok: true };
}
