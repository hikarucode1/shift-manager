"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { and, arrayContains, eq, inArray, isNull, ne } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { notify } from "@/lib/notifications";
import { ABSENCE_AUTO_EXPIRED_NOTE } from "@/lib/absence-expiry";
import { getEligibleApplicantIds, hasSlotEnded, isTutorBusyAt } from "@/lib/swaps";
import { substitutionNote } from "@/lib/substitution-note";
import { isValidIsoDate, jstToday } from "@/lib/week";
import { isUniqueViolation } from "@/lib/db-errors";
import { getSlotMeta } from "@/lib/slot-meta";
import { db } from "@/db/client";
import {
  absenceRequests,
  profiles,
  swapApplications,
  swapRequests,
  weeklyShifts,
} from "@/db/schema";

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
      .returning({
        id: swapRequests.id,
        requesterId: swapRequests.requesterId,
        date: swapRequests.date,
        slotNumber: swapRequests.slotNumber,
      });
    if (updated.length === 0) {
      return { ok: false, error: "処理できませんでした（対応済みの可能性）。" };
    }
    await notify([updated[0].requesterId], {
      type: "swap_result",
      title: "交代・代講申請が却下されました",
      body: `対象: ${updated[0].date} ${updated[0].slotNumber}限 ／ ${data.decisionNote}`,
      href: "/tutor/swaps",
    });
    revalidateAll();
    return { ok: true };
  }

  // ---- 承認 ----
  // 通知はトランザクション確定後に送るため、tx の戻り値で情報を持ち出す
  let approvedInfo: {
    requesterId: string;
    applicantId: string;
    requesterName: string;
    applicantName: string;
    date: string;
    slotNumber: number;
  } | null = null;
  try {
    approvedInfo = await db.transaction(async (tx) => {
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

      // #165: 過去日 (実施済み) のコマは承認しない。承認は weekly_shifts を
      // 代講者へ付け替えるため、日を跨いだ書き換えを防ぐ。
      //
      // ⚠️ **コマ単位まで厳しくしないこと** (#178 のレビュー結論)。承認は
      // 「誰が実際にそのコマに入ったか」を記録する経路で、is_override と
      // `代講(承認済): A → B` の note で監査痕跡も残る (#215 で
      // `recordSubstitution` が加わり「唯一の経路」ではなくなったが、
      // **承認をコマ単位で塞ぐ理由にはならない** — 応募まで進んだ案件を
      // 記録側へ移し替えさせるのは遠回り)。同日の
      // 終了済みコマを塞ぐと、実際は代講が入ったのに記録は元の講師のまま
      // 確定する (weekly_shifts を直す admin 画面は無く、CSV 再取り込みは
      // その日の代講記録を全消しする)。8 限は 21:25 終了で、教室長の事務作業は
      // その後なので、同日中の承認を残すことが運用上必要。
      //
      // ⚠️ ここを DB 参照 (hasSlotEnded) にしてはいけない。tx を握ったまま
      // 同じプールへ 2 本目を要求することになり、max:3 かつキュー待ちに上限が
      // 無いので承認が 3 本重なるとハングする (client.ts の前提を破る)。
      if (req.date < jstToday()) {
        throw new SwapBizError(
          "過去のコマの交代は承認できません (既に実施済みです)。",
        );
      }

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
      if (await isTutorBusyAt(req.date, req.slotNumber, applicantId, tx)) {
        throw new SwapBizError("代講者は既にそのコマに出勤予定です。");
      }

      // 代講メモ用に氏名取得
      const names = await tx
        .select({ id: profiles.id, name: profiles.displayName })
        .from(profiles)
        .where(inArray(profiles.id, [req.requesterId, applicantId]));
      const nameOf = (id: string) =>
        names.find((n) => n.id === id)?.name ?? "不明";
      const subNote = substitutionNote(
        nameOf(req.requesterId),
        nameOf(applicantId),
      );

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

      // クロス整合 (#33): requester はこのコマを失うので、同一コマの
      // 非終端 欠勤申請を自動失効。
      //
      // ⚠️ **これは defensive な掃除ではなく通常経路** (#217 で変わった)。
      // 教室長の代理登録 (`createAbsenceOnBehalf`) は pending 交代を塞がない
      // (「交代を募集したが応募が無く結局休んだ」を塞ぐと詰むため) ので、
      // 「approved 欠勤 + pending 交代」は正規の手順で作れる状態になった。
      // #217 以前は受容済み TOCTOU からしか到達しない状態だったが、
      // **今はここが主経路**。dead code と誤認して削らないこと。
      await tx
        .update(absenceRequests)
        .set({
          status: "cancelled",
          // ⚠️ **`decided_by` を null にする** (#225)。触らないと、承認済み
          // だった欠勤が失効したとき「承認した教室長」がそのまま残り、画面に
          // 「取り消し: (その人の名前)」と出る。実際に取り消したのはその人では
          // ない。失効は誰の判断でもないので、名前は消して時刻だけ残す
          decidedBy: null,
          decidedAt: new Date(),
          decisionNote: ABSENCE_AUTO_EXPIRED_NOTE,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(absenceRequests.tutorId, req.requesterId),
            eq(absenceRequests.date, req.date),
            eq(absenceRequests.slotNumber, req.slotNumber),
            inArray(absenceRequests.status, ["pending", "approved"]),
          ),
        );

      return {
        requesterId: req.requesterId,
        applicantId,
        requesterName: nameOf(req.requesterId),
        applicantName: nameOf(applicantId),
        date: req.date,
        slotNumber: req.slotNumber,
      };
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

  if (approvedInfo) {
    const a = approvedInfo;
    await Promise.all([
      notify([a.requesterId], {
        type: "swap_result",
        title: "交代・代講申請が承認されました",
        body: `対象: ${a.date} ${a.slotNumber}限 ／ 代講: ${a.applicantName}さん`,
        href: "/tutor/swaps",
      }),
      notify([a.applicantId], {
        type: "swap_result",
        title: "代講が確定しました",
        body: `対象: ${a.date} ${a.slotNumber}限 (${a.requesterName}さんの代講)`,
        href: "/tutor",
      }),
    ]);
  }

  revalidateAll();
  return { ok: true };
}

const CancelApprovedInput = z.object({
  // zod 既定の英語メッセージ ("Invalid UUID") がそのまま画面に出るのを防ぐ。
  // 失敗文言は parsed.error.issues[0].message を返す作りなので、ここで日本語にする
  id: z.string().uuid("対象が正しく指定されていません。"),
  reason: z
    .string()
    .trim()
    .min(1, "取り消し理由を入力してください。")
    .max(500, "取り消し理由は 500 文字以内で入力してください。"),
});

/**
 * 承認済みの交代・代講を取り消す (#213)。
 *
 * ⚠️ **これが無いと `approved` は終端状態**で、承認後に代講が流れた
 * (B が結局来なかった / 選び間違えた / 編成が変わった) ときに記録を実態へ
 * 戻す手段がアプリに存在しなかった。唯一の是正手段が「CSV を上げ直すと
 * weekly_shifts が作り直されて巻き戻る」という副作用の大きいバグ (#210) 頼み
 * という状態だった。
 *
 * ⚠️ 日付・コマのガードは付けない。#178 の結論どおり、これも「改竄」ではなく
 * **実態を記録する操作**で、むしろ過去のコマこそ是正したい場面がある。
 *
 * ⚠️ 承認時に自動失効させた同一コマの欠勤申請は**戻さない**。失効前が pending
 * だったか approved だったかは記録されておらず、推測で復元すると別の嘘になる。
 * 代わりに戻り値で呼び出し側に伝え、画面で「代理で欠勤を登録する」(#217) を
 * 促す。**講師の再申請を促してはいけない** — `createAbsenceRequest` は過去日を
 * 弾くので、終了したコマでは実行不能な案内になる。
 */
export async function cancelApprovedSwap(
  input: unknown,
): Promise<
  { ok: true; expiredAbsences: number } | { ok: false; error: string }
> {
  const { profile } = await requireRole("admin");
  const parsed = CancelApprovedInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "入力が不正です。",
    };
  }
  const { id, reason } = parsed.data;

  try {
    const info = await db.transaction(async (tx) => {
      const reqRows = await tx
        .select({
          requesterId: swapRequests.requesterId,
          approvedApplicantId: swapRequests.approvedApplicantId,
          date: swapRequests.date,
          slotNumber: swapRequests.slotNumber,
        })
        .from(swapRequests)
        .where(and(eq(swapRequests.id, id), eq(swapRequests.status, "approved")))
        .limit(1);

      const req = reqRows[0];
      if (!req) throw new SwapBizError("承認済みの交代が見つかりません。");
      if (!req.approvedApplicantId) {
        throw new SwapBizError("代講者の記録が無いため取り消せません。");
      }

      const names = await tx
        .select({ id: profiles.id, name: profiles.displayName })
        .from(profiles)
        .where(inArray(profiles.id, [req.requesterId, req.approvedApplicantId]));
      const nameOf = (pid: string) =>
        names.find((n) => n.id === pid)?.name ?? "不明";

      // ⚠️ 元講師が既にそのコマに居ると、戻す UPDATE が
      // weekly_shifts_unique (upload_id, tutor_id, date, slot_number) に衝突して
      // 23505 になり、汎用 catch の「時間をおいて再度お試しください」= **何度
      // やっても失敗するのに再試行を促す嘘**になる。到達経路は実在する:
      // A→B 承認後に A が別の代講で同じコマに入ると A は二重出勤になる。
      // 承認側 (isTutorBusyAt) と同じ意味のガードをここにも置く。
      if (await isTutorBusyAt(req.date, req.slotNumber, req.requesterId, tx)) {
        throw new SwapBizError(
          "元の講師は既にそのコマに出勤予定のため、担当を戻せません。",
        );
      }

      // ⚠️ 同じコマに他の承認済み代講がある (玉突き: A→B の後に B→C) 場合、
      // 元に戻すと「1 つ前」ではなく CSV 初期値まで戻ってしまい、生きている
      // 方の代講の痕跡 (is_override / note) まで消える。順番に取り消して
      // もらうため、ここでは止める。
      const others = await tx
        .select({ id: swapRequests.id })
        .from(swapRequests)
        .where(
          and(
            eq(swapRequests.status, "approved"),
            eq(swapRequests.date, req.date),
            eq(swapRequests.slotNumber, req.slotNumber),
            ne(swapRequests.id, id),
          ),
        );
      if (others.length > 0) {
        throw new SwapBizError(
          "同じコマに別の承認済み代講があります。新しい方から順に取り消してください。",
        );
      }

      // 元講師へ戻す。⚠️ **現在の担当が承認された代講者である場合に限る**。
      // CSV 取り込みや別の代講で既に変わっていたら、上書きせず止める
      // (黙って踏み潰すと、この機能が直そうとしている #210 の再演になる)。
      const restored = await tx
        .update(weeklyShifts)
        .set({ tutorId: req.requesterId, isOverride: false, note: null })
        .where(
          and(
            eq(weeklyShifts.tutorId, req.approvedApplicantId),
            eq(weeklyShifts.date, req.date),
            eq(weeklyShifts.slotNumber, req.slotNumber),
          ),
        )
        .returning({ id: weeklyShifts.id });

      if (restored.length === 0) {
        throw new SwapBizError(
          "このコマの担当が既に変わっているため取り消せません。週次シフトを確認してください。",
        );
      }

      // status='approved' を条件に「奪う」更新。同時操作は rowcount 0 で弾く
      const claimed = await tx
        .update(swapRequests)
        .set({
          status: "cancelled",
          decisionNote: reason,
          decidedBy: profile.id,
          // 承認時刻のままだと「誰が」と「いつ」が別イベントを指してしまう
          decidedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(swapRequests.id, id), eq(swapRequests.status, "approved")))
        .returning({ id: swapRequests.id });
      if (claimed.length === 0) {
        throw new SwapBizError("既に他の操作で確定済みです。");
      }

      // 承認時に自動失効させた欠勤申請の件数を数えるだけ (戻さない)
      const expired = await tx
        .select({ id: absenceRequests.id })
        .from(absenceRequests)
        .where(
          and(
            eq(absenceRequests.tutorId, req.requesterId),
            eq(absenceRequests.date, req.date),
            eq(absenceRequests.slotNumber, req.slotNumber),
            eq(absenceRequests.status, "cancelled"),
            eq(absenceRequests.decisionNote, ABSENCE_AUTO_EXPIRED_NOTE),
          ),
        );

      return {
        expiredAbsences: expired.length,
        requesterId: req.requesterId,
        applicantId: req.approvedApplicantId,
        requesterName: nameOf(req.requesterId),
        applicantName: nameOf(req.approvedApplicantId),
        date: req.date,
        slotNumber: req.slotNumber,
      };
    });

    // ⚠️ 承認は A・B 両方に通知するのに取り消しが無音だと、**A が「代わって
    // もらった」と思ったまま来ない = コマに誰も居ない**が起きる。B 側には
    // 「引き受けた代講」の一覧が無い (getTutorSwapRequests は requesterId 基準)
    // ので、B にとっては通知が唯一の手がかり。承認と同じく tx の外で送る。
    await Promise.all([
      notify([info.requesterId], {
        type: "swap_result",
        title: "代講の取り消し（あなたが担当に戻りました）",
        body: `対象: ${info.date} ${info.slotNumber}限 ／ 理由: ${reason}`,
        href: "/tutor",
      }),
      notify([info.applicantId], {
        type: "swap_result",
        title: "引き受けた代講が取り消されました",
        body: `対象: ${info.date} ${info.slotNumber}限 (${info.requesterName}さんの代講) ／ 理由: ${reason}`,
        href: "/tutor",
      }),
    ]);

    revalidateAll();
    revalidatePath("/admin/weekly");
    return { ok: true, expiredAbsences: info.expiredAbsences };
  } catch (e) {
    if (e instanceof SwapBizError) return { ok: false, error: e.message };
    console.error("cancelApprovedSwap failed", e);
    return {
      ok: false,
      error: "取り消しに失敗しました。時間をおいて再度お試しください。",
    };
  }
}


