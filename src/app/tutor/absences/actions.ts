"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { notify, notifyAdmins } from "@/lib/notifications";
import { slotLabelSafe } from "@/lib/slot-meta";
import { absenceRequestedNotice } from "@/lib/submission-notice";
import { db } from "@/db/client";
import {
  absenceRequests,
  swapRequests,
  weeklyShifts,
} from "@/db/schema";
import { isUniqueViolation } from "@/lib/db-errors";
import { isValidIsoDate, jstToday, noticeDate } from "@/lib/week";
import { hasSlotEnded } from "@/lib/swaps";
import { designeeError } from "@/lib/designee-check";
import { absenceTutorAssigned } from "@/lib/absences";
import { pendingAbsenceActions } from "@/lib/pending-absence-actions";
import {
  designeeNoteNames,
  sendDesignatedRequests,
} from "@/lib/designation-request";
import { createOpenSwapOnBehalf } from "@/app/admin/requests/swap-actions";

type ActionResult = { ok: true } | { ok: false; error: string };

const TargetInput = z.object({
  date: z.string().refine(isValidIsoDate, "日付が不正です。"),
  slotNumber: z.number().int().min(1).max(20),
});

const CreateInput = z.object({
  /** 室長レビュー要望1: 複数のコマをまとめて申請できる (理由は共通) */
  targets: z
    .array(TargetInput)
    .min(1, "申請するコマを選んでください。")
    .max(20, "一度に申請できるのは 20 コマまでです。"),
  reason: z.string().trim().min(1, "理由を入力してください。").max(500),
});

/** 1 コマ分の検証。問題があればエラー文、なければ null */
async function absenceTargetError(
  tutorId: string,
  date: string,
  slotNumber: number,
): Promise<string | null> {
  // 過去日は不可
  if (date < jstToday()) return "過去の日付は申請できません。";

  // 実在する自分の確定シフトか (クライアントを信用しない)
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
  if (shift.length === 0) return "対象の確定シフトが見つかりません。";

  // 既存の未処理/承認済み申請があれば重複させない
  // 事前チェック (UX 用のわかりやすいエラー)。最終的な一意性は
  // 部分ユニークインデックス absence_requests_active_uniq が DB レベルで保証。
  const dup = await db
    .select({ id: absenceRequests.id })
    .from(absenceRequests)
    .where(
      and(
        eq(absenceRequests.tutorId, tutorId),
        eq(absenceRequests.date, date),
        eq(absenceRequests.slotNumber, slotNumber),
        inArray(absenceRequests.status, ["pending", "approved"]),
      ),
    )
    .limit(1);
  if (dup.length > 0) return "このコマには既に申請があります。";

  // クロス整合 (#33): 同一コマに非終端の交代申請があれば欠勤申請は不可
  // (1コマ = 1ワークフローに収束させる)。
  //
  // ⚠️ 残存リスク (#33 レビュー C1, 受容済み): これと createSwapRequest 側の
  // 対称ガードは check→insert の TOCTOU で、異テーブル間の不変条件のため
  // 単一 unique では DB レベルに閉じられない (trigger/ロック表が必要＝過剰)。
  // 同一講師が欠勤・交代をミリ秒差で二重送信した場合のみ併存しうる
  // (通常操作でなく低確率、結果は破損でなく二重ハンドリング)。最悪ケース
  // (stale approved 欠勤) は交代承認時の auto-cancel が掃除するため比例的に
  // 受容。昇格条件: 自動化/高頻度化した場合は DB trigger で厳密化する。
  //
  // ⚠️ #217 追記: 「approved 欠勤 + pending 交代」は**もう TOCTOU 限定では
  // ない**。教室長の代理登録がこの併存を通常経路で作る。交代承認時の
  // auto-cancel は後始末ではなく前提の一部になった。
  const swapDup = await db
    .select({ id: swapRequests.id, createdBy: swapRequests.createdBy })
    .from(swapRequests)
    .where(
      and(
        eq(swapRequests.requesterId, tutorId),
        eq(swapRequests.date, date),
        eq(swapRequests.slotNumber, slotNumber),
        inArray(swapRequests.status, ["pending", "approved"]),
      ),
    )
    .limit(1);
  if (swapDup.length > 0) {
    // ⚠️ #231 で講師は代理募集を取り下げられなくなったので、「交代申請で対応
    // してください」だけだと閉じたドアを指す。作成者で文言を分ける
    return swapDup[0].createdBy !== null && swapDup[0].createdBy !== tutorId
      ? "このコマには教室長が出した代講の募集があります。欠勤の扱いは教室長にご相談ください。"
      : "このコマには交代申請があります。欠勤申請ではなく交代申請で対応してください。";
  }
  return null;
}

