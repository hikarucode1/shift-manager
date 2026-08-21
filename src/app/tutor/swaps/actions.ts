"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { and, arrayContains, eq, inArray, isNull } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { notify } from "@/lib/notifications";
import { db } from "@/db/client";
import {
  absenceRequests,
  profiles,
  swapApplications,
  swapRequests,
  weeklyShifts,
} from "@/db/schema";
import { isUniqueViolation } from "@/lib/db-errors";
import { getEligibleApplicantIds, hasSlotEnded, isTutorBusyAt } from "@/lib/swaps";
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

  // #178: 新規の募集だけはコマ単位で弾く。終了したコマを今から募集しても
  // 代わってもらう相手が居ないため (既に済んだ分の記録は承認側で扱う)。
  if (await hasSlotEnded(date, slotNumber)) {
    return { ok: false, error: "終了したコマは申請できません。" };
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

  // クロス整合 (#33): 同一コマに非終端の欠勤申請があれば交代申請は不可。
  // TOCTOU の残存リスクは createAbsenceRequest 側コメント参照 (#33 C1)。
  const absenceDup = await db
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
  if (absenceDup.length > 0) {
    // 欠勤が承認済みだと講師は自分で取消できない (cancelAbsenceRequest は
    // pending 限定) ため、特定の操作を指示せず状態非依存の文言にする (#33 C3)
    return {
      ok: false,
      error:
        "このコマには欠勤申請があります。重複するため交代申請はできません（必要なら教室長にご相談ください）。",
    };
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
          arrayContains(profiles.roles, ["tutor"]),
          eq(profiles.isActive, true),
        ),
      )
      .limit(1);
    if (nt.length === 0) {
      return { ok: false, error: "指名先の講師が見つかりません。" };
    }
    // 指名先が同じコマに既に出勤予定だと applyToSwap の clash ガードで応募でき
    // ないため、作成時点で弾く。これで申請者にその場で理由が伝わり、一覧に
    // 応募不能な dead-end 行が出るのも防げる (通知先は下の named 分岐で確定)。
    if (await isTutorBusyAt(date, slotNumber, nominatedTutorId as string)) {
      return {
        ok: false,
        error: "その講師は同じコマに出勤予定のため指名できません。",
      };
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
    if (isUniqueViolation(e, "swap_requests_active_uniq")) {
      return { ok: false, error: "このコマには既に交代申請があります。" };
    }
    console.error("createSwapRequest failed", e);
    return { ok: false, error: "申請に失敗しました。時間をおいてお試しください。" };
  }

  // #155: 新規募集を関連講師へ通知する。応答をブロックしないよう after() で
  // レスポンス確定後に実行する (募集自体は上で commit 済み。after なら bare な
  // un-awaited promise と違いサーバーレスでも完了が保証される)。
  after(async () => {
    try {
      // open は「応募資格のある講師 (現役 tutor・自分以外・同コマ未出勤)」全員へ。
      // named は指名先 1 名へ (作成時に role/active + 同コマ clash を検証済みなので
      // ここでの資格再判定は不要)。
      const recipientIds =
        kind === "open"
          ? await getEligibleApplicantIds(date, slotNumber, profile.id)
          : nominatedTutorId
            ? [nominatedTutorId]
            : [];
      await notify(recipientIds, {
        type: "swap_posted",
        title:
          kind === "open"
            ? "代講募集が追加されました"
            : "交代の指名がありました",
        body: `対象: ${date} ${slotNumber}限${kind === "named" ? "（あなた宛の指名）" : ""}`,
        href: "/tutor/open-swaps",
      });
    } catch (e) {
      console.error("createSwapRequest notify failed", e);
    }
  });

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
  // #165: 過去日のコマには応募不可 (実施済みコマの担当が事後に書き換わるのを防ぐ)。
  //
  // ⚠️ **ここは日付粒度のまま**にする (#178 のレビュー結論)。承認は
  // 「誰が実際にそのコマに入ったか」を記録できる唯一の業務経路で、
  // is_override と note で監査痕跡も残る。同日の終了済みコマを塞ぐと、
  // 実際は代講が入ったのに記録は元の講師のまま確定してしまう
  // (weekly_shifts を直す admin 画面は無く、CSV 再取り込みはその日の代講記録を
  // 全消しする)。塾の運用では 8 限が 21:25 に終わり、教室長の事務作業は
  // その後なので、同日中の処理を残すことが要る。
  if (r.date < jstToday()) {
    return { ok: false, error: "過去のコマには応募できません。" };
  }

  // 同じコマに自分が既に出勤している場合は代講不可
  if (await isTutorBusyAt(r.date, r.slotNumber, profile.id)) {
    return {
      ok: false,
      error: "そのコマは既にあなたが出勤予定のため応募できません。",
    };
  }

  // #165: 募集行を FOR UPDATE でロックして status を再検証してから upsert する。
  // 従来は check-then-write で、締切/承認された募集に競合で応募が入りえた。また
  // 併発 INSERT で swap_applications_unique に当たると生 500 になっていたため
  // isUniqueViolation で明示エラーにする (取り下げ済み → 復活 / 無 → 作成)。
  let outcome: ActionResult;
  try {
    outcome = await db.transaction(async (tx) => {
      const cur = await tx
        .select({ status: swapRequests.status })
        .from(swapRequests)
        .where(eq(swapRequests.id, swapRequestId))
        .for("update")
        .limit(1);
      if (cur.length === 0) {
        return { ok: false, error: "募集が見つかりません。" };
      }
      if (cur[0].status !== "pending") {
        return { ok: false, error: "この募集は既に締め切られています。" };
      }
      const existing = await tx
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
        await tx
          .update(swapApplications)
          .set({ withdrawnAt: null, note: note || null })
          .where(eq(swapApplications.id, existing[0].id));
      } else {
        await tx.insert(swapApplications).values({
          swapRequestId,
          applicantId: profile.id,
          note: note || null,
        });
      }
      return { ok: true };
    });
  } catch (e) {
    if (isUniqueViolation(e, "swap_applications_unique")) {
      return { ok: false, error: "既に応募済みです。" };
    }
    console.error("applyToSwap failed", e);
    return { ok: false, error: "応募に失敗しました。時間をおいて再度お試しください。" };
  }

  if (!outcome.ok) return outcome;
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

  // #165: 募集を FOR UPDATE でロックし、pending の間だけ取り下げを許可する。
  // 承認/却下/取消済み (非 pending) の募集の応募を取り下げると、承認済み応募
  // (weekly_shift 付け替え済) と withdrawnAt がねじれるため塞ぐ。
  let outcome: ActionResult;
  try {
    outcome = await db.transaction(async (tx) => {
      const req = await tx
        .select({
          status: swapRequests.status,
          approvedApplicantId: swapRequests.approvedApplicantId,
        })
        .from(swapRequests)
        .where(eq(swapRequests.id, parsed.data.id))
        .for("update")
        .limit(1);
      if (req.length === 0) {
        return { ok: false, error: "募集が見つかりません。" };
      }
      // #165: 取り下げを塞ぐのは「承認済みで、かつ自分が採用された応募者」のときだけ。
      // その応募は weekly_shift の付け替え済みなので取り下げると整合が崩れる。
      // 落選者や却下/取消の応募は取り下げても害が無く、塞ぐと「取り下げられない
      // 残存応募」になり混乱するので許可する (レビュー指摘)。
      if (
        req[0].status === "approved" &&
        req[0].approvedApplicantId === profile.id
      ) {
        return {
          ok: false,
          error: "あなたの代講が確定済みのため取り下げできません。",
        };
      }
      const updated = await tx
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
      return { ok: true };
    });
  } catch (e) {
    console.error("withdrawApplication failed", e);
    return { ok: false, error: "取り下げに失敗しました。時間をおいて再度お試しください。" };
  }

  if (!outcome.ok) return outcome;
  revalidateAll();
  return { ok: true };
}