/* ------------------------------------------------------------------ */
/*  #227 代理募集 — 欠勤が確定したコマの代講を教室長が募集する          */
/* ------------------------------------------------------------------ */

const OnBehalfSwapInput = z.object({
  tutorId: z.string().uuid("講師が正しく指定されていません。"),
  date: z.string().refine(isValidIsoDate, "日付が不正です。"),
  slotNumber: z.number().int().min(1).max(20),
  reason: z
    .string()
    .trim()
    .min(1, "理由を入力してください。")
    .max(500, "理由は 500 文字以内で入力してください。"),
});

/**
 * 教室長が代理で代講を募集する (#227)。
 *
 * ⚠️ **`db.insert(swapRequests)` は従来 `createSwapRequest` の 1 本だけ**で、
 * `requireRole("tutor")` かつ `requesterId = profile.id` だった。つまり
 * **教室長が代講を募集する経路がアプリに存在しなかった**。#217 で教室長が
 * 欠勤を代理登録できるようにした結果、「自分で登録した欠勤に自分が塞がれて
 * 代講を手配できない」詰みが表に出た。
 *
 * ⚠️ **#33 の欠勤ガードを意図的に適用しない**。`createSwapRequest` は同一コマに
 * 非終端の欠勤があると弾くが、「欠勤が確定していて、その穴を代講で埋める」は
 * 矛盾しない。むしろそれが本命の流れ。1 コマ 1 ワークフローの原則は講師の
 * 自己申請には残し、教室長の手配には適用しない。
 *
 * ⚠️ **当日以降のみ**。`decideSwapRequest` が過去日の承認を拒否するため、
 * 過去日に募集を作っても誰も承認できない死に行になる。過去のコマは「募集」
 * ではなく「誰が入ったかの記録」の問題で、そちらは #215。
 *
 * ⚠️ `kind` は `open` 固定。指名 (`named`) は講師同士の関係に踏み込む操作で、
 * 教室長が指名すると指名先からは「頼まれた」のか「割り当てられた」のか
 * 区別が付かない。応募するかどうかは応募側に残す。
 */