/** 講師: 欠勤申請を作成 (自分の今後の確定シフトに対してのみ) */
export async function createAbsenceRequest(
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
  const { reason } = parsed.data;

  // 同じコマの重複を除き、日付・コマ順に並べる
  const byKey = new Map<string, { date: string; slotNumber: number }>();
  for (const t of parsed.data.targets) byKey.set(`${t.date}|${t.slotNumber}`, t);
  const targets = [...byKey.values()].sort((a, b) =>
    a.date === b.date ? a.slotNumber - b.slotNumber : a.date < b.date ? -1 : 1,
  );
  const multiple = targets.length > 1;

  const labeled = await Promise.all(
    targets.map(async (t) => ({
      ...t,
      slotLabel: await slotLabelSafe(t.slotNumber),
    })),
  );

  // 1 つでも出せないコマがあれば、どれも出さない (どのコマか分かるように添える)
  for (const t of labeled) {
    const error = await absenceTargetError(profile.id, t.date, t.slotNumber);
    if (error) {
      return {
        ok: false,
        error: multiple
          ? `${noticeDate(t.date)} ${t.slotLabel}: ${error}`
          : error,
      };
    }
  }

  try {
    // 1 回の INSERT なので、全部入るか 1 つも入らないかのどちらか
    await db.insert(absenceRequests).values(
      targets.map((t) => ({
        tutorId: profile.id,
        // #217: 本人申告であることを残す。教室長の代理登録
        // (createAbsenceOnBehalf) と DB 上で区別できるのはこの列だけ
        createdBy: profile.id,
        date: t.date,
        slotNumber: t.slotNumber,
        reason,
      })),
    );
  } catch (e) {
    // 同時送信などで部分ユニーク制約に当たった場合
    if (isUniqueViolation(e, "absence_requests_active_uniq")) {
      return {
        ok: false,
        error: multiple
          ? "選んだコマのどれかに既に申請があります。画面を開き直してお試しください。"
          : "このコマには既に申請があります。",
      };
    }
    console.error("createAbsenceRequest insert failed", e);
    return { ok: false, error: "申請に失敗しました。時間をおいてお試しください。" };
  }

  // #338: 教室長のベルに知らせる (代講探しをすぐ始めるため)。失敗しても申請は成功のまま
  // まとめて出したときも通知は 1 件にする
  await notifyAdmins(
    absenceRequestedNotice(
      profile.displayName,
      labeled.map(({ date, slotLabel }) => ({ date, slotLabel })),
      reason,
    ),
    { exceptProfileId: profile.id },
  );

  revalidatePath("/tutor/absences");
  revalidatePath("/admin/requests");
  return { ok: true };
}

const IdInput = z.object({ id: z.string().uuid() });

/** 講師: 自分の pending 申請を取り消し */
export async function cancelAbsenceRequest(
  input: unknown,
): Promise<ActionResult> {
  const { profile } = await requireRole("tutor");

  const parsed = IdInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "入力が不正です。" };

  const updated = await db
    .update(absenceRequests)
    .set({
      status: "cancelled",
      closeKind: "tutor_withdraw",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(absenceRequests.id, parsed.data.id),
        eq(absenceRequests.tutorId, profile.id),
        eq(absenceRequests.status, "pending"),
      ),
    )
    .returning({ id: absenceRequests.id });

  if (updated.length === 0) {
    return {
      ok: false,
      error: "取り消せませんでした（既に処理済みの可能性があります）。",
    };
  }

  revalidatePath("/tutor/absences");
  revalidatePath("/admin/requests");
  return { ok: true };
}

const DecideInput = z.object({
  id: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
  decisionNote: z.string().trim().max(500).optional().default(""),
  /**
   * #331: 承認するときに指定する「代講を頼む相手」(任意)。休む講師はこの
   * 相手に代講を依頼し、相手が引き受けるとその場で成立する
   */
  designatedSubstituteId: z.string().uuid().nullable().optional(),
  /**
   * 室長レビュー要望2: 指名する相手を複数選ぶとき (早い者勝ち)。
   * designatedSubstituteId と両方あれば合わせる
   */
  designatedSubstituteIds: z
    .array(z.string().uuid())
    .max(10, "一度に指名できるのは 10 人までです。")
    .optional()
    .default([]),
  /**
   * 本番チェック メモ21・23: 承認と一緒にする次の一手。
   * - designate: designatedSubstituteId の講師に、教室長から直接依頼を送る
   * - recruit: 代講の募集に出す (出られる講師全員に知らせる)
   * - none: 承認だけ
   * 省略時は、相手があれば designate、無ければ none
   */
  followUp: z.enum(["designate", "recruit", "none"]).optional(),
});

