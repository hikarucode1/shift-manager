"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { notify } from "@/lib/notifications";
import { isTutorBusyAt } from "@/lib/swaps";
import { jstToday } from "@/lib/week";
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
      // 「誰が実際にそのコマに入ったか」を記録できる唯一の業務経路で、
      // is_override と `代講(承認済): A → B` の note で監査痕跡も残る。同日の
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

      // クロス整合 (#33): requester はこのコマを失うので、同一コマの
      // 非終端 欠勤申請を自動失効。通常は作成時ガードで併存しないが、
      // 旧データ / すり抜け分の掃除 + #31 表示整合のため defensive に実施。
      await tx
        .update(absenceRequests)
        .set({
          status: "cancelled",
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

/** 交代成立時に同一コマの欠勤申請を失効させるときの decision_note。
 *  書く側 (承認) と読む側 (取り消し) で共有する。片方だけ変えると数えられなくなる */
const ABSENCE_AUTO_EXPIRED_NOTE = "交代成立により自動失効";

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
 * 代わりに戻り値で呼び出し側に伝え、画面で再申請を促す。
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