export async function createOpenSwapOnBehalf(
  input: unknown,
): Promise<ActionResult> {
  const { profile } = await requireRole("admin");

  const parsed = OnBehalfSwapInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "入力が不正です。",
    };
  }
  const { tutorId, date, slotNumber, reason } = parsed.data;

  // #178 と同じ規則: **新規の募集はコマ単位で弾く**。終了したコマを今から
  // 募集しても代わってもらう相手が居ないため。講師側 (`createSwapRequest`) が
  // 同じ理由で `hasSlotEnded` を通しており、代理募集もこれと同じ「新規の募集」。
  // 日付粒度だけだと**当日の終了済みコマ**がすり抜け、誰も応募できない死に行が
  // できる (承認側は #178 の判断で当日を通すので、そこでは止まらない)。
  //
  // ⚠️ `decideSwapRequest` の「hasSlotEnded を使うな」は tx 内でプールを
  // 二重に掴む話。ここは tx を張っていないので該当しない。
  if (date < jstToday() || (await hasSlotEnded(date, slotNumber))) {
    return {
      ok: false,
      error:
        "終了したコマは募集できません（今から代わってもらう相手が居ないため）。実際に入った代講は「代講を記録する」から記録してください。",
    };
  }

  // 実在する確定シフトか。交代が承認済みなら weekly_shifts は代講者に
  // 付け替わっているので、ここで弾かれる
  const shift = await db
    .select({ id: weeklyShifts.id })
    .from(weeklyShifts)
    .where(
      and(
        eq(weeklyShifts.tutorId, tutorId),
        eq(weeklyShifts.date, date),
        eq(weeklyShifts.slotNumber, slotNumber),
      ),
    )
    .limit(1);
  if (shift.length === 0) {
    return { ok: false, error: "その講師はこのコマの担当ではありません。" };
  }

  try {
    await db.insert(swapRequests).values({
      requesterId: tutorId,
      createdBy: profile.id,
      kind: "open",
      date,
      slotNumber,
      reason,
    });
  } catch (e) {
    if (isUniqueViolation(e, "swap_requests_active_uniq")) {
      return { ok: false, error: "このコマには既に交代申請があります。" };
    }
    console.error("createOpenSwapOnBehalf failed", e);
    return {
      ok: false,
      error: "募集の作成に失敗しました。時間をおいてお試しください。",
    };
  }

  // #155 と同じ形。応答をブロックしないよう after() で送る
  after(async () => {
    try {
      const meta = await getSlotMeta();
      const slotLabel = meta.get(slotNumber)?.label ?? `${slotNumber}限`;
      const recipientIds = await getEligibleApplicantIds(
        date,
        slotNumber,
        tutorId,
      );
      await Promise.all([
        notify(recipientIds, {
          type: "swap_posted",
          title: "代講募集が追加されました",
          body: `対象: ${date} ${slotLabel}`,
          href: "/tutor/open-swaps",
        }),
        // ⚠️ 本人は募集を作っていないので、通知が唯一の手がかり。これが無いと
        // 「代講を手配してもらえたのか」が分からず、当日出勤するか迷う。
        // 型は swap_result が最も近い (募集の "結果" ではないが、講師向けの
        // 交代チャンネルはこれ)。href は本人の申請一覧へ向ける
        notify([tutorId], {
          type: "swap_result",
          title: "代講の募集が作成されました（教室長による代理）",
          body: `対象: ${date} ${slotLabel} ／ ${reason}`,
          href: "/tutor/swaps",
        }),
      ]);
    } catch (e) {
      console.error("createOpenSwapOnBehalf notify failed", e);
    }
  });

  revalidateAll();
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/*  #215 実施済みの代講を記録する / 教室長が代講者を確定させる            */
/* ------------------------------------------------------------------ */