/**
 * 教室長: 欠勤申請を承認 / 却下。
 *
 * ⚠️ **担当中のコマには、日付・コマのガードを意図的に置いていない** (#211)。
 * 例外は担当でなくなったコマだけ (#289。下の「例外」を参照)。交代・代講の承認
 * (`decideSwapRequest`) には `date < jstToday()` があるので「片方だけ直し忘れ」に
 * 見えるが、非対称は意図したもの:
 *
 * - **交代の承認は `weekly_shifts` を書き換える** = 誰が実際にそのコマに入ったかの
 *   実績台帳を触る。日を跨いだ書き換えを塞ぐ理由がある (#165/#178)
 * - **欠勤の承認は `absence_requests.status` しか触らない**。表示側はこの status を
 *   読むだけで、台帳そのものは変わらない:
 *   - 週次シフト表の取り消し線 = `getApprovedAbsenceKeysAll` (全講師分)
 *   - 講師ホームの「欠勤」バッジ = `getApprovedAbsenceKeys` (講師単位)
 *
 * そして「**後から欠勤を登録する**」(当日中に講師が出し忘れに気づいた / 教室長が
 * 後でまとめて処理する) は正当な実務。ここを塞ぐと #178・#213 と同じ
 * 「実態に合わせる手段が無い」詰みを作る。**担当中のコマに日付ガードを
 * 足さないこと。**
 *
 * ⚠️ 例外は**担当でなくなったコマ**だけ (#289)。担当でない講師の欠勤は、
 * まだ来ていないコマなら承認も却下もさせず、「不要として閉じる」
 * (`closeUnassignedAbsence`) を使わせる。終わったコマの承認は上の理由で通す。
 * 判定は `pendingAbsenceActions` (カードと共有)
 *
 * ⚠️ **作成側 (`createAbsenceRequest`) も日付粒度のままにしてあること**が、
 * この「後から登録する」を成立させている。交代側は #178 でピッカーから
 * 終了済みコマを落とし (`getTutorSwappableShifts`)、サーバー側も `hasSlotEnded` で
 * 塞いだが、**欠勤側はどちらもやっていない** (`getTutorUpcomingShifts` は
 * `gte(date, today)` のみ)。#178 を読んで「揃っていない」と見えても、
 * ここに `hasSlotEnded` を足さないこと。足すと当日の欠勤すら出せなくなる。
 *
 * ⚠️ 元は「翌日以降は誰も登録できない」穴があった (#217) が、**解消済み** —
 * `createAbsenceOnBehalf` (教室長の代理登録、日付ガード無し) が入った。
 * 講師側の `createAbsenceRequest` は今も `date < jstToday()` で弾くので、
 * 過去日は教室長の代理登録が唯一の入口。承認側を緩く保つ判断は変えない。
 */
