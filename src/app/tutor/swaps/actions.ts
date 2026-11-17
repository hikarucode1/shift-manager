"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { notify } from "@/lib/notifications";
import { getSlotMeta } from "@/lib/slot-meta";
import { db } from "@/db/client";
import { swapApplications, swapRequests, weeklyShifts } from "@/db/schema";
import { isUniqueViolation } from "@/lib/db-errors";
import { getActiveApplicantIds, isTutorBusyAt } from "@/lib/swaps";
import { jstToday } from "@/lib/week";

type ActionResult = { ok: true } | { ok: false; error: string };

function revalidateAll() {
  revalidatePath("/tutor/swaps");
  revalidatePath("/tutor/open-swaps");
  revalidatePath("/admin/requests");
}

// #331 (2026/11/17): 講師が自分で相手を選ぶ交代申請はやめた。交代は欠勤申請 →
// 教室長が相手を指定 → 欠勤の画面から依頼 (designated-actions.ts) の流れだけ。
// ここに残すのは、それ以前に出された申請の取消・応募・応募取下げ。

const IdInput = z.object({ id: z.string().uuid() });

/** 講師: 自分の pending 申請を取消 */
export async function cancelSwapRequest(input: unknown): Promise<ActionResult> {
  const { profile } = await requireRole("tutor");
  const parsed = IdInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "入力が不正です。" };

  // ⚠️ **教室長の代理募集 (#227) は講師が取り下げられない** (#231)。
  // `requester_id` は「休む講師」なので、代理で作られた募集も講師の一覧に出て
  // このボタンで消せてしまう。しかし `cancelSwapRequest` は通知を出さず、
  // **教室長は通知画面を持たない** (`/tutor/notifications` は tutor 限定) ため、
  // 教室長は募集が消えたことに気づけず応募を待ち続ける。
  // 塞いでも詰まない — 教室長側に `cancelOpenSwapOnBehalf` がある。
  const target = await db
    .select({
      id: swapRequests.id,
      createdBy: swapRequests.createdBy,
      status: swapRequests.status,
    })
    .from(swapRequests)
    .where(
      and(
        eq(swapRequests.id, parsed.data.id),
        eq(swapRequests.requesterId, profile.id),
      ),
    )
    .limit(1);
  if (target.length === 0) {
    return { ok: false, error: "取り消せませんでした。" };
  }
  if (target[0].createdBy !== null && target[0].createdBy !== profile.id) {
    return {
      ok: false,
      error:
        "この募集は教室長が作成したものです。取り下げは教室長に依頼してください。",
    };
  }

  const updated = await db
    .update(swapRequests)
    .set({
      status: "cancelled",
      closeKind: "tutor_withdraw",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(swapRequests.id, parsed.data.id),
        eq(swapRequests.requesterId, profile.id),
        eq(swapRequests.status, "pending"),
      ),
    )
    .returning({
      id: swapRequests.id,
      date: swapRequests.date,
      slotNumber: swapRequests.slotNumber,
    });
  if (updated.length === 0) {
    return { ok: false, error: "取り消せませんでした。" };
  }

  // ⚠️ **応募者に通知する (#245)**。#238 で承認・却下・教室長の取り下げは
  // 揃えたが、申請者本人の取り消しだけ無音だった。募集は status が pending で
  // なくなって /tutor/open-swaps から消えるので、引き受けるつもりで予定を
  // 空けた応募者は結果を知る手段が無い。「募集したが自分で都合をつけた」は
  // 日常的なので、頻度はむしろ却下より高い。
  //
  // ⚠️ 取り消しに理由は求めない。教室長の操作 (#219 / #231) で理由を必須に
  // したのは**他人の記録を動かす**からで、自分の申請を引っ込めるのとは違う。
  //
  // ⚠️ 取得は UPDATE の「後」。理由は getActiveApplicantIds の docstring 参照。
  // ここは新規に足した DB 呼び出しなので try/catch で囲む — 投げると取り消し
  // 自体は済んでいるのに画面はエラーになり、再実行もできない (#244 で踏んだ)。
  try {
    const applicants = await getActiveApplicantIds(parsed.data.id);
    if (applicants.length > 0) {
      const meta = await getSlotMeta();
      const slotLabel =
        meta.get(updated[0].slotNumber)?.label ?? `${updated[0].slotNumber}限`;
      await notify(applicants, {
        type: "swap_result",
        title: "応募していた代講の募集が取り下げられました",
        body: `対象: ${updated[0].date} ${slotLabel} ／ 申請者が取り下げました`,
        href: "/tutor/open-swaps",
      });
    }
  } catch (e) {
    console.error("cancelSwapRequest notify applicants failed", e);
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
      absenceRequestId: swapRequests.absenceRequestId,
    })
    .from(swapRequests)
    .where(eq(swapRequests.id, swapRequestId))
    .limit(1);
  if (reqRows.length === 0) {
    return { ok: false, error: "募集が見つかりません。" };
  }
  // #331: 欠勤で教室長が指定した相手への依頼は、「引き受ける / 断る」で返事
  // する (引き受けるとその場で成立)。応募にすると教室長の承認待ちに化ける
  if (reqRows[0].absenceRequestId !== null) {
    return {
      ok: false,
      error: "この依頼は「引き受ける」か「断る」で返事してください。",
    };
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
  // 「誰が実際にそのコマに入ったか」を記録する経路で、is_override と note で
  // 監査痕跡も残る (#215 で `recordSubstitution` が加わったが、応募済みの案件を
  // わざわざ記録側へ移させる必要はない)。同日の終了済みコマを塞ぐと、
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

      // #259: 申請者が今もそのコマの担当かを見る。**`decideSwapRequest` が
      // 付け替えに使う条件と同じ**なので、ここで無ければその募集は承認され得
      // ない (「付け替え対象の確定シフトが見つかりません」で必ず落ちる)。
      //
      // 担当が変わるのは記録 (#215) / 承認 / 取り消し / CSV 再取り込みの 4 経路。
      // 記録の後は募集が pending のまま残るため (#253 の案 B)、塞がないと
      // **通知も届かないまま承認され得ない募集を待つ**講師が出る。
      //
      // ⚠️ 一覧 (`getOpenSwapsForTutor`) からも同時に落としてある。ここだけ
      // 塞ぐと**押すと必ず失敗する dead button** になる (#165/#178・#231 で
      // 2 度潰した型)。逆に一覧から落とすだけでは直リンクと競合が通る。
      //
      // ⚠️ tx 内の追加クエリだが**同一接続**なので、tx を握ったまま 2 本目の
      // 接続を要求しないという client.ts の max:3 (#209) の前提は破らない。
      const stillAssigned = await tx
        .select({ id: weeklyShifts.id })
        .from(weeklyShifts)
        .where(
          and(
            eq(weeklyShifts.tutorId, r.requesterId),
            eq(weeklyShifts.date, r.date),
            eq(weeklyShifts.slotNumber, r.slotNumber),
          ),
        )
        .limit(1);
      if (stillAssigned.length === 0) {
        return {
          ok: false,
          error:
            "このコマは担当が変わったため、この募集には応募できません。教室長にご確認ください。",
        };
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
    return {
      ok: false,
      error: "応募に失敗しました。時間をおいて再度お試しください。",
    };
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
    return {
      ok: false,
      error: "取り下げに失敗しました。時間をおいて再度お試しください。",
    };
  }

  if (!outcome.ok) return outcome;
  revalidateAll();
  return { ok: true };
}