const RecordSubstitutionInput = z.object({
  tutorId: z.string().uuid("担当の講師が正しく指定されていません。"),
  substituteId: z.string().uuid("代講者が正しく指定されていません。"),
  date: z.string().refine(isValidIsoDate, "日付が不正です。"),
  slotNumber: z.number().int().min(1).max(20),
  reason: z
    .string()
    .trim()
    .min(1, "理由を入力してください。")
    .max(500, "理由は 500 文字以内で入力してください。"),
});

/**
 * 教室長が「このコマは誰が入ったか」を直接記録する (#215)。
 *
 * ⚠️ **日付・コマのガードは付けない。** #227 の代理募集とはここが逆で、
 * あちらは「募集」なので終了したコマでは成立しない (代わってもらう相手が
 * 居ない) のに対し、こちらは**記録**。#178 / #211 / #213 / #219 と同じ結論で、
 * 過去こそ本命。用途は 2 つある:
 *   - 過去: 「先週、実際は B が入っていた」を後から記録する (#215 の起票理由)
 *   - 当日・未来: 「A が休む。B に電話したら入れると言った」を確定させる
 * 後者は #227 で意図的に外した「教室長による指名」の正しい形でもある。
 * 電話で手配済みの相手を、募集を出して応募を待たないと登録できないのは
 * 実務に合わない。
 *
 * ⚠️ `note` は `substitutionNote` を使い、承認経由の代講と**同じ形**にする。
 * `planSwapReapplication` (#212) が CSV 再取り込み後に承認済みの交代を
 * 再適用する際も同じ関数を使うため、ここだけ別形式にすると**CSV を上げ直した
 * 瞬間に標準形へ書き戻されて食い違う** (`substitution-note.ts` の警告どおり)。
 *
 * ⚠️ 同一コマの欠勤は `decideSwapRequest` と同じく自動失効させる。A は
 * そのコマの担当ではなくなるので、欠勤の記録を残すと週次シフト表と食い違う。
 *
 * ⚠️ 可逆。`cancelApprovedSwap` (#213) は日付ガードが無いので、記録を
 * 間違えても取り消して記録し直せる。新しい詰みは作らない。
 */