export async function decideAbsenceRequest(
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
  const { id, decision, decisionNote } = parsed.data;
  const requestedIds = [
    ...new Set([
      ...(parsed.data.designatedSubstituteId
        ? [parsed.data.designatedSubstituteId]
        : []),
      ...parsed.data.designatedSubstituteIds,
    ]),
  ];
  const followUp =
    decision !== "approved"
      ? "none"
      : (parsed.data.followUp ??
        (requestedIds.length > 0 ? "designate" : "none"));
  const designeeIds = followUp === "designate" ? requestedIds : [];
  const designatedSubstituteId = designeeIds[0] ?? null;
  if (followUp === "designate" && designatedSubstituteId === null) {
    return { ok: false, error: "代講に指名する講師を選んでください。" };
  }

  if (decision === "rejected" && decisionNote.length === 0) {
    return { ok: false, error: "却下する場合は理由を入力してください。" };
  }

  // ⚠️ **担当でなくなったコマの扱い** (#289)。カードの出し分け
  // (`pendingAbsenceActions`) と同じ関数で、サーバでも確かめる (カードを開いた
  // まま担当が変わることがある)。
  // - 却下: 担当でなければ常に弾く。担当でない講師に「却下されました」が
  //   届くと「出勤しろ」と読める。「不要として閉じる」を使わせる
  // - 承認: 担当でない**まだ来ていない**コマだけ弾く。承認済みの欠勤は
  //   (講師, 日付, コマ) の組で残り、担当に戻ると欠勤マークが付くため (#291)。
  //   終わったコマは休んだ記録として承認できる
  // 「コマが終わったか」は時刻だけで決まるので先に判定し、担当であることが
  // 要るときは UPDATE の WHERE に入れて、確認と書き込みを 1 つの文にする。
  // ⚠️ 窓は**狭まるが消えない**。exists は weekly_shifts をロックしないので、
  // CSV の取り込み (日付ごとに消して入れ直す) と同時に走ると、すり抜けうる
  // 却下は「コマが終わったか」に関係なく、常に担当が要る (担当でない講師に
  // 「却下されました」を送らない)。承認だけ、終わったかで変わるので、その
  // ときだけ対象を読んで `pendingAbsenceActions` (カードと共有) に聞く
  let requireAssigned = true;
  if (decision === "approved") {
    const [target] = await db
      .select({
        tutorId: absenceRequests.tutorId,
        date: absenceRequests.date,
        slotNumber: absenceRequests.slotNumber,
      })
      .from(absenceRequests)
      .where(
        and(eq(absenceRequests.id, id), eq(absenceRequests.status, "pending")),
      )
      .limit(1);
    if (!target) {
      return {
        ok: false,
        error: "処理できませんでした（既に対応済みの可能性があります）。",
      };
    }
    // #331: 指定する相手は、休む本人以外の有効な講師で、そのコマが空いている人
    for (const designeeId of designeeIds) {
      const error = await designeeError({
        absentTutorId: target.tutorId,
        designeeId,
        date: target.date,
        slotNumber: target.slotNumber,
      });
      if (error) return { ok: false, error };
    }
    requireAssigned = !pendingAbsenceActions({
      tutorAssigned: false,
      isEnded: await hasSlotEnded(target.date, target.slotNumber),
    }).canApprove;
  }

  const updated = await db
    .update(absenceRequests)
    .set({
      status: decision,
      decidedBy: profile.id,
      decidedAt: new Date(),
      decisionNote: decisionNote.length > 0 ? decisionNote : null,
      designatedSubstituteId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(absenceRequests.id, id),
        eq(absenceRequests.status, "pending"),
        requireAssigned ? absenceTutorAssigned() : undefined,
      ),
    )
    .returning({
      id: absenceRequests.id,
      tutorId: absenceRequests.tutorId,
      date: absenceRequests.date,
    });

  if (updated.length === 0) {
    // 0 行の理由を見分ける。まだ pending なら「担当でない」で弾いた
    const [row] = await db
      .select({ status: absenceRequests.status })
      .from(absenceRequests)
      .where(eq(absenceRequests.id, id))
      .limit(1);
    return {
      ok: false,
      error:
        requireAssigned && row?.status === "pending"
          ? `このコマは今は担当ではないので${decision === "approved" ? "承認" : "却下"}できません。「不要として閉じる」を使ってください。`
          : "処理できませんでした（既に対応済みの可能性があります）。",
    };
  }

  // 本番チェック メモ21・23: 承認と一緒に、代講の指名 (B に直接依頼) か
  // 募集を済ませる。ここで失敗しても承認は戻さない (欠勤は確かなので)。
  // 失敗の理由は教室長に返し、「代講が決まっていない欠勤」から続けてもらう
  let followUpNote = "";
  let followUpError: string | null = null;
  if (followUp === "designate") {
    const sent = await sendDesignatedRequests({
      absenceId: updated[0].id,
      actorId: profile.id,
      designeeIds,
    });
    if (sent.sentNames.length > 0) {
      followUpNote = ` ／ 代講は${designeeNoteNames(sent.sentNames)}に依頼しました（返事待ち）`;
    }
    if (sent.errors.length > 0) followUpError = sent.errors.join(" ／ ");
  } else if (followUp === "recruit") {
    const [target] = await db
      .select({
        slotNumber: absenceRequests.slotNumber,
        reason: absenceRequests.reason,
      })
      .from(absenceRequests)
      .where(eq(absenceRequests.id, updated[0].id))
      .limit(1);
    const res = await createOpenSwapOnBehalf({
      tutorId: updated[0].tutorId,
      date: updated[0].date,
      slotNumber: target.slotNumber,
      reason: `欠勤（${target.reason}）`.slice(0, 500),
    });
    if (res.ok) {
      followUpNote = " ／ 代講は募集に出しました";
    } else {
      followUpError = res.error;
    }
  }

  await notify([updated[0].tutorId], {
    type: "absence_result",
    title:
      decision === "approved"
        ? "欠勤申請が承認されました"
        : "欠勤申請が却下されました",
    body:
      `対象日: ${updated[0].date}` +
      (decisionNote.length > 0 ? ` ／ ${decisionNote}` : "") +
      followUpNote,
    href: "/tutor/absences",
  });

  revalidatePath("/tutor/open-swaps");
  if (followUpError) {
    revalidatePath("/admin/requests");
    revalidatePath("/tutor/absences");
    return {
      ok: false,
      error: `承認はしましたが、代講の${followUp === "designate" ? "依頼" : "募集"}ができませんでした: ${followUpError}`,
    };
  }
  revalidatePath("/admin/requests");
  revalidatePath("/tutor/absences");
  return { ok: true };
}