export async function recordSubstitution(
  input: unknown,
): Promise<
  | { ok: true; pendingSwap: boolean; expiredAbsences: number }
  | { ok: false; error: string }
> {
  const { profile } = await requireRole("admin");

  const parsed = RecordSubstitutionInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "入力が不正です。",
    };
  }
  const { tutorId, substituteId, date, slotNumber, reason } = parsed.data;

  if (tutorId === substituteId) {
    return { ok: false, error: "同じ講師を代講者にはできません。" };
  }

  // 未処理の交代申請が残っていないか (塞がないが、記録後は付け替え対象が
  // 変わって承認できなくなるので呼び出し側に伝える)
  const pending = await db
    .select({ id: swapRequests.id })
    .from(swapRequests)
    .where(
      and(
        eq(swapRequests.requesterId, tutorId),
        eq(swapRequests.date, date),
        eq(swapRequests.slotNumber, slotNumber),
        eq(swapRequests.status, "pending"),
      ),
    )
    .limit(1);

  let expiredAbsences = 0;
  try {
    await db.transaction(async (tx) => {
      const sub = await tx
        .select({ id: profiles.id, name: profiles.displayName })
        .from(profiles)
        .where(
          and(
            eq(profiles.id, substituteId),
            arrayContains(profiles.roles, ["tutor"]),
            eq(profiles.isActive, true),
          ),
        )
        .limit(1);
      if (sub.length === 0) {
        throw new SwapBizError("代講者の講師が見つかりません。");
      }

      // 代講者が同じコマに既に出勤予定なら不可 (weekly_shifts_unique)
      if (await isTutorBusyAt(date, slotNumber, substituteId, tx)) {
        throw new SwapBizError("その代講者は既にそのコマに出勤予定です。");
      }

      // ⚠️ 同一コマに承認済みの代講が既にあると**両方とも取り消せなくなる**。
      // `cancelApprovedSwap` は同一 date/slot に自分以外の approved 行が 1 本でも
      // あれば無条件に弾く (元に戻すと CSV 初期値まで戻り、生きている方の痕跡が
      // 消えるため)。2 本ある状態ではどちらを選んでもその分岐に落ちるので、
      // 「新しい方から順に」という案内も実行できない。
      // 記録は「既に代講が入っているコマ」を主対象にするので、ここを開けると
      // この PR が消しに来た一方通行のドアが別の形で戻る。先に取り消させる。
      const approvedDup = await tx
        .select({ id: swapRequests.id })
        .from(swapRequests)
        .where(
          and(
            eq(swapRequests.status, "approved"),
            eq(swapRequests.date, date),
            eq(swapRequests.slotNumber, slotNumber),
          ),
        )
        .limit(1);
      if (approvedDup.length > 0) {
        throw new SwapBizError(
          "このコマには既に承認済みの代講があります。先に「記録」タブでそれを取り消してから記録してください。",
        );
      }

      const owner = await tx
        .select({ id: profiles.id, name: profiles.displayName })
        .from(profiles)
        .where(eq(profiles.id, tutorId))
        .limit(1);
      const ownerName = owner[0]?.name ?? "不明";

      const inserted = await tx
        .insert(swapRequests)
        .values({
          requesterId: tutorId,
          createdBy: profile.id,
          kind: "recorded",
          date,
          slotNumber,
          reason,
          status: "approved",
          approvedApplicantId: substituteId,
          decidedBy: profile.id,
          decidedAt: new Date(),
        })
        .returning({ id: swapRequests.id });
      if (inserted.length === 0) {
        throw new SwapBizError("記録に失敗しました。");
      }

      const reassigned = await tx
        .update(weeklyShifts)
        .set({
          tutorId: substituteId,
          isOverride: true,
          note: substitutionNote(ownerName, sub[0].name),
        })
        .where(
          and(
            eq(weeklyShifts.tutorId, tutorId),
            eq(weeklyShifts.date, date),
            eq(weeklyShifts.slotNumber, slotNumber),
          ),
        )
        .returning({ id: weeklyShifts.id });
      if (reassigned.length === 0) {
        throw new SwapBizError("その講師はこのコマの担当ではありません。");
      }

      // decideSwapRequest と同じ扱い。A は担当ではなくなるので、欠勤を
      // 残すと週次シフト表と食い違う
      const expired = await tx
        .update(absenceRequests)
        .set({
          status: "cancelled",
          // ⚠️ **`decided_by` を null にする** (#225)。触らないと、承認済み
          // だった欠勤が失効したとき「承認した教室長」がそのまま残り、画面に
          // 「取り消し: (その人の名前)」と出る。実際に取り消したのはその人では
          // ない。失効は誰の判断でもないので、名前は消して時刻だけ残す
          decidedBy: null,
          decidedAt: new Date(),
          decisionNote: ABSENCE_AUTO_EXPIRED_NOTE,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(absenceRequests.tutorId, tutorId),
            eq(absenceRequests.date, date),
            eq(absenceRequests.slotNumber, slotNumber),
            inArray(absenceRequests.status, ["pending", "approved"]),
          ),
        )
        .returning({ id: absenceRequests.id });
      // ⚠️ 黙って失効させない。`cancelApprovedSwap` が expiredAbsences を返して
      // 画面に出しているのと揃える。#217 で登録した欠勤が消えたことに
      // 教室長が気づけないと、記録を取り消しても戻し忘れる
      expiredAbsences = expired.length;
    });
  } catch (e) {
    if (e instanceof SwapBizError) return { ok: false, error: e.message };
    console.error("recordSubstitution failed", e);
    return {
      ok: false,
      error: "記録に失敗しました。時間をおいて再度お試しください。",
    };
  }

  const meta = await getSlotMeta();
  const slotLabel = meta.get(slotNumber)?.label ?? `${slotNumber}限`;
  // ⚠️ 二人とも自分では何もしていないので、通知が唯一の手がかり。
  // 承認経由の代講が両者に通知しているのと揃える
  await Promise.all([
    notify([tutorId], {
      type: "swap_result",
      title: "代講が記録されました（教室長による記録）",
      body: `対象: ${date} ${slotLabel} ／ ${reason}`,
      href: "/tutor",
    }),
    notify([substituteId], {
      type: "swap_result",
      title: "代講の担当として記録されました",
      body: `対象: ${date} ${slotLabel} ／ ${reason}`,
      href: "/tutor",
    }),
  ]);

  revalidateAll();
  revalidatePath("/admin/weekly");
  return { ok: true, pendingSwap: pending.length > 0, expiredAbsences };
}

const CancelProxySwapInput = z.object({
  id: z.string().uuid("対象が正しく指定されていません。"),
  reason: z
    .string()
    .trim()
    .min(1, "取り下げ理由を入力してください。")
    .max(500, "取り下げ理由は 500 文字以内で入力してください。"),
});

/**
 * 教室長が自分の代理募集を取り下げる (#231)。
 *
 * ⚠️ **却下ではない。** 従来これを閉じる手段は `decideSwapRequest` の却下だけで、
 * 講師に「交代・代講申請が却下されました」と通知が飛んでいた。**本人は申請して
 * いない**ので、身に覚えのない申請が却下されたことになる。
 *
 * ⚠️ 対象は**代理募集のみ** (`created_by !== requester_id`)。講師本人の申請を
 * 閉じるのは教室長の「判断」なので、そちらは理由つきの却下が正しい。
 *
 * ⚠️ **応募者にも通知する。** 引き受けるつもりで予定を空けている可能性があり、
 * 募集が消えたことを知らせないと当日まで待たせる。
 * (`decideSwapRequest` の却下は応募者に通知していない = 既存の穴。同じ穴を
 * 知りながら開けたくないので、こちらは通知する)
 */
export async function cancelOpenSwapOnBehalf(
  input: unknown,
): Promise<ActionResult> {
  const { profile } = await requireRole("admin");

  const parsed = CancelProxySwapInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "入力が不正です。",
    };
  }
  const { id, reason } = parsed.data;

  const rows = await db
    .select({
      requesterId: swapRequests.requesterId,
      createdBy: swapRequests.createdBy,
      date: swapRequests.date,
      slotNumber: swapRequests.slotNumber,
    })
    .from(swapRequests)
    .where(and(eq(swapRequests.id, id), eq(swapRequests.status, "pending")))
    .limit(1);
  if (rows.length === 0) {
    return {
      ok: false,
      error: "取り下げできませんでした（既に対応済みの可能性があります）。",
    };
  }
  const req = rows[0];
  if (req.createdBy === null || req.createdBy === req.requesterId) {
    return {
      ok: false,
      error:
        "これは講師本人の申請です。取り下げではなく、理由を添えて却下してください。",
    };
  }

  const updated = await db
    .update(swapRequests)
    .set({
      status: "cancelled",
      decidedBy: profile.id,
      decidedAt: new Date(),
      decisionNote: reason,
      updatedAt: new Date(),
    })
    .where(and(eq(swapRequests.id, id), eq(swapRequests.status, "pending")))
    .returning({ id: swapRequests.id });
  if (updated.length === 0) {
    return {
      ok: false,
      error: "取り下げできませんでした（既に対応済みの可能性があります）。",
    };
  }

  // ⚠️ **応募者は UPDATE の「後」に取る**。先に取ると、SELECT と UPDATE の間に
  // 入った応募を取りこぼして通知が届かない (募集は消えるのに本人は待ち続ける)。
  // 後で取れば `applyToSwap` の行ロックで両方向とも安全:
  //   - 応募が先にコミット → こちらの UPDATE がロック待ちになり、解放後の
  //     SELECT にその応募が見える
  //   - こちらが先にコミット → `applyToSwap` は `FOR UPDATE` 後の status 再検証
  //     (`pending` でない) で弾かれ、応募自体が生まれない
  // なお取り消しで `swap_applications` の行は変化しない (withdrawnAt を立てる
  // のは講師の自己取り下げだけ) ので、後から引いても同じ結果になる。
  const applicants = await db
    .select({ applicantId: swapApplications.applicantId })
    .from(swapApplications)
    .where(
      and(
        eq(swapApplications.swapRequestId, id),
        isNull(swapApplications.withdrawnAt),
      ),
    );

  const meta = await getSlotMeta();
  const slotLabel = meta.get(req.slotNumber)?.label ?? `${req.slotNumber}限`;
  await Promise.all([
    notify([req.requesterId], {
      type: "swap_result",
      title: "代講の募集が取り下げられました",
      body: `対象: ${req.date} ${slotLabel} ／ ${reason}`,
      href: "/tutor/swaps",
    }),
    applicants.length > 0
      ? notify(
          applicants.map((a) => a.applicantId),
          {
            type: "swap_result",
            title: "応募していた代講の募集が取り下げられました",
            body: `対象: ${req.date} ${slotLabel} ／ ${reason}`,
            href: "/tutor/open-swaps",
          },
        )
      : Promise.resolve(),
  ]);

  revalidateAll();
  return { ok: true };
}
